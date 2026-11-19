"""Players, rounds, and the live throw socket.

The phone is a remote screen. The card and the lies live in SQLite on the
machine that runs this process.
"""

from __future__ import annotations

import json
import random
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.course import COURSE_NAME, PAR_TOTAL, hole_by_index
from app.database import SessionLocal, get_db
from app.discs import BAG, DISCS
from app.game import dump_state, format_to_par, new_round, public_view, step, to_par
from app.models import Player, Round, utcnow

router = APIRouter(prefix="/api")


class PlayerIn(BaseModel):
    name: str = Field(min_length=1, max_length=24)


class PlayerPatch(BaseModel):
    name: str = Field(min_length=1, max_length=24)


class RoundIn(BaseModel):
    player_id: int
    fresh: bool = False


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.strip().split())
    if not cleaned:
        raise HTTPException(status_code=400, detail="Enter a name.")
    return cleaned[:24]


def _player(db: Session, player_id: int) -> Player:
    player = db.get(Player, player_id)
    if player is None:
        raise HTTPException(status_code=404, detail="No such player.")
    return player


def _round_for(db: Session, round_id: int, player_id: int) -> tuple[Round, Player]:
    record = db.get(Round, round_id)
    if record is None or record.player_id != player_id:
        raise HTTPException(status_code=404, detail="No such round.")
    return record, _player(db, player_id)


def _load(record: Round) -> dict:
    return json.loads(record.state_json)


def _save(db: Session, record: Round, state: dict) -> None:
    record.state_json = dump_state(state)
    record.status = state["status"]
    record.seed = int(state["seed"])
    record.updated_at = utcnow()
    db.commit()


def _summary(record: Round) -> dict:
    state = _load(record)
    hole = state["hole"]
    return {
        "id": record.id,
        "status": state["status"],
        "hole": hole + 1,
        "hole_name": public_view(state)["hole"]["name"],
        "strokes": int(state["strokes"]),
        "to_par": to_par(state),
        "to_par_label": format_to_par(to_par(state)),
        "throws": sum(state["scores"]) + int(state["strokes"]),
    }


def _player_out(player: Player) -> dict:
    best = None if player.best_to_par is None else format_to_par(player.best_to_par)
    return {
        "id": player.id,
        "name": player.name,
        "rounds_played": player.rounds_played,
        "best_strokes": player.best_strokes,
        "best_to_par": player.best_to_par,
        "best_label": best,
        "aces": player.aces,
        "birdies": player.birdies,
    }


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.get("/players")
def list_players(db: Session = Depends(get_db)) -> list[dict]:
    players = db.scalars(select(Player).order_by(Player.created_at, Player.id)).all()
    return [_player_out(player) for player in players]


@router.post("/players")
def create_player(body: PlayerIn, response: Response, db: Session = Depends(get_db)) -> dict:
    name = _clean_name(body.name)
    taken = db.scalar(select(Player).where(func.lower(Player.name) == name.casefold()))
    if taken is not None:
        response.status_code = 200
        return _player_out(taken)
    player = Player(name=name)
    db.add(player)
    db.commit()
    db.refresh(player)
    response.status_code = 201
    return _player_out(player)


@router.patch("/players/{player_id}")
def rename_player(player_id: int, body: PlayerPatch, db: Session = Depends(get_db)) -> dict:
    player = _player(db, player_id)
    name = _clean_name(body.name)
    taken = db.scalar(select(Player).where(func.lower(Player.name) == name.casefold(), Player.id != player.id))
    if taken is not None:
        raise HTTPException(status_code=409, detail="That name is already taken.")
    player.name = name
    db.commit()
    return _player_out(player)


@router.delete("/players/{player_id}")
def delete_player(player_id: int, db: Session = Depends(get_db)) -> dict:
    player = _player(db, player_id)
    for old in db.scalars(select(Round).where(Round.player_id == player.id)).all():
        db.delete(old)
    db.delete(player)
    db.commit()
    return {"ok": True}


@router.get("/home")
def home(player_id: int, db: Session = Depends(get_db)) -> dict:
    player = _player(db, player_id)
    active = db.scalar(
        select(Round)
        .where(Round.player_id == player.id, Round.status.in_(("playing", "holed", "finished")))
        .order_by(Round.updated_at.desc())
    )
    return {
        "player": _player_out(player),
        "course": {"name": COURSE_NAME, "holes": 18, "par": PAR_TOTAL},
        "bag": [disc.public() for disc in BAG],
        "active": _summary(active) if active else None,
    }


