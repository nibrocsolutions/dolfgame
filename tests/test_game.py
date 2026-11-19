import math

from app.course import HOLES, PAR_TOTAL
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
    x0, y0 = origin
    x1, y1 = hole["basket"]
    for step in range(1, 36):
        t = step / 36
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t
        for tx, ty, radius in hole["trees"]:
            if math.hypot(x - tx, y - ty) < radius - 0.3:
                return False
    return True
