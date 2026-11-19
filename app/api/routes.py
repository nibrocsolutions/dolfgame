"""Players, rounds, and the live throw socket.

The phone is a remote screen. The card and the lies live in SQLite on the
machine that runs this process.
"""

from __future__ import annotations

import json
import random
import time

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.course import COURSE_NAME, PAR_TOTAL
from app.database import SessionLocal, get_db
from app.discs import BAG
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


@router.post("/players", status_code=201)
def create_player(body: PlayerIn, db: Session = Depends(get_db)) -> dict:
    name = _clean_name(body.name)
    taken = db.scalar(select(Player).where(func.lower(Player.name) == name.casefold()))
    if taken is not None:
        raise HTTPException(status_code=409, detail="That name is already on this machine.")
    player = Player(name=name)
    db.add(player)
    db.commit()
    db.refresh(player)
    return _player_out(player)


@router.patch("/players/{player_id}")
def rename_player(player_id: int, body: PlayerPatch, db: Session = Depends(get_db)) -> dict:
    player = _player(db, player_id)
    name = _clean_name(body.name)
    taken = db.scalar(select(Player).where(func.lower(Player.name) == name.casefold(), Player.id != player.id))
    if taken is not None:
        raise HTTPException(status_code=409, detail="That name is already on this machine.")
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


@router.get("/admin/summary")
def admin_summary(db: Session = Depends(get_db)) -> dict:
    return {
        "players": db.scalar(select(func.count()).select_from(Player)) or 0,
        "rounds": db.scalar(select(func.count()).select_from(Round)) or 0,
        "aces": db.scalar(select(func.coalesce(func.sum(Player.aces), 0))) or 0,
    }


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
