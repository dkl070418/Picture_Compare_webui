"""Set or change the admin password stored in data/config.json.

Usage:
  python scripts/set_password.py            # prompt (hidden)
  python scripts/set_password.py "新口令"

If the ADMIN_PASSWORD environment variable is set at server start,
it overrides this file every time — clear the env var to use config.json.
"""
from __future__ import annotations

import getpass
import json
import sys
from pathlib import Path

from argon2 import PasswordHasher

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import CONFIG_PATH, DATA_DIR, ensure_dirs  # noqa: E402


def main() -> None:
    if len(sys.argv) > 1:
        password = sys.argv[1]
    else:
        password = getpass.getpass("新的管理员口令: ")
        confirm = getpass.getpass("再输入一次: ")
        if password != confirm:
            print("两次输入不一致，未修改。", file=sys.stderr)
            sys.exit(1)
    if not password:
        print("口令不能为空。", file=sys.stderr)
        sys.exit(1)

    ensure_dirs()
    cfg = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cfg = {}

    cfg["password_hash"] = PasswordHasher().hash(password)
    # keep secret_key if present
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"已写入 {CONFIG_PATH}")
    print("重启服务后生效。若启动时设置了 ADMIN_PASSWORD 环境变量，以环境变量为准。")


if __name__ == "__main__":
    main()
