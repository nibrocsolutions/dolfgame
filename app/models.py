from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(24))
    rounds_played: Mapped[int] = mapped_column(Integer, default=0)
    best_strokes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    best_to_par: Mapped[int | None] = mapped_column(Integer, nullable=True)
    aces: Mapped[int] = mapped_column(Integer, default=0)
    birdies: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Round(Base):
    __tablename__ = "rounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"))
    seed: Mapped[int] = mapped_column(Integer, default=0)
    state_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(16), default="playing")
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    to_par: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
