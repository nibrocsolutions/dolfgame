"""Pine Bend, eighteen holes.

Meters, y up the page, x to the right. Each hole is a different shape: the
trees, the water, and the out-of-bounds are part of the hole, not a skin
on one fairway.
"""

from __future__ import annotations

import math

COURSE_NAME = "Pine Bend"
COURSE_HOLES = 18


def _length(hole: dict) -> float:
    tee, basket = hole["tee"], hole["basket"]
    return math.hypot(basket[0] - tee[0], basket[1] - tee[1])


def _hole(**kwargs) -> dict:
    hole = {
        "trees": (),
        "water": (),
        "ob": (),
        "dry": (),
        "fairway": (),
        "elevation": 0.0,
        "wind": (0.0, 0.0),
    }
    hole.update(kwargs)
    hole["length"] = _length(hole)
    return hole


HOLES: tuple[dict, ...] = (
    _hole(
        number=1,
        name="The Welcome",
        par=3,
        tee=(0.0, 0.0),
        basket=(-6.0, 70.0),
        blurb="Open starter. Pick a midrange and throw at the basket.",
        wind=(0.8, 0.2),
        bounds=(-28.0, -8.0, 26.0, 96.0),
        trees=((-16.0, 28.0, 3.2), (14.0, 34.0, 3.4), (-18.0, 52.0, 2.8), (12.0, 58.0, 3.0), (8.0, 78.0, 2.4)),
        fairway=(((-18.0, -2.0), (12.0, -2.0), (10.0, 78.0), (-16.0, 82.0)),),
    ),
    _hole(
        number=2,
        name="Needle",
        par=3,
        tee=(0.0, 0.0),
        basket=(0.0, 96.0),
        blurb="A tunnel of pines. Straight is the only clean line.",
        wind=(0.2, 0.0),
        bounds=(-22.0, -8.0, 22.0, 118.0),
        trees=tuple(
            (side, y, 2.7)
            for side in (-8.0, 8.0)
            for y in (18.0, 30.0, 42.0, 54.0, 66.0, 78.0)
        ),
        fairway=(((-5.5, -2.0), (5.5, -2.0), (5.5, 104.0), (-5.5, 104.0)),),
    ),
    _hole(
        number=3,
        name="Creek",
        par=3,
        tee=(0.0, 0.0),
        basket=(2.0, 74.0),
        blurb="The creek sits in front of the basket. Short is wet.",
        wind=(0.6, 0.4),
        bounds=(-26.0, -8.0, 30.0, 96.0),
        water=(((-30.0, 18.0), (32.0, 18.0), (32.0, 42.0), (-30.0, 42.0)),),
        trees=((-14.0, 58.0, 2.8), (16.0, 62.0, 3.0), (8.0, 84.0, 2.4)),
        fairway=(
            ((-12.0, -2.0), (12.0, -2.0), (14.0, 16.0), (-14.0, 16.0)),
            ((-12.0, 44.0), (16.0, 44.0), (14.0, 86.0), (-10.0, 86.0)),
        ),
    ),
    _hole(
        number=4,
        name="Barn Door",
        par=3,
        tee=(0.0, 0.0),
        basket=(42.0, 88.0),
        blurb="The straight line is trees. Throw out right, then up.",
        wind=(0.4, 0.6),
        bounds=(-18.0, -8.0, 100.0, 116.0),
        trees=(
            (12.0, 26.0, 3.6),
            (20.0, 32.0, 3.4),
            (14.0, 42.0, 3.6),
            (24.0, 46.0, 3.8),
            (16.0, 56.0, 3.4),
            (26.0, 60.0, 3.4),
            (18.0, 70.0, 3.2),
            (28.0, 74.0, 3.0),
        ),
        fairway=(
            ((-8.0, -2.0), (10.0, -2.0), (8.0, 36.0), (36.0, 28.0), (52.0, 48.0), (52.0, 100.0), (30.0, 100.0), (6.0, 48.0)),
        ),
    ),
    _hole(
        number=5,
        name="Long Field",
        par=4,
        tee=(0.0, 0.0),
        basket=(10.0, 188.0),
        blurb="Long and open. Driver, then an approach.",
        wind=(-1.6, -1.2),
        bounds=(-36.0, -8.0, 42.0, 214.0),
        trees=((-20.0, 48.0, 3.8), (24.0, 72.0, 3.4), (-14.0, 108.0, 4.0), (26.0, 140.0, 3.6), (-6.0, 168.0, 2.6), (18.0, 200.0, 2.8)),
        fairway=(((-16.0, -2.0), (18.0, -2.0), (24.0, 200.0), (-4.0, 204.0)),),
    ),
    _hole(
        number=6,
        name="Island",
        par=3,
        tee=(0.0, 0.0),
        basket=(0.0, 86.0),
        blurb="Island. Land on the circle or throw again from the tee.",
        wind=(1.0, 0.2),
        bounds=(-36.0, -8.0, 36.0, 118.0),
        water=(((-40.0, 14.0), (40.0, 14.0), (40.0, 114.0), (-40.0, 114.0)),),
        dry=((0.0, 86.0, 13.0),),
        fairway=(((-10.0, -2.0), (10.0, -2.0), (10.0, 12.0), (-10.0, 12.0)),),
    ),
    _hole(
        number=7,
        name="The Rise",
        par=3,
        tee=(0.0, 0.0),
        basket=(-2.0, 64.0),
        blurb="Uphill and narrow. It plays longer than the sign.",
        elevation=5.0,
        wind=(0.3, -0.8),
        bounds=(-20.0, -8.0, 20.0, 84.0),
        trees=((-9.0, 20.0, 2.8), (8.0, 22.0, 2.8), (-10.0, 38.0, 3.0), (9.0, 40.0, 2.8), (-7.0, 54.0, 2.4), (8.0, 56.0, 2.6)),
        fairway=(((-7.0, -2.0), (7.0, -2.0), (6.0, 74.0), (-8.0, 74.0)),),
    ),
    _hole(
        number=8,
        name="The Drop",
        par=3,
        tee=(0.0, 0.0),
        basket=(6.0, 118.0),
        blurb="Downhill. Soft throw. The road behind the basket is out of bounds.",
        elevation=-7.0,
        wind=(0.5, 0.8),
        bounds=(-48.0, -8.0, 52.0, 156.0),
        ob=(((-40.0, 136.0), (44.0, 136.0), (44.0, 160.0), (-40.0, 160.0)),),
        trees=((-14.0, 36.0, 3.0), (18.0, 70.0, 3.2), (-10.0, 96.0, 2.8)),
        fairway=(((-12.0, -2.0), (14.0, -2.0), (16.0, 128.0), (-8.0, 128.0)),),
    ),
    _hole(
        number=9,
        name="Switchback",
        par=4,
        tee=(0.0, 0.0),
        basket=(-36.0, 156.0),
        blurb="Up the fairway, then left. The corner is full of trees.",
        wind=(0.6, 0.2),
        bounds=(-56.0, -8.0, 48.0, 184.0),
        trees=(
            (-9.0, 40.0, 4.0),
            (-12.0, 55.0, 3.6),
            (-16.0, 70.0, 4.0),
            (-20.0, 84.0, 3.6),
            (-22.0, 96.0, 4.0),
            (-28.0, 122.0, 3.4),
            (16.0, 48.0, 3.0),
            (14.0, 90.0, 3.2),
        ),
        fairway=(
            ((-4.0, -2.0), (14.0, -2.0), (16.0, 108.0), (4.0, 112.0), (-28.0, 148.0), (-48.0, 170.0), (-28.0, 172.0), (-4.0, 120.0)),
        ),
    ),
    _hole(
        number=10,
        name="Cathedral",
        par=3,
        tee=(0.0, 0.0),
        basket=(6.0, 80.0),
        blurb="Woods. There is a straight gap if the disc holds its line.",
        wind=(0.3, 0.0),
        bounds=(-26.0, -8.0, 30.0, 100.0),
        trees=(
            (-14.0, 18.0, 3.0),
            (16.0, 20.0, 3.2),
            (-8.0, 34.0, 2.6),
            (18.0, 38.0, 3.0),
            (-16.0, 48.0, 3.0),
            (14.0, 52.0, 2.6),
            (-10.0, 64.0, 2.8),
            (20.0, 66.0, 3.0),
            (-2.0, 74.0, 2.2),
            (16.0, 86.0, 2.6),
        ),
        fairway=(((-6.0, -2.0), (8.0, -2.0), (12.0, 90.0), (0.0, 92.0)),),
    ),
    _hole(
        number=11,
        name="Creekside",
        par=3,
        tee=(10.0, 0.0),
        basket=(18.0, 106.0),
        blurb="Creek down the left side. A fade finishes wet.",
        wind=(-0.4, 0.3),
        bounds=(-8.0, -8.0, 56.0, 132.0),
        water=(((-20.0, -10.0), (2.0, -10.0), (2.0, 132.0), (-20.0, 132.0)),),
        trees=((30.0, 36.0, 3.0), (32.0, 70.0, 3.4), (28.0, 98.0, 3.0), (24.0, 118.0, 2.6)),
        fairway=(((6.0, -2.0), (24.0, -2.0), (28.0, 118.0), (10.0, 120.0)),),
    ),
    _hole(
        number=12,
        name="Meadow",
        par=4,
        tee=(0.0, 0.0),
        basket=(-4.0, 170.0),
        blurb="Open meadow and a real crosswind. Aim off the basket.",
        wind=(3.2, -0.4),
        bounds=(-40.0, -8.0, 46.0, 196.0),
        trees=((2.0, 156.0, 2.8), (-16.0, 162.0, 2.6), (12.0, 184.0, 3.0), (-22.0, 70.0, 3.2)),
        fairway=(((-20.0, -2.0), (22.0, -2.0), (18.0, 186.0), (-18.0, 186.0)),),
    ),
    _hole(
        number=13,
        name="Ace Alley",
        par=3,
        tee=(0.0, 0.0),
        basket=(0.0, 50.0),
        blurb="Short enough for a putter. The pines sit off to the side.",
        wind=(0.4, 0.2),
        bounds=(-20.0, -6.0, 20.0, 66.0),
        trees=((8.0, 26.0, 2.3),),
        fairway=(((-10.0, -2.0), (10.0, -2.0), (8.0, 58.0), (-8.0, 58.0)),),
    ),
    _hole(
        number=14,
        name="Two Windows",
        par=3,
        tee=(0.0, 0.0),
        basket=(0.0, 104.0),
        blurb="Two windows of pines. Throw straight and you can see the basket.",
        wind=(0.2, 0.2),
        bounds=(-32.0, -8.0, 32.0, 124.0),
        trees=(
            (-22.0, 34.0, 3.2),
            (-12.0, 34.0, 3.0),
            (12.0, 34.0, 3.0),
            (22.0, 34.0, 3.2),
            (-20.0, 70.0, 2.8),
            (-8.0, 70.0, 2.8),
            (8.0, 70.0, 2.8),
            (20.0, 70.0, 2.8),
        ),
        fairway=(((-8.0, -2.0), (8.0, -2.0), (8.0, 114.0), (-8.0, 114.0)),),
    ),
    _hole(
        number=15,
        name="Ridge Road",
        par=4,
        tee=(0.0, 0.0),
        basket=(6.0, 196.0),
        blurb="Long uphill. The road on the right is out of bounds.",
        elevation=6.0,
        wind=(0.3, -2.2),
        bounds=(-28.0, -8.0, 46.0, 222.0),
        ob=(((22.0, -10.0), (52.0, -10.0), (52.0, 226.0), (22.0, 226.0)),),
        trees=((-16.0, 44.0, 3.2), (-18.0, 96.0, 3.4), (-12.0, 150.0, 3.0), (-8.0, 186.0, 2.6)),
        fairway=(((-14.0, -2.0), (14.0, -2.0), (16.0, 208.0), (-6.0, 210.0)),),
    ),
    _hole(
        number=16,
        name="The Pocket",
        par=3,
        tee=(0.0, 0.0),
        basket=(-24.0, 90.0),
        blurb="The basket sits left, in a ring of pines. Throw into the pocket.",
        wind=(-0.5, 0.2),
        bounds=(-46.0, -8.0, 24.0, 116.0),
        trees=(
            (-34.0, 78.0, 3.0),
            (-36.0, 90.0, 3.0),
            (-32.0, 102.0, 3.0),
            (-22.0, 108.0, 2.6),
            (-12.0, 100.0, 2.8),
            (-14.0, 76.0, 2.8),
        ),
        fairway=((( -8.0, -2.0), (10.0, -2.0), (4.0, 70.0), (-16.0, 82.0), (-18.0, 100.0), (-34.0, 96.0), (-8.0, 64.0)),),
    ),
    _hole(
        number=17,
        name="Two Carries",
        par=4,
        tee=(0.0, 0.0),
        basket=(2.0, 176.0),
        blurb="Water twice. A mid past the first creek leaves a look. Long can reach the second.",
        wind=(0.8, 0.2),
        bounds=(-18.0, -8.0, 48.0, 200.0),
        water=(
            ((-36.0, 40.0), (24.0, 40.0), (24.0, 68.0), (-36.0, 68.0)),
            ((-36.0, 112.0), (26.0, 112.0), (26.0, 140.0), (-36.0, 140.0)),
        ),
        trees=((36.0, 30.0, 2.8), (38.0, 88.0, 3.0), (34.0, 156.0, 2.8)),
        fairway=(
            ((-10.0, -2.0), (14.0, -2.0), (16.0, 36.0), (-12.0, 36.0)),
            ((-12.0, 70.0), (20.0, 70.0), (18.0, 108.0), (-10.0, 108.0)),
            ((-8.0, 142.0), (16.0, 142.0), (12.0, 188.0), (-6.0, 188.0)),
        ),
    ),
    _hole(
        number=18,
        name="Last Light",
        par=5,
        tee=(0.0, 0.0),
        basket=(-38.0, 248.0),
        blurb="The finisher. A long fairway, then left to the basket.",
        elevation=-4.0,
        wind=(1.2, 0.4),
        bounds=(-64.0, -8.0, 36.0, 290.0),
        ob=(((-70.0, 274.0), (10.0, 274.0), (10.0, 300.0), (-70.0, 300.0)),),
        trees=(
            (-18.0, 150.0, 3.6),
            (-22.0, 168.0, 3.4),
            (-16.0, 186.0, 3.2),
            (-28.0, 200.0, 3.0),
            (-48.0, 230.0, 3.0),
            (-20.0, 236.0, 2.8),
            (-46.0, 258.0, 2.8),
            (16.0, 80.0, 3.2),
            (18.0, 130.0, 3.0),
        ),
        fairway=(
            ((-12.0, -2.0), (16.0, -2.0), (14.0, 160.0), (-6.0, 170.0), (-30.0, 230.0), (-52.0, 262.0), (-24.0, 266.0), (2.0, 180.0)),
        ),
    ),
)

