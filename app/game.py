"""One round of Pine Bend.

The phone is a map and an aim stick. Lies, penalties, and the card live here.
"""

from __future__ import annotations

import json
import math
import random

from app.course import HOLES, PAR_TOTAL, feet, hole_by_index
from app.discs import DISCS, RELEASES
from app.flight import simulate, stick_power

PICKUP_OVER = 4
# A lie inside 3 ft is close enough. The putt is given.
GIMMIE_METERS = 3 / 3.280839895


def new_round(seed: int) -> dict:
    hole = HOLES[0]
    return {
        "status": "playing",
        "hole": 0,
        "lie": [hole["tee"][0], hole["tee"][1]],
        "strokes": 0,
        "scores": [],
        "disc_id": "mako3",
        "release": "flat",
        "message": hole["blurb"],
        "score_name": "",
        "picked": False,
        "last_throw": None,
        "throw_seq": 0,
        "aces": 0,
        "birdies": 0,
        "seed": int(seed) % (2**31 - 1) or 1,
        "throw_lock": 0.0,
    }


def dump_state(state: dict) -> str:
    return json.dumps(state, separators=(",", ":"))


def score_name(strokes: int, par: int, picked: bool) -> str:
    if picked:
        return "Pickup"
    if strokes == 1:
        return "Ace"
    diff = strokes - par
    if diff <= -2:
        return "Eagle"
    if diff == -1:
        return "Birdie"
    if diff == 0:
        return "Par"
    if diff == 1:
        return "Bogey"
    if diff == 2:
        return "Double"
    return f"+{diff}"


def to_par(state: dict) -> int:
    done = len(state["scores"])
    return sum(state["scores"]) - sum(hole["par"] for hole in HOLES[:done])


def step(state: dict, cmd: object, dt: float) -> None:
    state["throw_lock"] = max(0.0, float(state.get("throw_lock", 0.0)) - max(0.0, dt))
    if not isinstance(cmd, dict):
        return
    if cmd.get("cmd") == "next":
        advance(state)
        return
    disc_id = cmd.get("disc")
    if isinstance(disc_id, str) and disc_id in DISCS:
        state["disc_id"] = disc_id
    release = cmd.get("release")
    if release in RELEASES:
        state["release"] = release
    pressed = []
    for name in cmd.get("pressed") or []:
        if name == "throw" and name not in pressed:
            pressed.append(name)
    if "throw" in pressed and state.get("status") == "playing" and state["throw_lock"] <= 0:
        _throw(state, cmd)


def advance(state: dict) -> None:
    if state.get("status") != "holed":
        return
    if state["hole"] >= len(HOLES) - 1:
        state["status"] = "finished"
        diff = to_par(state)
        state["score_name"] = "Round"
        state["message"] = f"{sum(state['scores'])} throws, {format_to_par(diff)}."
        state["last_throw"] = None
        return
    state["hole"] += 1
    hole = hole_by_index(state["hole"])
    state["lie"] = [hole["tee"][0], hole["tee"][1]]
    state["strokes"] = 0
    state["status"] = "playing"
    state["picked"] = False
    state["score_name"] = ""
    state["message"] = hole["blurb"]
    state["last_throw"] = None


def _throw(state: dict, cmd: dict) -> None:
    hole = hole_by_index(state["hole"])
    disc = DISCS[state["disc_id"]]
    release = state["release"]
    lie_x, lie_y = float(state["lie"][0]), float(state["lie"][1])
    basket_x, basket_y = hole["basket"]
    dist = math.hypot(basket_x - lie_x, basket_y - lie_y)
    angle, power = _aim(cmd, lie_x, lie_y, basket_x, basket_y, dist)
    physics, loft = stick_power(disc, release, power, dist)
    rng = random.Random((int(state["seed"]) + int(state["throw_seq"]) * 97) & 0xFFFFFFFF)
    spread = 0.012 * physics * (0.35 if dist < 10 else 1.0)
    angle += rng.uniform(-spread, spread)
    shot = simulate(disc, (lie_x, lie_y), angle, physics, release, hole, loft=loft)
    state["throw_seq"] = int(state["throw_seq"]) + 1
    state["throw_lock"] = 0.45
    state["strokes"] = int(state["strokes"]) + 1
    state["last_throw"] = {
        "seq": state["throw_seq"],
        "samples": shot["samples"],
        "events": shot["events"],
        "dt": shot["dt"],
        "result": shot["result"],
        "hit_tree": shot["hit_tree"],
        "disc": disc.id,
        "color": disc.color,
        "rim": disc.rim,
    }
    result = shot["result"]
    if result == "chains":
        _finish(state, hole, picked=False)
        state["message"] = "In the chains."
        return
    if result in ("water", "ob"):
        state["strokes"] += 1
        where = "In the water." if result == "water" else "Out of bounds."
        if state["strokes"] >= hole["par"] + PICKUP_OVER:
            state["strokes"] = hole["par"] + PICKUP_OVER
            _finish(state, hole, picked=True)
            state["message"] = f"{where} Picked up."
        else:
            state["message"] = f"{where} One penalty. Same lie."
        return
    state["lie"] = [shot["x"], shot["y"]]
    left = math.hypot(basket_x - shot["x"], basket_y - shot["y"])
    if state["strokes"] >= hole["par"] + PICKUP_OVER:
        state["strokes"] = hole["par"] + PICKUP_OVER
        _finish(state, hole, picked=True)
        state["message"] = "Picked up."
        return
    if left <= GIMMIE_METERS:
        _finish(state, hole, picked=False)
        state["message"] = "Gimmie."
        state["last_throw"]["events"].append({"t": shot["seconds"], "kind": "chains"})
        return
    tree = " Off a tree." if shot["hit_tree"] else ""
    if left < 3.5:
        state["message"] = f"Parked, {feet(left)} ft.{tree}"
    else:
        state["message"] = f"{feet(left)} ft to the basket.{tree}"