@router.post("/rounds", status_code=201)
def start_round(body: RoundIn, db: Session = Depends(get_db)) -> dict:
    player = _player(db, body.player_id)
    if not body.fresh:
        active = db.scalar(
            select(Round)
            .where(Round.player_id == player.id, Round.status.in_(("playing", "holed", "finished")))
            .order_by(Round.updated_at.desc())
        )
        if active is not None:
            return {"round": _summary(active), "view": public_view(_load(active)), "resumed": True}
    for old in db.scalars(select(Round).where(Round.player_id == player.id, Round.status.in_(("playing", "holed", "finished")))).all():
        old.status = "abandoned"
    seed = random_seed()
    state = new_round(seed)
    record = Round(player_id=player.id, seed=state["seed"], state_json=dump_state(state), status="playing")
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"round": _summary(record), "view": public_view(state), "resumed": False}


@router.get("/rounds/{round_id}")
def get_round(round_id: int, player_id: int, db: Session = Depends(get_db)) -> dict:
    record, _player_row = _round_for(db, round_id, player_id)
    return {"round": _summary(record), "view": public_view(_load(record))}


@router.post("/rounds/{round_id}/resolve")
def resolve_round(round_id: int, player_id: int, db: Session = Depends(get_db)) -> dict:
    record, player = _round_for(db, round_id, player_id)
    state = _load(record)
    if state.get("status") != "finished":
        raise HTTPException(status_code=409, detail="The round is not finished.")
    if len(state.get("scores") or []) != 18:
        raise HTTPException(status_code=409, detail="The card is not full.")
    total = sum(state["scores"])
    diff = to_par(state)
    player.rounds_played += 1
    player.aces += int(state.get("aces") or 0)
    player.birdies += int(state.get("birdies") or 0)
    if player.best_strokes is None or total < player.best_strokes:
        player.best_strokes = total
        player.best_to_par = diff
    record.score = total
    record.to_par = diff
    record.status = "carded"
    state["status"] = "carded"
    _save(db, record, state)
    return {
        "strokes": total,
        "to_par": diff,
        "to_par_label": format_to_par(diff),
        "aces": int(state.get("aces") or 0),
        "birdies": int(state.get("birdies") or 0),
        "player": _player_out(player),
    }


ROUND_STATUSES = {"playing", "holed", "finished", "carded", "abandoned"}
OPEN_STATUSES = {"playing", "holed", "finished"}


def _as_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _parse_time(value: object, fallback: datetime) -> datetime:
    if value in (None, ""):
        return fallback
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail="A date in that file is not readable.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="A date in that file is not readable.") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _as_int(value: object, label: str, minimum: int | None = 0, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise HTTPException(status_code=400, detail=f"{label} is not a whole number.")
    if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        raise HTTPException(status_code=400, detail=f"{label} is not a whole number.")
    return value


def _as_optional_int(value: object, label: str, minimum: int | None = 0, maximum: int | None = None) -> int | None:
    if value is None:
        return None
    return _as_int(value, label, minimum, maximum)


def _active_label(record: Round) -> dict | None:
    if record.status not in OPEN_STATUSES:
        return None
    try:
        state = _load(record)
        hole = hole_by_index(int(state["hole"]))
    except (KeyError, TypeError, ValueError, IndexError, json.JSONDecodeError):
        return {"status": record.status, "hole": None, "hole_name": "", "label": "Round needs a look"}
    number = int(hole["number"])
    name = str(hole["name"])
    status = str(state.get("status") or record.status)
    if status == "holed":
        label = f"Holed out · {name}"
    elif status == "finished":
        label = f"Card ready · {name}"
    else:
        label = f"Hole {number} · {name}"
    return {"status": status, "hole": number, "hole_name": name, "label": label}