def _segment_distance(a, b, x, y) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    span = dx * dx + dy * dy
    if span < 1:
        return math.hypot(x - ax, y - ay)
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / span))
    return math.hypot(x - (ax + dx * t), y - (ay + dy * t))


def _inside(x, y, poly) -> bool:
    inside = False
    j = len(poly) - 1
    for i, (xi, yi) in enumerate(poly):
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi:
            inside = not inside
        j = i
    return inside


def _wet(hole, x, y) -> bool:
    for circle in hole["dry"]:
        if math.hypot(x - circle[0], y - circle[1]) <= circle[2]:
            return False
    return any(_inside(x, y, poly) for poly in hole["water"])


def _plant(hole) -> None:
    """Long pines in the fairway and along it. Trunks stay off the throwing line except the doglegs."""
    tee, basket = hole["tee"], hole["basket"]
    dx, dy = basket[0] - tee[0], basket[1] - tee[1]
    span = math.hypot(dx, dy) or 1.0
    fx, fy = dx / span, dy / span
    rx, ry = fy, -fx
    extra: list[tuple[float, float, float]] = []
    existing = list(hole["trees"])
    lanes = (2.7, -3.0, 5.4, -5.8, 8.6, -9.2, 12.8, -13.4)
    distance = 9.0
    guards = hole["number"] in (4, 9, 18)
    while distance < span + 2 and len(extra) < 72:
        for lane_i, lateral in enumerate(lanes):
            if (int(distance / 8) + lane_i) % 2 == 1 and abs(lateral) >= 8:
                continue
            x = tee[0] + fx * distance + rx * lateral
            y = tee[1] + fy * distance + ry * lateral
            if _wet(hole, x, y):
                continue
            if not guards and _segment_distance(tee, basket, x, y) < 1.55:
                continue
            if any(math.hypot(x - tx, y - ty) < 2.4 for tx, ty, _radius in existing + extra):
                continue
            extra.append((round(x, 1), round(y, 1), 0.45))
        distance += 8.0
    if guards and not any(_segment_distance(tee, basket, tx, ty) < 0.45 for tx, ty, _radius in existing + extra):
        along = span * 0.46
        extra.append((round(tee[0] + fx * along, 1), round(tee[1] + fy * along, 1), 0.45))
    hole["trees"] = tuple(existing + extra)


