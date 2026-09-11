"""Seed local server with fixture images, a group, and a share link."""
from __future__ import annotations

import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "test_fixtures"
BASE = "http://127.0.0.1:8765"
PASSWORD = "admin123"


def main() -> None:
    client = httpx.Client(base_url=BASE, timeout=30.0)
    r = client.post("/api/login", json={"password": PASSWORD})
    r.raise_for_status()

    # clear? just upload new ones
    uploaded = []
    notes = {
        "A效果_红.png": "A效果",
        "B效果_蓝.png": "B效果",
        "C效果_绿.png": "C效果",
        "D效果_橙.jpg": "D效果",
        "E_仅后台.png": "仅后台可见",
        "横屏_A.jpg": "横屏A",
        "横屏_B.jpg": "横屏B",
    }
    for path in sorted(FIXTURES.iterdir()):
        if not path.is_file():
            continue
        note = notes.get(path.name, path.stem)
        files = {"file": (path.name, path.read_bytes(), "application/octet-stream")}
        resp = client.post("/api/admin/images", files=files, data={"note": note})
        resp.raise_for_status()
        img = resp.json()
        uploaded.append(img)
        print("uploaded", path.name, img["id"], img["note"])

    # group with A B C
    group_ids = [uploaded[i]["id"] for i in range(min(3, len(uploaded)))]
    r = client.post("/api/admin/groups", json={"name": "效果组-ABC", "image_ids": group_ids})
    r.raise_for_status()
    print("group", r.json()["id"])

    # share A+B only (default first two)
    share_ids = [uploaded[0]["id"], uploaded[1]["id"]]
    # also include landscape if present
    for img in uploaded:
        if img["filename"].startswith("横屏"):
            share_ids.append(img["id"])
    r = client.post(
        "/api/admin/shares",
        json={"title": "前端测试分享", "image_ids": share_ids},
    )
    r.raise_for_status()
    share = r.json()
    print("SHARE_URL", BASE + share["url"])
    print("SHARE_ID", share["id"])
    print("IMAGES", [(i["id"], i["note"]) for i in uploaded])


if __name__ == "__main__":
    main()
