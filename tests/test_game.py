import math

from app.course import HOLES, PAR_TOTAL
from app.flight import TRUNK_RADIUS
from app.game import advance, new_round, public_view, step


def test_eighteen_different_holes():
    assert len(HOLES) == 18
    assert PAR_TOTAL == sum(hole["par"] for hole in HOLES)
    assert len({hole["name"] for hole in HOLES}) == 18
    shapes = {
        (
            hole["par"],
            round(hole["basket"][0]),
            round(hole["basket"][1]),
            len(hole["trees"]),
            len(hole["water"]),
            len(hole["ob"]),
            round(hole["elevation"]),
        )
        for hole in HOLES
    }
    assert len(shapes) == 18
    for hole in HOLES:
        assert hole["tee"] != hole["basket"]
        if hole["par"] == 3:
            assert 40 <= hole["length"] <= 140
        elif hole["par"] == 4:
            assert 140 <= hole["length"] <= 230
        else:
            assert 210 <= hole["length"] <= 320
        # Doglegs plant trees on the straight line. The other holes have a look.
        if hole["number"] in (4, 9, 18):
            assert not _clear(hole["tee"], hole)
        else:
            assert _clear(hole["tee"], hole)


def test_inside_three_feet_is_a_gimmie(monkeypatch):
    from app.game import GIMMIE_METERS

    assert abs(GIMMIE_METERS - 0.9144) < 0.001
    basket = HOLES[0]["basket"]

    def land_close(*_args, **_kwargs):
        return {
            "samples": [[0, 0, 1], [basket[0] + 0.5, basket[1], 0]],
            "events": [],
            "result": "safe",
            "x": basket[0] + 0.5,
            "y": basket[1],
            "hit_tree": False,
            "dt": 0.06,
            "seconds": 0.4,
        }

    monkeypatch.setattr("app.game.simulate", land_close)
    state = new_round(4)
    step(state, {
        "cmd": "input",
        "aim": [0, -1],
        "power": 0.4,
        "pressed": ["throw"],
        "disc": "aviar",
        "release": "flat",
    }, 0.1)
    assert state["status"] == "holed"
    assert state["message"] == "Gimmie."
    assert state["scores"] == [1]


def test_every_hole_has_bushes_and_a_hill():
    for hole in HOLES:
        assert len(hole["bushes"]) >= 2
        assert hole["hills"]


def test_a_putt_finds_the_chains():
    state = new_round(3)
    basket = HOLES[0]["basket"]
    state["lie"] = [basket[0], basket[1] - 4]
    state["disc_id"] = "aviar"
    step(state, {
        "cmd": "input",
        "aim": [0, -1],
        "power": 1,
        "pressed": ["throw"],
        "disc": "aviar",
        "release": "flat",
    }, 0.1)
    assert state["status"] == "holed"
    assert state["scores"] == [1]
    assert state["score_name"] == "Ace"
    assert state["aces"] == 1


def test_shoot_does_not_throw():
    state = new_round(5)
    step(state, {"cmd": "input", "aim": [0, -1], "power": 1, "pressed": ["shoot", "fire"], "disc": "mako3", "release": "flat"}, 0.1)
    assert state["strokes"] == 0
    assert state["lie"] == [0, 0]
    step(state, {"cmd": "input", "aim": [0, -1], "power": 1, "pressed": ["throw"], "disc": "mako3", "release": "flat"}, 0.1)
    assert state["strokes"] >= 1
    assert state["lie"][1] > 15 or state["status"] == "holed"


def test_water_keeps_the_lie_and_adds_a_penalty():
    state = new_round(9)
    state["hole"] = 2
    tee = list(HOLES[2]["tee"])
    state["lie"] = tee[:]
    found = False
    for power in (0.3, 0.4, 0.5, 0.6):
        trial = new_round(9)
        trial["hole"] = 2
        trial["lie"] = tee[:]
        trial["disc_id"] = "aviar"
        step(trial, {
            "cmd": "input",
            "aim": [0, -power],
            "power": power,
            "pressed": ["throw"],
            "disc": "aviar",
            "release": "flat",
        }, 0.1)
        if "water" in trial["message"].lower():
            found = True
            assert trial["lie"] == tee
            assert trial["strokes"] == 2
            break
    assert found


def test_the_round_ends_after_eighteen_holes():
    state = new_round(1)
    for index in range(18):
        assert state["hole"] == index
        assert state["status"] == "playing"
        state["status"] = "holed"
        state["scores"].append(HOLES[index]["par"])
        advance(state)
    assert state["status"] == "finished"
    assert len(state["scores"]) == 18
    view = public_view(state)
    assert view["to_par"] == 0
    assert len(view["card"]) == 18


def _clear(origin, hole) -> bool:
    """True when no trunk stands on the straight line. The limbs are not in the way."""
    x0, y0 = origin
    x1, y1 = hole["basket"]
    dx, dy = x1 - x0, y1 - y0
    span = dx * dx + dy * dy or 1.0
    for tx, ty, _radius in hole["trees"]:
        t = max(0.0, min(1.0, ((tx - x0) * dx + (ty - y0) * dy) / span))
        if math.hypot(tx - (x0 + dx * t), ty - (y0 + dy * t)) < TRUNK_RADIUS:
            return False
    return True
