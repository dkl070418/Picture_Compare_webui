"""Frontend E2E: seed fixtures, drive admin + share UI with Playwright."""
from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ["ADMIN_PASSWORD"] = "admin123"
os.environ["SECRET_KEY"] = "fe-secret"
DATA_DIR = ROOT / "data_fe_e2e"
os.environ["PICTURE_COMPARE_DATA"] = str(DATA_DIR)

# Reset data dir BEFORE importing app (engine/settings bind to this path)
import shutil

if DATA_DIR.exists():
    shutil.rmtree(DATA_DIR, ignore_errors=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

import httpx
import uvicorn
from PIL import Image as PILImage

from app.main import app
from app.models import init_db

SHOTS = ROOT / "output" / "playwright"
SHOTS.mkdir(parents=True, exist_ok=True)

FIXTURES = ROOT / "test_fixtures"
BASE = "http://127.0.0.1:8770"


def start_server() -> uvicorn.Server:
    init_db()
    config = uvicorn.Config(app, host="127.0.0.1", port=8770, log_level="warning")
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(60):
        try:
            httpx.get(BASE + "/api/me", timeout=0.3)
            return server
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("server failed to start")


def seed() -> str:
    """Upload fixtures via HTTP; return share id for A+B (+ landscape)."""
    client = httpx.Client(base_url=BASE, timeout=30.0)
    client.post("/api/login", json={"password": "admin123"}).raise_for_status()

    notes = {
        "A效果_红.png": "A效果",
        "B效果_蓝.png": "B效果",
        "C效果_绿.png": "C效果",
        "D效果_橙.jpg": "D效果",
        "E_仅后台.png": "仅后台可见",
        "横屏_A.jpg": "横屏A",
        "横屏_B.jpg": "横屏B",
    }
    uploaded = []
    for path in sorted(FIXTURES.iterdir()):
        if not path.is_file():
            continue
        files = {"file": (path.name, path.read_bytes(), "image/png")}
        r = client.post(
            "/api/admin/images",
            files=files,
            data={"note": notes.get(path.name, path.stem)},
        )
        r.raise_for_status()
        uploaded.append(r.json())
        print("seeded", path.name)

    # share: A, B, 横屏A, 横屏B — not C/D/E
    share_ids = []
    for img in uploaded:
        if img["note"] in ("A效果", "B效果", "横屏A", "横屏B"):
            share_ids.append(img["id"])
    r = client.post(
        "/api/admin/shares",
        json={"title": "前端测试分享", "image_ids": share_ids},
    )
    r.raise_for_status()
    share = r.json()
    print("share", share["id"], "images", len(share["image_ids"]))
    return share["id"]


def run_ui(share_id: str) -> int:
    from playwright.sync_api import sync_playwright

    results: list[tuple[str, bool, str]] = []

    def check(name: str, cond: bool, detail: str = "") -> None:
        results.append((name, bool(cond), detail))
        print(("[PASS] " if cond else "[FAIL] ") + name + (f" — {detail}" if detail and not cond else ""))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        console_errors: list[str] = []
        page.on("pageerror", lambda err: console_errors.append(str(err)))
        page.on(
            "console",
            lambda msg: console_errors.append(f"console.{msg.type}: {msg.text}")
            if msg.type == "error"
            else None,
        )

        # ----- Admin login -----
        page.goto(BASE + "/", wait_until="networkidle")
        check("admin shows login", page.locator("#login-view").is_visible())
        page.fill("#login-password", "admin123")
        page.click("#login-form button[type=submit]")
        page.wait_for_selector("#app-view:not(.hidden)", timeout=5000)
        check("admin app visible after login", page.locator("#app-view").is_visible())
        page.wait_for_selector(".card", timeout=5000)
        cards = page.locator("#library-grid .card")
        check("library has fixture cards", cards.count() >= 5, f"count={cards.count()}")
        page.screenshot(path=str(SHOTS / "01_admin_library.png"), full_page=True)

        # Select first two cards
        cards.nth(0).locator(".card-check").click()
        cards.nth(1).locator(".card-check").click()
        check(
            "selection enables share button",
            page.locator("#btn-share-selected").is_enabled(),
        )
        page.screenshot(path=str(SHOTS / "02_admin_selected.png"), full_page=True)

        # Edit note
        cards.nth(0).locator(".card-note").click()
        page.wait_for_timeout(200)
        note_input = page.locator("#library-grid .card-note input")
        if note_input.count():
            note_input.fill("A效果-UI改")
            note_input.press("Enter")
            page.wait_for_timeout(400)
            check("note edited via UI", "A效果-UI改" in page.content())
        else:
            check("note edit input opened", False)

        # Change password via UI
        page.click("#btn-change-password")
        page.wait_for_selector("#password-dialog[open]", timeout=3000)
        check("password dialog opens", True)
        page.fill("#pw-current", "admin123")
        page.fill("#pw-new", "admin456")
        page.fill("#pw-confirm", "admin456")
        page.click("#password-form button[type=submit]")
        page.wait_for_timeout(500)
        check(
            "password dialog closed after save",
            not page.locator("#password-dialog").evaluate("el => el.open"),
        )
        # restore original password so later steps / re-runs stay stable
        page.click("#btn-change-password")
        page.wait_for_selector("#password-dialog[open]")
        page.fill("#pw-current", "admin456")
        page.fill("#pw-new", "admin123")
        page.fill("#pw-confirm", "admin123")
        page.click("#password-form button[type=submit]")
        page.wait_for_timeout(500)
        check(
            "password restored to admin123",
            not page.locator("#password-dialog").evaluate("el => el.open"),
        )

        # Groups tab
        page.click('.nav-item[data-tab="groups"]')
        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / "03_admin_groups_tab.png"), full_page=True)
        check("groups tab active", page.locator("#tab-groups").is_visible())

        # Shares tab
        page.click('.nav-item[data-tab="shares"]')
        page.wait_for_timeout(300)
        check("shares list rendered", page.locator("#shares-list .list-card").count() >= 1)
        page.screenshot(path=str(SHOTS / "04_admin_shares.png"), full_page=True)

        # ----- Share page desktop -----
        page.goto(f"{BASE}/s/{share_id}", wait_until="networkidle")
        page.wait_for_selector("#app:not(.hidden)", timeout=5000)
        check("share app visible", page.locator("#app").is_visible())
        check("title rendered", "前端测试分享" in page.inner_text("#share-title"))
        # images loaded
        page.wait_for_function(
            "() => { const a=document.querySelector('#img-a'); return a && a.complete && a.naturalWidth>0; }",
            timeout=8000,
        )
        page.wait_for_function(
            "() => { const b=document.querySelector('#img-b'); return b && b.complete && b.naturalWidth>0; }",
            timeout=8000,
        )
        check("image A loaded", True)
        check("default mode is split", "mode-split" in page.get_attribute("#stage", "class"))
        thumbs_a = page.locator("#thumbs-a .thumb").count()
        check("only shared images in picker A", thumbs_a == 4, f"count={thumbs_a}")
        page.screenshot(path=str(SHOTS / "05_share_split_desktop.png"))

        # Switch to wipe
        page.click('.mode[data-mode="wipe"]')
        page.wait_for_timeout(200)
        cls = page.get_attribute("#stage", "class")
        check("wipe mode active", "mode-wipe" in (cls or ""), cls or "")
        check("wipe handle visible", page.locator("#wipe-handle").is_visible())
        page.screenshot(path=str(SHOTS / "06_share_wipe_desktop.png"))

        # Drag wipe handle
        box = page.locator("#stage").bounding_box()
        handle = page.locator("#wipe-handle").bounding_box()
        if box and handle:
            page.mouse.move(handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2)
            page.mouse.down()
            page.mouse.move(box["x"] + box["width"] * 0.25, handle["y"] + handle["height"] / 2, steps=8)
            page.mouse.up()
            page.wait_for_timeout(150)
            clip = page.eval_on_selector("#pane-b", "el => el.style.clipPath")
            check("wipe clip moved", "inset" in (clip or ""), clip or "")
            page.screenshot(path=str(SHOTS / "07_share_wipe_dragged.png"))

        # Fade mode
        page.click('.mode[data-mode="fade"]')
        page.wait_for_timeout(200)
        check("fade slider visible", page.locator("#fade-slider").is_visible())
        page.fill("#fade-range", "80")
        page.wait_for_timeout(100)
        opacity = page.eval_on_selector("#pane-b", "el => el.style.opacity")
        check("fade opacity applied", opacity == "0.8", f"opacity={opacity}")
        page.screenshot(path=str(SHOTS / "08_share_fade_desktop.png"))

        # Switch B image via thumb
        page.click('.mode[data-mode="split"]')
        page.wait_for_timeout(100)
        page.locator("#thumbs-b .thumb").nth(2).click()
        page.wait_for_timeout(400)
        tag_b = page.inner_text("#tag-b")
        check("B image switched by thumb", "横屏" in tag_b or "B" in tag_b, tag_b)

        # Keyboard mode switch
        page.keyboard.press("2")
        page.wait_for_timeout(150)
        check("keyboard 2 -> wipe", "mode-wipe" in (page.get_attribute("#stage", "class") or ""))

        # ----- Mobile portrait -----
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{BASE}/s/{share_id}", wait_until="networkidle")
        page.wait_for_selector("#app:not(.hidden)")
        page.wait_for_timeout(400)
        page.screenshot(path=str(SHOTS / "09_share_portrait_split.png"))
        page.click('.mode[data-mode="wipe"]')
        page.wait_for_timeout(200)
        clip = page.eval_on_selector("#pane-b", "el => el.style.clipPath")
        # portrait wipe uses top inset
        check("portrait wipe clip uses top inset", "inset(" in (clip or "") and "0 0 0" not in (clip or "").replace("inset(", ""), clip or "")
        page.screenshot(path=str(SHOTS / "10_share_portrait_wipe.png"))
        page.click('.mode[data-mode="fade"]')
        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / "11_share_portrait_fade.png"))

        # ----- Mobile landscape -----
        page.set_viewport_size({"width": 844, "height": 390})
        page.goto(f"{BASE}/s/{share_id}", wait_until="networkidle")
        page.wait_for_selector("#app:not(.hidden)")
        page.wait_for_timeout(400)
        page.click('.mode[data-mode="wipe"]')
        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / "12_share_landscape_wipe.png"))
        clip = page.eval_on_selector("#pane-b", "el => el.style.clipPath")
        check("landscape wipe has clip", "inset" in (clip or ""), clip or "")

        # Admin mobile
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(BASE + "/", wait_until="networkidle")
        # may still be logged in via cookie
        if page.locator("#login-view").is_visible():
            page.fill("#login-password", "admin123")
            page.click("#login-form button[type=submit]")
            page.wait_for_selector("#app-view:not(.hidden)")
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / "13_admin_mobile.png"), full_page=True)
        check("admin mobile nav visible", page.locator(".nav").is_visible())

        # Console errors related to our pages (ignore favicon)
        real_errors = [e for e in console_errors if "favicon" not in e.lower()]
        check("no page JS errors", len(real_errors) == 0, "; ".join(real_errors[:3]))

        browser.close()

    failed = [n for n, ok, _ in results if not ok]
    print("-" * 40)
    print(f"Total {len(results)}, failed {len(failed)}")
    if failed:
        print("Failed:", failed)
        return 1
    print("FRONTEND ALL PASS")
    print("Screenshots:", SHOTS)
    return 0


def main() -> None:
    start_server()
    share_id = seed()
    sys.exit(run_ui(share_id))


if __name__ == "__main__":
    main()
