from __future__ import annotations

import json
import os
import secrets
from pathlib import Path

from argon2 import PasswordHasher

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("PICTURE_COMPARE_DATA", ROOT / "data")).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
THUMB_DIR = DATA_DIR / "thumbs"
CONFIG_PATH = DATA_DIR / "config.json"
DB_PATH = DATA_DIR / "app.db"
STATIC_DIR = Path(__file__).resolve().parent / "static"

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}
THUMB_MAX = 640

_ph = PasswordHasher()


def ensure_dirs() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)


def _load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {}


def _save_config(cfg: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


class Settings:
    def __init__(self) -> None:
        ensure_dirs()
        cfg = _load_config()
        changed = False

        env_password = os.environ.get("ADMIN_PASSWORD", "").strip()
        self.password_from_env = bool(env_password)
        if env_password:
            self.password_hash = _ph.hash(env_password)
            self.generated_password = None
        elif cfg.get("password_hash"):
            self.password_hash = cfg["password_hash"]
            self.generated_password = None
        else:
            raw = secrets.token_urlsafe(12)
            self.password_hash = _ph.hash(raw)
            self.generated_password = raw
            cfg["password_hash"] = self.password_hash
            changed = True

        secret = os.environ.get("SECRET_KEY", "").strip() or cfg.get("secret_key")
        if not secret:
            secret = secrets.token_hex(32)
            cfg["secret_key"] = secret
            changed = True
        self.secret_key = secret

        self.port = int(os.environ.get("PORT", cfg.get("port", 8765)))
        self.host = os.environ.get("HOST", cfg.get("host", "0.0.0.0"))
        self.db_url = f"sqlite:///{DB_PATH.as_posix()}"

        if changed:
            _save_config(cfg)

    def verify_password(self, password: str) -> bool:
        try:
            return _ph.verify(self.password_hash, password)
        except Exception:
            return False

    def set_password(self, password: str) -> None:
        """Update runtime hash and persist to config.json."""
        self.password_hash = _ph.hash(password)
        self.generated_password = None
        cfg = _load_config()
        cfg["password_hash"] = self.password_hash
        if not cfg.get("secret_key"):
            cfg["secret_key"] = self.secret_key
        _save_config(cfg)


settings = Settings()