def _roster(db: Session) -> dict:
    players = db.scalars(select(Player).order_by(Player.created_at, Player.id)).all()
    rounds = db.scalars(select(Round).order_by(Round.updated_at.desc(), Round.id.desc())).all()
    by_player: dict[int, list[Round]] = {}
    open_rounds = 0
    for record in rounds:
        by_player.setdefault(record.player_id, []).append(record)
        if record.status in OPEN_STATUSES:
            open_rounds += 1
    saved_rounds = sum(player.rounds_played for player in players)
    rows = []
    for player in sorted(players, key=lambda item: (item.name.casefold(), item.id)):
        owned = by_player.get(player.id, [])
        active = None
        for record in owned:
            active = _active_label(record)
            if active is not None:
                break
        last = owned[0].updated_at if owned else None
        row = _player_out(player)
        row["active"] = active
        row["last_at"] = _as_iso(last)
        rows.append(row)
    return {
        "summary": {
            "players": len(players),
            "rounds": len(rounds),
            "open_rounds": open_rounds,
            "saved_rounds": saved_rounds,
            "aces": sum(player.aces for player in players),
            "birdies": sum(player.birdies for player in players),
        },
        "players": rows,
    }


def _export_payload(db: Session) -> dict:
    players = db.scalars(select(Player).order_by(Player.id)).all()
    rounds = db.scalars(select(Round).order_by(Round.id)).all()
    return {
        "app": "chainline",
        "course": COURSE_NAME,
        "players": [
            {
                "id": player.id,
                "name": player.name,
                "rounds_played": player.rounds_played,
                "best_strokes": player.best_strokes,
                "best_to_par": player.best_to_par,
                "aces": player.aces,
                "birdies": player.birdies,
                "created_at": _as_iso(player.created_at),
            }
            for player in players
        ],
        "rounds": [
            {
                "id": record.id,
                "player_id": record.player_id,
                "seed": record.seed,
                "state_json": record.state_json,
                "status": record.status,
                "score": record.score,
                "to_par": record.to_par,
                "created_at": _as_iso(record.created_at),
                "updated_at": _as_iso(record.updated_at),
            }
            for record in rounds
        ],
    }


def _backup_state(raw: object, seed: int) -> dict:
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="A round in that file is missing its card.") from None
    elif isinstance(raw, dict):
        parsed = raw
    else:
        raise HTTPException(status_code=400, detail="A round in that file is missing its card.")
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="A round in that file is missing its card.")
    try:
        hole = _as_int(parsed.get("hole"), "A hole", maximum=17)
        status = parsed.get("status")
        lie = parsed.get("lie")
        strokes = _as_int(parsed.get("strokes"), "A throw count")
        scores = parsed.get("scores")
        disc_id = parsed.get("disc_id")
    except HTTPException:
        raise
    if status not in ROUND_STATUSES:
        raise HTTPException(status_code=400, detail="A round in that file is missing its card.")
    if not isinstance(lie, list) or len(lie) != 2 or not all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in lie):
        raise HTTPException(status_code=400, detail="A round in that file is missing its card.")
    if not isinstance(scores, list) or len(scores) > 18:
        raise HTTPException(status_code=400, detail="A round in that file is missing its card.")
    if not isinstance(disc_id, str) or disc_id not in DISCS:
        raise HTTPException(status_code=400, detail="A round uses a disc that is not in the bag.")
    state = new_round(seed)
    state.update(parsed)
    state["seed"] = seed
    state["hole"] = hole
    state["status"] = status
    state["lie"] = [float(lie[0]), float(lie[1])]
    state["strokes"] = strokes
    state["scores"] = [_as_int(score, "A hole score") for score in scores]
    state["disc_id"] = disc_id
    if state.get("release") not in {"hyzer", "flat", "anhyzer"}:
        state["release"] = "flat"
    return state


