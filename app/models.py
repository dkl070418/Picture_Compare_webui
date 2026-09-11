from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import settings


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class Image(Base):
    __tablename__ = "images"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    filename: Mapped[str] = mapped_column(String(512))
    stored_name: Mapped[str] = mapped_column(String(256))
    note: Mapped[str] = mapped_column(String(512), default="")
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class ComparisonGroup(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    name: Mapped[str] = mapped_column(String(256))
    image_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    @property
    def image_ids(self) -> list[str]:
        try:
            data = json.loads(self.image_ids_json or "[]")
            return [str(x) for x in data] if isinstance(data, list) else []
        except json.JSONDecodeError:
            return []

    @image_ids.setter
    def image_ids(self, value: list[str]) -> None:
        self.image_ids_json = json.dumps(list(value), ensure_ascii=False)


class Share(Base):
    __tablename__ = "shares"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    title: Mapped[str] = mapped_column(String(256), default="")
    image_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    @property
    def image_ids(self) -> list[str]:
        try:
            data = json.loads(self.image_ids_json or "[]")
            return [str(x) for x in data] if isinstance(data, list) else []
        except json.JSONDecodeError:
            return []

    @image_ids.setter
    def image_ids(self, value: list[str]) -> None:
        self.image_ids_json = json.dumps(list(value), ensure_ascii=False)


engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)