def _lay_ground(hole) -> None:
    """A look that is not always straight at the basket, plus bushes and a few low hills."""
    tee, basket = hole["tee"], hole["basket"]
    dx, dy = basket[0] - tee[0], basket[1] - tee[1]
    span = math.hypot(dx, dy) or 1.0
    fx, fy = dx / span, dy / span
    rx, ry = fy, -fx
    # Radians. Positive puts the basket to the right of the first look.
    bias = {
        1: -0.22, 2: 0.16, 3: 0.32, 4: -0.38, 5: 0.26, 6: -0.14,
        7: 0.34, 8: -0.28, 9: 0.38, 10: -0.18, 11: 0.3, 12: -0.36,
        13: 0.12, 14: -0.34, 15: 0.24, 16: -0.2, 17: 0.18, 18: -0.38,
    }
    hole["look_bias"] = bias.get(hole["number"], 0.2)
    bushes: list[tuple[float, float, float]] = []
    hills: list[tuple[float, float, float, float]] = []

    def place(distance, lateral, kind, size):
        x = tee[0] + fx * distance + rx * lateral
        y = tee[1] + fy * distance + ry * lateral
        if distance < 8 or distance > span - 10:
            return
        if _wet(hole, x, y):
            return
        if kind == "bush":
            if any(math.hypot(x - bx, y - by) < 3.2 for bx, by, _r in bushes):
                return
            bushes.append((round(x, 1), round(y, 1), size))
        else:
            hills.append((round(x, 1), round(y, 1), size, 18.0 if abs(lateral) < 6 else 22.0))

    number = hole["number"]
    side = 11.0
    distance = 16.0
    while distance < span - 8:
        place(distance, side if (int(distance) + number) % 2 == 0 else -side, "bush", 1.5)
        place(distance + 6, -(side + 3.5), "bush", 1.8)
        distance += 18.0
    # A few in the fairway, off the throwing line.
    for along, lateral, size in ((0.34, 3.6, 1.3), (0.58, -4.1, 1.45), (0.74, 3.3, 1.2)):
        if number % 3 == 0 and along > 0.7:
            continue
        place(span * along, lateral, "bush", size)
    place(span * 0.4, 7.5 if number % 2 else -8.0, "hill", 1.8 + (number % 3) * 0.7)
    place(span * 0.66, -6.5 if number % 2 else 9.0, "hill", 1.4 + (number % 4) * 0.45)
    if span > 120:
        place(span * 0.5, 4.2 if number % 2 else -4.5, "hill", 1.3)
    for cx, cy, radius in hole["dry"]:
        if radius < 8:
            continue
        bushes.append((round(cx + 6.0, 1), round(cy - 4.0, 1), 1.4))
        bushes.append((round(cx - 5.5, 1), round(cy + 3.5, 1), 1.6))
        hills.append((round(cx + 3.0, 1), round(cy + 5.0, 1), 1.2, 9.0))
    hole["bushes"] = tuple(bushes)
    hole["hills"] = tuple(hills)


for _planted in HOLES:
    if _planted["number"] == 5 and not _planted["water"]:
        _planted["water"] = (((-42.0, 76.0), (-22.0, 72.0), (-20.0, 118.0), (-44.0, 122.0)),)
    if _planted["number"] == 12 and not _planted["water"]:
        _planted["water"] = (((26.0, 84.0), (46.0, 80.0), (44.0, 124.0), (24.0, 128.0)),)
    if _planted["number"] == 6:
        _planted["trees"] = tuple(_planted["trees"]) + ((-16.0, 6.0, 2.6), (16.5, 7.0, 2.7), (-14.0, 11.0, 2.3))
    _plant(_planted)
    _lay_ground(_planted)


assert len(HOLES) == COURSE_HOLES
PAR_TOTAL = sum(hole["par"] for hole in HOLES)


def hole_by_index(index: int) -> dict:
    return HOLES[index]


def feet(meters: float) -> int:
    return int(round(meters * 3.280839895))