def _aim(cmd: dict, lie_x: float, lie_y: float, basket_x: float, basket_y: float, dist: float) -> tuple[float, float]:
    raw = cmd.get("aim") or [0.0, 0.0]
    try:
        ax, ay = float(raw[0]), float(raw[1])
    except (TypeError, ValueError, IndexError):
        ax, ay = 0.0, 0.0
    mag = min(1.0, math.hypot(ax, ay))
    try:
        power = float(cmd.get("power")) if cmd.get("power") is not None else mag
    except (TypeError, ValueError):
        power = mag
    power = max(0.0, min(1.0, power))
    if mag < 0.12:
        angle = math.atan2(basket_y - lie_y, basket_x - lie_x)
        if power < 0.12:
            power = 0.62 if dist > 20 else 0.78
        return angle, power
    if power < 0.08:
        power = mag
    return math.atan2(-ay, ax), power


def _finish(state: dict, hole: dict, picked: bool) -> None:
    state["picked"] = picked
    state["scores"].append(int(state["strokes"]))
    state["status"] = "holed"
    state["score_name"] = score_name(int(state["strokes"]), hole["par"], picked)
    if not picked and int(state["strokes"]) == 1:
        state["aces"] = int(state["aces"]) + 1
    if not picked and int(state["strokes"]) == hole["par"] - 1:
        state["birdies"] = int(state["birdies"]) + 1


def format_to_par(diff: int) -> str:
    if diff == 0:
        return "E"
    if diff > 0:
        return f"+{diff}"
    return str(diff)


def public_view(state: dict) -> dict:
    hole = hole_by_index(int(state["hole"]))
    disc = DISCS[state["disc_id"]]
    lie = state["lie"]
    basket = hole["basket"]
    dist = math.hypot(basket[0] - lie[0], basket[1] - lie[1])
    wind = hole["wind"]
    wind_mps = math.hypot(wind[0], wind[1])
    return {
        "status": state["status"],
        "hole_index": state["hole"],
        "hole": _hole_public(hole),
        "lie": lie,
        "strokes": state["strokes"],
        "scores": list(state["scores"]),
        "to_par": to_par(state),
        "to_par_label": format_to_par(to_par(state)),
        "total_strokes": sum(state["scores"]),
        "par_total": PAR_TOTAL,
        "disc": disc.public(),
        "bag": [item.public() for item in DISCS.values()],
        "release": state["release"],
        "message": state["message"],
        "score_name": state["score_name"],
        "picked": state["picked"],
        "distance_m": round(dist, 1),
        "distance_ft": feet(dist),
        "throw_seq": state["throw_seq"],
        "last_throw": state["last_throw"],
        "card": _card(state),
        "wind_mph": int(round(wind_mps * 2.236936)),
        "wind_label": _wind_label(wind),
        "putting": dist < 18,
    }


def _hole_public(hole: dict) -> dict:
    elevation = float(hole["elevation"])
    if elevation > 1:
        hill = f"Uphill {round(elevation)} m"
    elif elevation < -1:
        hill = f"Downhill {round(-elevation)} m"
    else:
        hill = "Level"
    return {
        "number": hole["number"],
        "name": hole["name"],
        "par": hole["par"],
        "length_m": round(hole["length"], 1),
        "length_ft": feet(hole["length"]),
        "tee": list(hole["tee"]),
        "basket": list(hole["basket"]),
        "trees": [list(tree) for tree in hole["trees"]],
        "water": [[list(point) for point in poly] for poly in hole["water"]],
        "ob": [[list(point) for point in poly] for poly in hole["ob"]],
        "dry": [list(circle) for circle in hole["dry"]],
        "fairway": [[list(point) for point in poly] for poly in hole["fairway"]],
        "bounds": list(hole["bounds"]),
        "elevation": elevation,
        "hill": hill,
        "wind": list(hole["wind"]),
        "blurb": hole["blurb"],
        "look_bias": float(hole.get("look_bias") or 0.0),
        "bushes": [list(bush) for bush in hole.get("bushes") or ()],
        "hills": [list(hill_row) for hill_row in hole.get("hills") or ()],
    }


def _card(state: dict) -> list[dict]:
    scores = state["scores"]
    rows = []
    for index, hole in enumerate(HOLES):
        rows.append(
            {
                "number": hole["number"],
                "name": hole["name"],
                "par": hole["par"],
                "score": scores[index] if index < len(scores) else None,
            }
        )
    return rows


def _wind_label(wind: tuple[float, float]) -> str:
    sx, sy = wind
    speed = math.hypot(sx, sy)
    if speed < 0.45:
        return "Calm"
    parts = []
    if sy > 0.45:
        parts.append("up")
    elif sy < -0.45:
        parts.append("down")
    if sx > 0.45:
        parts.append("right")
    elif sx < -0.45:
        parts.append("left")
    way = " and ".join(parts) if parts else "across"
    mph = int(round(speed * 2.236936))
    return f"{mph} mph to the {way}"

