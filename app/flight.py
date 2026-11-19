"""Disc flight.

The phone sends an aim and a throw. This is the part that runs on the server:
speed, glide, turn, and fade, plus hyzer and anhyzer. Positive turn in the
numbers is rare; the molds we carry turn right when the number is negative
(a right-hand backhand) and fade left at the end.

Distances are meters. The map on the phone is the same plane, y up the hole.
"""

from __future__ import annotations

import math

from app.discs import Disc

DT = 0.02
SAMPLE_EVERY = 3
# A pine stops the disc with its trunk, from the ground to the top. The limbs are not a target.
TRUNK_RADIUS = 0.45
BARE_HOLE = {
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


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def point_in_poly(x: float, y: float, poly) -> bool:
    inside = False
    count = len(poly)
    if count < 3:
        return False
    j = count - 1
    for i in range(count):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            edge = (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi
            if x < edge:
                inside = not inside
        j = i
    return inside


def in_dry(hole: dict, x: float, y: float) -> bool:
    for cx, cy, radius in hole.get("dry") or ():
        if math.hypot(x - cx, y - cy) <= radius:
            return True
    return False


def zone(hole: dict, x: float, y: float) -> str:
    for poly in hole.get("water") or ():
        if point_in_poly(x, y, poly) and not in_dry(hole, x, y):
            return "water"
    for poly in hole.get("ob") or ():
        if point_in_poly(x, y, poly):
            return "ob"
    # The drawn hole is not a cliff. Only a long way off the map is out of bounds.
    bounds = hole.get("bounds")
    if bounds is not None:
        minx, miny, maxx, maxy = bounds
        margin = 42.0
        if x < minx - margin or x > maxx + margin or y < miny - margin or y > maxy + margin:
            return "ob"
    return "safe"


def ground_height(hole: dict, x: float, y: float) -> float:
    tee = hole["tee"]
    basket = hole["basket"]
    dx = basket[0] - tee[0]
    dy = basket[1] - tee[1]
    span = dx * dx + dy * dy
    if span < 1:
        along = 0.0
    else:
        along = ((x - tee[0]) * dx + (y - tee[1]) * dy) / span
    along = clamp(along, 0.0, 1.0)
    height = float(hole.get("elevation") or 0.0) * along + _contour(hole, x, y)
    for hx, hy, rise, radius in hole.get("hills") or ():
        if radius <= 0:
            continue
        d = math.hypot(x - hx, y - hy) / radius
        if d < 1.0:
            height += float(rise) * (1.0 - d * d)
    return height


def _contour(hole: dict, x: float, y: float) -> float:
    """A low roll across the hole. It fades out by the tee and the basket."""
    number = float(hole.get("number") or 1)
    tee = hole["tee"]
    basket = hole["basket"]
    basket_d = math.hypot(x - basket[0], y - basket[1])
    tee_d = math.hypot(x - tee[0], y - tee[1])
    fade = min(max(0.0, (basket_d - 16.0) / 22.0), max(0.0, (tee_d - 18.0) / 24.0), 1.0)
    roll = math.sin(x * 0.05 + number) * 0.9 + math.cos(y * 0.034 + number * 0.4) * 0.7
    return roll * fade


def _yaw_velocity(vx: float, vy: float, yaw: float, dt: float) -> tuple[float, float]:
    """Positive yaw turns to the thrower's right (clockwise on this map)."""
    c = math.cos(yaw * dt)
    s = math.sin(yaw * dt)
    return vx * c + vy * s, -vx * s + vy * c


def simulate(
    disc: Disc,
    origin: tuple[float, float],
    angle: float,
    power: float,
    release: str,
    hole: dict,
    loft: float = 1.0,
) -> dict:
    power = clamp(power, 0.05, 1.0)
    loft = clamp(loft, 0.25, 1.0)
    hyzer = {"anhyzer": -1.0, "flat": 0.0, "hyzer": 1.0}.get(release, 0.0)
    launch = (19.6 + disc.speed * 0.98) * (0.50 + 0.50 * power)
    vx = math.cos(angle) * launch
    vy = math.sin(angle) * launch
    vz = (2.2 + power * 0.65) * loft
    x, y = float(origin[0]), float(origin[1])
    z = ground_height(hole, x, y) + 1.5
    turn = disc.turn + hyzer * 1.25
    fade = max(0.0, disc.fade + hyzer * 1.55)
    wind = hole.get("wind") or (0.0, 0.0)
    trees = hole.get("trees") or ()
    samples = [[round(x, 2), round(y, 2), round(z, 2)]]
    events: list[dict] = []
    hit_tree = False
    result = "safe"
    t = 0.0
    crashed = False
    for step in range(700):
        spd = math.hypot(vx, vy)
        ground = ground_height(hole, x, y)
        high = clamp((spd - launch * 0.60) / (launch * 0.25), 0.0, 1.0)
        low = clamp((launch * 0.88 - spd) / (launch * 0.38), 0.0, 1.0)
        yaw = (-turn) * high * 0.12 - fade * low * 0.28
        yaw *= clamp((spd - 1.5) / 7.0, 0.0, 1.0)
        vx, vy = _yaw_velocity(vx, vy, yaw, DT)
        drag = max(0.075, 0.148 + (5 - disc.glide) * 0.011 - disc.speed * 0.0032)
        if crashed:
            drag += 0.55
        vx -= vx * drag * DT
        vy -= vy * drag * DT
        wind_k = 0.36 + max(0.0, 7 - disc.speed) * 0.03
        vx += float(wind[0]) * wind_k * DT
        vy += float(wind[1]) * wind_k * DT
        cruise = clamp((spd - 1.8) / 6.2, 0.0, 1.0)
        lift = min(0.915, (0.52 + disc.glide * 0.072) * cruise)
        vz += -9.81 * (1.0 - lift) * DT
        if vz > 4.0 * loft:
            vz = 4.0 * loft
        x += vx * DT
        y += vy * DT
        z += vz * DT
        t += DT
        if not crashed:
            hit = _tree_hit(x, y, z, ground, trees)
            if hit is not None:
                tx, ty, radius = hit
                x, y, vx, vy, vz = _kick(x, y, vx, vy, vz, tx, ty, radius)
                crashed = True
                hit_tree = True
                events.append({"t": round(t, 3), "kind": "tree"})
        basket = hole["basket"]
        if step > 4 and math.hypot(x - basket[0], y - basket[1]) <= 1.25:
            height = z - ground_height(hole, basket[0], basket[1])
            if 0.75 <= height <= 2.55 and vz < 7:
                x, y = float(basket[0]), float(basket[1])
                z = ground_height(hole, x, y) + 1.3
                result = "chains"
                events.append({"t": round(t, 3), "kind": "chains"})
                samples.append([round(x, 2), round(y, 2), round(z, 2)])
                break
        if z <= ground and t > 0.12:
            z = ground
            result = "safe"
            break
        if step % SAMPLE_EVERY == 0:
            samples.append([round(x, 2), round(y, 2), round(max(z, ground), 2)])
    if result != "chains":
        z = ground_height(hole, x, y)
        landing = zone(hole, x, y)
        if landing in ("water", "ob"):
            result = landing
        samples.append([round(x, 2), round(y, 2), round(z, 2)])
    return {
        "samples": samples,
        "events": events,
        "result": result,
        "x": round(x, 2),
        "y": round(y, 2),
        "hit_tree": hit_tree,
        "dt": DT * SAMPLE_EVERY,
        "seconds": round(t, 2),
    }


def _tree_hit(x: float, y: float, z: float, ground: float, trees) -> tuple[float, float, float] | None:
    del z, ground
    for tx, ty, _canopy in trees:
        if math.hypot(x - tx, y - ty) < TRUNK_RADIUS:
            return tx, ty, TRUNK_RADIUS
    return None


def _kick(x, y, vx, vy, vz, tx, ty, radius):
    dx, dy = x - tx, y - ty
    dist = math.hypot(dx, dy) or 0.001
    nx, ny = dx / dist, dy / dist
    x = tx + nx * (radius + 0.15)
    y = ty + ny * (radius + 0.15)
    vx = vx * 0.16 + nx * 1.4
    vy = vy * 0.16 + ny * 1.4
    vz = min(vz, 0.0) - 0.5
    return x, y, vx, vy, vz


def travel(disc: Disc, power: float, release: str, loft: float = 1.0) -> float:
    shot = simulate(disc, (0.0, 0.0), math.pi / 2, power, release, BARE_HOLE, loft=loft)
    return math.hypot(shot["x"], shot["y"])


def power_for_distance(disc: Disc, target: float, release: str, loft: float) -> float:
    if target <= 2:
        return 0.06
    lo, hi = 0.05, 1.0
    if travel(disc, 1.0, release, loft) <= target:
        return 1.0
    for _ in range(10):
        mid = (lo + hi) / 2
        if travel(disc, mid, release, loft) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def loft_for(dist: float) -> float:
    if dist < 12:
        return 0.42
    if dist < 24:
        return 0.42 + (dist - 12) / 12 * 0.58
    return 1.0


def stick_power(disc: Disc, release: str, stick: float, dist: float) -> tuple[float, float]:
    """Map the aim stick to a physics power.

    Inside about 30 m a full push reaches just past the basket, so a putt is
    a putt. Farther out, a full push is a full throw for that disc.
    """
    stick = clamp(stick, 0.08, 1.0)
    loft = loft_for(dist)
    full = travel(disc, 1.0, release, loft)
    cap = full
    if dist < 30:
        cap = min(full, dist * 1.28 + 1.4)
    want = max(2.2, cap * stick)
    if want >= full * 0.97:
        return 1.0, loft
    return power_for_distance(disc, want, release, loft), loft
