import math

from app.course import HOLES
from app.discs import BAG, DISCS
from app.flight import simulate, travel


def test_a_driver_outruns_a_mid_and_a_putter():
    driver = travel(DISCS["destroyer"], 1, "flat")
    mid = travel(DISCS["mako3"], 1, "flat")
    putter = travel(DISCS["aviar"], 1, "flat")
    assert driver > mid > putter
    assert putter > 35
    assert mid > 70
    assert driver > 100


def test_hyzer_finishes_left_of_anhyzer():
    def finish(name, release):
        shot = simulate(DISCS[name], (0, 0), math.pi / 2, 1, release, _flat())
        return shot["x"]

    assert finish("roc3", "hyzer") < finish("roc3", "flat") < finish("roc3", "anhyzer")
    assert finish("leopard3", "flat") > finish("mako3", "flat") + 8
    assert abs(finish("mako3", "flat")) < 8


def test_the_edge_of_the_map_is_rough_not_a_cliff():
    hole = HOLES[0]
    minx, miny, maxx, maxy = hole["bounds"]
    from app.flight import zone

    assert zone(hole, maxx + 10, maxy + 10) == "safe"
    assert zone(hole, maxx + 80, maxy) == "ob"
    road = HOLES[7]
    assert zone(road, 0, 145) == "ob"


def test_the_bag_mixes_innova_and_mvp():
    brands = {disc.brand for disc in BAG}
    assert brands == {"Innova", "MVP"}
    kinds = {disc.kind for disc in BAG}
    assert kinds == {"putter", "midrange", "driver"}
    assert sum(1 for disc in BAG if disc.kind == "putter" and disc.brand == "Innova") >= 2
    assert sum(1 for disc in BAG if disc.kind == "putter" and disc.brand == "MVP") >= 2
    assert sum(1 for disc in BAG if disc.kind == "driver" and disc.brand == "Innova") >= 4
    assert sum(1 for disc in BAG if disc.kind == "driver" and disc.brand == "MVP") >= 4


def test_a_short_throw_finds_the_creek_and_a_mid_carries_it():
    hole = HOLES[2]
    wet = False
    for power in (0.25, 0.35, 0.45, 0.55, 0.65):
        shot = simulate(DISCS["aviar"], hole["tee"], math.pi / 2, power, "flat", hole)
        if shot["result"] == "water":
            wet = True
            break
    assert wet
    carried = simulate(DISCS["mako3"], hole["tee"], math.pi / 2, 1, "flat", hole)
    assert carried["result"] != "water"
    assert carried["y"] > 42


def _flat():
    return {
        "tee": (0.0, 0.0),
        "basket": (0.0, 400.0),
        "elevation": 0.0,
        "trees": (),
        "water": (),
        "ob": (),
        "dry": (),
        "bounds": (-200.0, -40.0, 200.0, 500.0),
        "wind": (0.0, 0.0),
    }
