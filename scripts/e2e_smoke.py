from __future__ import annotations

import io
import os
import sys
from pathlib import Path

# Ensure project root on path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Isolate data dir for tests
os.environ["ADMIN_PASSWORD"] = "test-pass-123"
os.environ["SECRET_KEY"] = "test-secret-key-not-for-prod"
TEST_DATA = ROOT / "data_test_e2e"
os.environ["PICTURE_COMPARE_DATA"] = str(TEST_DATA)

from PIL import Image as PILImage  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

DATA_DIR = TEST_DATA
UPLOAD_DIR = DATA_DIR / "uploads"
THUMB_DIR = DATA_DIR / "thumbs"


def reset_data():
    import shutil

    # Close any prior engine handles if modules were loaded
    for mod in list(sys.modules):
        if mod == "app" or mod.startswith("app."):
            sys.modules.pop(mod, None)

    if DATA_DIR.exists():
        try:
            shutil.rmtree(DATA_DIR)
        except PermissionError:
            # Best-effort on Windows file locks
            for p in DATA_DIR.rglob("*"):
                try:
                    if p.is_file():
                        p.unlink()
                except OSError:
                    pass
            try:
                shutil.rmtree(DATA_DIR, ignore_errors=True)
            except OSError:
                pass
    for p in (UPLOAD_DIR, THUMB_DIR):
        p.mkdir(parents=True, exist_ok=True)


def make_png_bytes(color=(220, 40, 40), size=(320, 240)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def main():
    reset_data()

    from app.main import app
    from app.models import init_db

    init_db()
    client = TestClient(app)

    results = []

    def check(name, cond, detail=""):
        results.append((name, bool(cond), detail))
        status = "PASS" if cond else "FAIL"
        print(f"[{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    # Auth
    r = client.get("/api/me")
    check("GET /api/me unauth", r.status_code == 200 and r.json()["authenticated"] is False, r.text)

    r = client.post("/api/login", json={"password": "wrong"})
    check("login wrong password 401", r.status_code == 401, r.text)

    r = client.post("/api/login", json={"password": "test-pass-123"})
    check("login ok", r.status_code == 200, r.text)

    r = client.get("/api/me")
    check("me authenticated", r.json().get("authenticated") is True, r.text)

    # Pages
    r = client.get("/")
    check("admin page html", r.status_code == 200 and "图片对比" in r.text, r.text[:200])

    # Upload
    files = {"file": ("a_red.png", make_png_bytes((220, 40, 40)), "image/png")}
    r = client.post("/api/admin/images", files=files, data={"note": "A效果"})
    check("upload image A", r.status_code == 200 and r.json()["note"] == "A效果", r.text)
    img_a = r.json()

    files = {"file": ("b_blue.png", make_png_bytes((40, 80, 220)), "image/png")}
    r = client.post("/api/admin/images", files=files, data={"note": "B效果"})
    check("upload image B", r.status_code == 200, r.text)
    img_b = r.json()

    files = {"file": ("c_green.png", make_png_bytes((40, 180, 80)), "image/png")}
    r = client.post("/api/admin/images", files=files, data={"note": "C效果"})
    check("upload image C", r.status_code == 200, r.text)
    img_c = r.json()

    r = client.get("/api/admin/images")
    check("list images", r.status_code == 200 and len(r.json()) == 3, r.text)

    # Patch note
    r = client.patch(f"/api/admin/images/{img_a['id']}", json={"note": "A效果-改"})
    check("patch note", r.json().get("note") == "A效果-改", r.text)

    # Group
    r = client.post(
        "/api/admin/groups",
        json={"name": "皮肤对比", "image_ids": [img_a["id"], img_b["id"], img_c["id"]]},
    )
    check("create group", r.status_code == 200 and len(r.json()["image_ids"]) == 3, r.text)
    group = r.json()

    r = client.get("/api/admin/groups")
    check("list groups", len(r.json()) == 1, r.text)

    # Share subset: only A and B
    r = client.post(
        "/api/admin/shares",
        json={"title": "给客户的对比", "image_ids": [img_a["id"], img_b["id"]]},
    )
    check("create share", r.status_code == 200, r.text)
    share = r.json()
    share_id = share["id"]

    # Public share API
    r = client.get(f"/api/share/{share_id}")
    data = r.json()
    check(
        "public share has 2 images",
        r.status_code == 200 and len(data.get("images", [])) == 2,
        r.text,
    )
    check("share image order A then B", data["images"][0]["id"] == img_a["id"] and data["images"][1]["id"] == img_b["id"])

    # Share page
    r = client.get(f"/s/{share_id}")
    check("share page html", r.status_code == 200 and share_id in r.text and "并排" in r.text)

    # Unauth client can fetch shared files
    anon = TestClient(app)
    r = anon.get(f"/files/{img_a['id']}")
    check("anon can fetch shared image A", r.status_code == 200 and len(r.content) > 100)

    r = anon.get(f"/thumbs/{img_a['id']}")
    check("anon can fetch thumb A", r.status_code == 200)

    r = anon.get(f"/files/{img_c['id']}")
    check("anon CTR image blocked if only in groups not shares", r.status_code == 404, f"status={r.status_code}")

    # Admin can still see C
    r = client.get(f"/files/{img_c['id']}")
    check("admin can fetch unshared image C", r.status_code == 200)

    # Admin APIs require auth
    r = anon.get("/api/admin/images")
    check("anon admin images 401", r.status_code == 401)

    # Revoke share
    r = client.patch(f"/api/admin/shares/{share_id}", json={"revoked": True})
    check("revoke share", r.json()["revoked"] is True, r.text)

    r = anon.get(f"/api/share/{share_id}")
    check("revoked share 404", r.status_code == 404)

    r = anon.get(f"/files/{img_a['id']}")
    check("anon file after revoke blocked", r.status_code == 404)

    # New share and delete image cleanup
    r = client.post(
        "/api/admin/shares",
        json={"title": "再分享", "image_ids": [img_a["id"], img_b["id"]]},
    )
    share2 = r.json()
    r = client.delete(f"/api/admin/images/{img_b['id']}")
    check("delete image", r.status_code == 200)
    r = client.get(f"/api/share/{share2['id']}")
    check("share after image delete has 1 image", len(r.json()["images"]) == 1, r.text)

    # Logout
    r = client.post("/api/logout")
    check("logout", r.status_code == 200)
    r = client.get("/api/admin/images")
    check("after logout 401", r.status_code == 401)

    failed = [n for n, ok, _ in results if not ok]
    print("-" * 40)
    print(f"Total {len(results)}, failed {len(failed)}")
    if failed:
        print("Failed:", failed)
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
