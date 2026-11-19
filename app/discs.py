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


BAG: tuple[Disc, ...] = (
    Disc("aviar", "Aviar", "Innova", "putter", 2, 3, 0, 1, "#f4f0e6", "#c0392b", "Straight putter. Holds the line you put it on."),
    Disc("nomad", "Nomad", "MVP", "putter", 2, 4, 0, 1, "#e23e8c", "#f7b6d8", "Glidey putter. A little longer, still honest."),
    Disc("envy", "Envy", "MVP", "putter", 3, 3, 0, 2, "#14b8a6", "#d5fff8", "Overstable approach. Fades at the end."),
    Disc("mako3", "Mako3", "Innova", "midrange", 5, 5, 0, 0, "#f08a24", "#ffe0c2", "Dead straight. Goes where you aim."),
    Disc("hex", "Hex", "MVP", "midrange", 5, 5, -1, 1, "#e6c229", "#fff4b0", "Soft turn, then a little fade."),
    Disc("roc3", "Roc3", "Innova", "midrange", 5, 4, 0, 3, "#2f6adf", "#d6e2ff", "Trust the fade. It finishes left."),
    Disc("leopard3", "Leopard3", "Innova", "driver", 7, 5, -2, 1, "#2f9e4a", "#d9f5e0", "Easy turn. Thrown flat, it moves right."),
    Disc("wave", "Wave", "MVP", "driver", 11, 5, -2, 2, "#7c4dff", "#e4d9ff", "Distance with turn, then a fade home."),
    Disc("destroyer", "Destroyer", "Innova", "driver", 12, 5, -1, 3, "#d7263d", "#ffd0d6", "Fast and stable. Long, then a hard fade."),
)

DISCS: dict[str, Disc] = {disc.id: disc for disc in BAG}
KINDS = ("putter", "midrange", "driver")
RELEASES = ("hyzer", "flat", "anhyzer")


def kind_label(kind: str) -> str:
    return {"putter": "Putter", "midrange": "Midrange", "driver": "Driver"}.get(kind, kind)
