"""The bag: Innova and MVP molds, with the flight numbers printed on the disc.

Those names belong to their makers. This is a fan-made round, not their game.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Disc:
    id: str
    name: str
    brand: str
    kind: str
    speed: float
    glide: float
    turn: float
    fade: float
    color: str
    rim: str
    blurb: str

    @property
    def numbers(self) -> str:
        parts = []
        for value in (self.speed, self.glide, self.turn, self.fade):
            number = int(value) if float(value).is_integer() else value
            parts.append(str(number).replace("-", "−"))
        return " / ".join(parts)

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "brand": self.brand,
            "kind": self.kind,
            "speed": self.speed,
            "glide": self.glide,
            "turn": self.turn,
            "fade": self.fade,
            "numbers": self.numbers,
            "color": self.color,
            "rim": self.rim,
            "blurb": self.blurb,
        }


def _disc(id_, name, brand, kind, speed, glide, turn, fade, color, rim, blurb) -> Disc:
    return Disc(id_, name, brand, kind, speed, glide, turn, fade, color, rim, blurb)


BAG: tuple[Disc, ...] = (
    _disc("aviar", "Aviar", "Innova", "putter", 2, 3, 0, 1, "#f4f0e6", "#c0392b", "Straight putter. Holds the line you put it on."),
    _disc("nova", "Nova", "Innova", "putter", 2, 3, 0, 0, "#f7e27a", "#fff6c9", "Point and push. It holds the angle."),
    _disc("pig", "Pig", "Innova", "putter", 4, 1, 0, 3, "#d35400", "#ffd2b3", "Overstable approach. Dumps left at the end."),
    _disc("nomad", "Nomad", "MVP", "putter", 2, 4, 0, 1, "#e23e8c", "#f7b6d8", "Glidey putter. A little longer, still honest."),
    _disc("proxy", "Proxy", "MVP", "putter", 3, 3, -1, 0.5, "#5dade2", "#d6f0ff", "Understable putter. A gentle drift right."),
    _disc("envy", "Envy", "MVP", "putter", 3, 3, 0, 2, "#14b8a6", "#d5fff8", "Overstable approach. Fades at the end."),
    _disc("roc", "Roc", "Innova", "midrange", 4, 4, 0, 3, "#1a5276", "#d4e6f1", "The old reliable fade."),
    _disc("mako3", "Mako3", "Innova", "midrange", 5, 5, 0, 0, "#f08a24", "#ffe0c2", "Dead straight. Goes where you aim."),
    _disc("roc3", "Roc3", "Innova", "midrange", 5, 4, 0, 3, "#2f6adf", "#d6e2ff", "Trust the fade. It finishes left."),
    _disc("hex", "Hex", "MVP", "midrange", 5, 5, -1, 1, "#e6c229", "#fff4b0", "Soft turn, then a little fade."),
    _disc("reactor", "Reactor", "MVP", "midrange", 5, 5, -0.5, 1.5, "#8e44ad", "#f5e6ff", "Straight with a dependable finish."),
    _disc("matrix", "Matrix", "MVP", "midrange", 5, 4, 0, 1.5, "#1abc9c", "#d5fff6", "Stable mid. A small fade, no turn."),
    _disc("leopard", "Leopard", "Innova", "driver", 6, 5, -2, 1, "#27ae60", "#d5f5e3", "Slow fairway. Easy turn for newer arms."),
    _disc("teebird", "TeeBird", "Innova", "driver", 7, 5, 0, 2, "#b9770e", "#ffe8c2", "Straight fairway, then a fade."),
    _disc("leopard3", "Leopard3", "Innova", "driver", 7, 5, -2, 1, "#2f9e4a", "#d9f5e0", "Easy turn. Thrown flat, it moves right."),
    _disc("valkyrie", "Valkyrie", "Innova", "driver", 9, 4, -2, 2, "#f4d03f", "#fff6c4", "Turn it over and it still comes back."),
    _disc("thunderbird", "Thunderbird", "Innova", "driver", 9, 5, 0, 2, "#c0392b", "#ffd0d0", "Stable control driver. Fades late."),
    _disc("firebird", "Firebird", "Innova", "driver", 9, 3, 0, 4, "#7b241c", "#f5d0c8", "Hard fade. The skip-free meat hook."),
    _disc("wraith", "Wraith", "Innova", "driver", 11, 5, -1, 3, "#1a1a1a", "#d0d0d0", "Long and stable, with a late fade."),
    _disc("destroyer", "Destroyer", "Innova", "driver", 12, 5, -1, 3, "#d7263d", "#ffd0d6", "Fast and stable. Long, then a hard fade."),
    _disc("shryke", "Shryke", "Innova", "driver", 13, 6, -2, 2, "#6c3483", "#f3e5ff", "Very fast, with turn and glide."),
    _disc("crave", "Crave", "MVP", "driver", 6.5, 5, -1, 1, "#58d68d", "#e8fff1", "Controllable fairway. A touch of turn."),
    _disc("volt", "Volt", "MVP", "driver", 8, 5, -0.5, 2, "#f7dc6f", "#fff9db", "Stable fairway. Stays on the line."),
    _disc("tesla", "Tesla", "MVP", "driver", 9, 5, -1, 2, "#2980b9", "#d6eaf8", "Control driver with a small turn."),
    _disc("insanity", "Insanity", "MVP", "driver", 9, 5, -2, 1.5, "#e74c3c", "#fadbd8", "Understable driver. It moves right."),
    _disc("wave", "Wave", "MVP", "driver", 11, 5, -2, 2, "#7c4dff", "#e4d9ff", "Distance with turn, then a fade home."),
    _disc("photon", "Photon", "MVP", "driver", 11, 5, -1, 2.5, "#f5b041", "#fdebd0", "Stable distance. A modest turn, then fade."),
    _disc("octane", "Octane", "MVP", "driver", 13, 5, -1, 2, "#2c3e50", "#d5d8dc", "Fast distance. Long, with a late fade."),
)

DISCS: dict[str, Disc] = {disc.id: disc for disc in BAG}
KINDS = ("putter", "midrange", "driver")
RELEASES = ("hyzer", "flat", "anhyzer")


def kind_label(kind: str) -> str:
    return {"putter": "Putter", "midrange": "Midrange", "driver": "Driver"}.get(kind, kind)
