"""Live HTTP check: start uvicorn in-thread, exercise golden path."""
from __future__ import annotations

import io
import os
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ["ADMIN_PASSWORD"] = "admin123"
os.environ["SECRET_KEY"] = "live-secret"
os.environ["PICTURE_COMPARE_DATA"] = str(ROOT / "data_live_check")

import httpx
from PIL import Image as PILImage
import uvicorn

from app.main import app
from app.models import init_db

init_db()

config = uvicorn.Config(app, host="127.0.0.1", port=8766, log_level="warning")
server = uvicorn.Server(config)
thread = threading.Thread(target=server.run, daemon=True)
thread.start()

# wait for server
base = "http://127.0.0.1:8766"
for _ in range(50):
    try:
        httpx.get(base + "/api/me", timeout=0.5)
        break
    except Exception:
        time.sleep(0.1)

ok = 0
fail = 0


def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"[PASS] {name}")
    else:
        fail += 1
        print(f"[FAIL] {name} — {detail}")


client = httpx.Client(base_url=base, timeout=10.0)

r = client.post("/api/login", json={"password": "wrong"})
check("wrong password 401", r.status_code == 401)

r = client.post("/api/login", json={"password": "admin123"})
check("login", r.status_code == 200, r.text)

r = client.get("/api/me")
check("me auth", r.json().get("authenticated") is True)

buf = io.BytesIO()
PILImage.new("RGB", (500, 400), (220, 50, 50)).save(buf, format="PNG")
files = {"file": ("live_a.png", buf.getvalue(), "image/png")}
r = client.post("/api/admin/images", files=files, data={"note": "A效果"})
check("upload A", r.status_code == 200, r.text)
img_a = r.json()

buf = io.BytesIO()
PILImage.new("RGB", (500, 400), (50, 50, 220)).save(buf, format="PNG")
files = {"file": ("live_b.png", buf.getvalue(), "image/png")}
r = client.post("/api/admin/images", files=files, data={"note": "B效果"})
check("upload B", r.status_code == 200, r.text)
img_b = r.json()

r = client.post(
    "/api/admin/shares",
    json={"title": "演示", "image_ids": [img_a["id"], img_b["id"]]},
)
share = r.json()
check("create share", r.status_code == 200 and share.get("id"), r.text)

r = client.get(f"/s/{share['id']}")
check("share page", r.status_code == 200 and "share.js" in r.text)

r = client.get(f"/api/share/{share['id']}")
check("share api 2 imgs", len(r.json().get("images", [])) == 2, r.text)

r = client.get(f"/files/{img_a['id']}")
check("public file", r.status_code == 200 and len(r.content) > 100)

r = client.get("/")
check("admin html", r.status_code == 200 and "admin.js" in r.text)

r = client.get("/static/share.css")
check("share css", r.status_code == 200 and len(r.text) > 500)

print("-" * 40)
print(f"PASS={ok} FAIL={fail}")
sys.exit(1 if fail else 0)
