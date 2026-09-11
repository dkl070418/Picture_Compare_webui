from __future__ import annotations

from itsdangerous import BadSignature, URLSafeSerializer
from fastapi import Cookie, Depends, HTTPException, Request

from .config import settings

SESSION_COOKIE = "pc_session"
_serializer = URLSafeSerializer(settings.secret_key, salt="pc-session")


def make_session_token() -> str:
    return _serializer.dumps({"role": "admin"})


def is_valid_session(token: str | None) -> bool:
    if not token:
        return False
    try:
        data = _serializer.loads(token)
        return isinstance(data, dict) and data.get("role") == "admin"
    except BadSignature:
        return False


def get_session_token(
    pc_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> str | None:
    return pc_session


def require_admin(
    pc_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> None:
    if not is_valid_session(pc_session):
        raise HTTPException(status_code=401, detail="未登录")


def optional_admin(
    pc_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> bool:
    return is_valid_session(pc_session)