def _import_backup(db: Session, body: dict) -> dict:
    if body.get("app") not in (None, "chainline"):
        raise HTTPException(status_code=400, detail="That file is not a Chainline backup.")
    raw_players = body.get("players")
    raw_rounds = body.get("rounds")
    if not isinstance(raw_players, list) or not isinstance(raw_rounds, list):
        raise HTTPException(status_code=400, detail="That file is not a Chainline backup.")
    now = utcnow()
    players: list[dict] = []
    seen_ids: set[int] = set()
    seen_names: set[str] = set()
    for item in raw_players:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="That file is not a Chainline backup.")
        player_id = _as_int(item.get("id"), "A player id", minimum=1)
        if player_id in seen_ids:
            raise HTTPException(status_code=400, detail="Those player ids match.")
        seen_ids.add(player_id)
        name = _clean_name(item.get("name") if isinstance(item.get("name"), str) else "")
        if name.casefold() in seen_names:
            raise HTTPException(status_code=400, detail="That name is already taken.")
        seen_names.add(name.casefold())
        players.append(
            {
                "id": player_id,
                "name": name,
                "rounds_played": _as_int(item.get("rounds_played") or 0, "Saved rounds"),
                "best_strokes": _as_optional_int(item.get("best_strokes"), "A best score", maximum=200),
                "best_to_par": _as_optional_int(item.get("best_to_par"), "A best score", minimum=-80, maximum=200),
                "aces": _as_int(item.get("aces") or 0, "Aces"),
                "birdies": _as_int(item.get("birdies") or 0, "Birdies"),
                "created_at": _parse_time(item.get("created_at"), now),
            }
        )
    player_ids = {player["id"] for player in players}
    rounds: list[dict] = []
    seen_rounds: set[int] = set()
    for item in raw_rounds:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="That file is not a Chainline backup.")
        round_id = _as_int(item.get("id"), "A round id", minimum=1)
        if round_id in seen_rounds:
            raise HTTPException(status_code=400, detail="Those round ids match.")
        seen_rounds.add(round_id)
        player_id = _as_int(item.get("player_id"), "A player id", minimum=1)
        if player_id not in player_ids:
            raise HTTPException(status_code=400, detail="A round points at a player who is not in the file.")
        seed = _as_int(item.get("seed") or 1, "A round seed", minimum=1)
        raw_state = item.get("state_json", item.get("state"))
        state = _backup_state(raw_state, seed)
        status = item.get("status") or state["status"]
        if status not in ROUND_STATUSES:
            raise HTTPException(status_code=400, detail="A round in that file is missing its card.")
        state["status"] = status
        created = _parse_time(item.get("created_at"), now)
        rounds.append(
            {
                "id": round_id,
                "player_id": player_id,
                "seed": int(state["seed"]),
                "state_json": dump_state(state),
                "status": status,
                "score": _as_optional_int(item.get("score"), "A card", maximum=200),
                "to_par": _as_optional_int(item.get("to_par"), "A card", minimum=-80, maximum=200),
                "created_at": created,
                "updated_at": _parse_time(item.get("updated_at"), created),
            }
        )
    db.execute(delete(Round))
    db.execute(delete(Player))
    for player in players:
        db.add(Player(**player))
    db.flush()
    for record in rounds:
        db.add(Round(**record))
    db.commit()
    return {"ok": True, "players": len(players), "rounds": len(rounds)}


@router.get("/admin/summary")
def admin_summary(db: Session = Depends(get_db)) -> dict:
    roster = _roster(db)
    summary = roster["summary"]
    return {
        "players": summary["players"],
        "rounds": summary["rounds"],
        "aces": summary["aces"],
    }


@router.get("/admin/players")
def admin_players(db: Session = Depends(get_db)) -> dict:
    return _roster(db)


@router.get("/admin/export")
def admin_export(db: Session = Depends(get_db)) -> Response:
    payload = json.dumps(_export_payload(db), indent=2)
    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="chainline-backup.json"'},
    )


@router.post("/admin/import")
async def admin_import(request: Request, db: Session = Depends(get_db)) -> dict:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="That file is not JSON.") from None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="That file is not a Chainline backup.")
    return _import_backup(db, body)


@router.websocket("/rounds/{round_id}/play")
async def play(websocket: WebSocket, round_id: int, player_id: int) -> None:
    await websocket.accept()
    db = SessionLocal()
    record = None
    state = None
    try:
        record = db.get(Round, round_id)
        if record is None or record.player_id != player_id:
            await websocket.close(code=4404)
            return
        state = _load(record)
        await websocket.send_json(public_view(state))
        last = time.monotonic()
        last_save = last
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("cmd") == "reload":
                db.refresh(record)
                state = _load(record)
            else:
                now = time.monotonic()
                before = (state.get("throw_seq"), state.get("status"), state.get("hole"))
                step(state, msg, min(0.2, now - last))
                last = now
                changed = (state.get("throw_seq"), state.get("status"), state.get("hole")) != before
                if changed or now - last_save > 0.7:
                    _save(db, record, state)
                    last_save = now
            await websocket.send_json(public_view(state))
    except WebSocketDisconnect:
        pass
    finally:
        try:
            if record is not None and state is not None:
                _save(db, record, state)
        except Exception:
            db.rollback()
        db.close()


def random_seed() -> int:
    return random.SystemRandom().randrange(1, 2**31 - 1)
