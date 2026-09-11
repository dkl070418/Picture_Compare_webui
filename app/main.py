from __future__ import annotations

import io
import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image as PILImage
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from .auth import SESSION_COOKIE, make_session_token, optional_admin, require_admin
from .config import (
    ALLOWED_EXT,
    ALLOWED_MIME,
    MAX_UPLOAD_BYTES,
    STATIC_DIR,
    THUMB_DIR,
    THUMB_MAX,
    UPLOAD_DIR,
    settings,
)
from .models import ComparisonGroup, Image, Share, SessionLocal, init_db

app = FastAPI(title="Image Compare Share", docs_url="/api/docs", redoc_url=None)


@app.on_event("startup")
def _startup() -> None:
    init_db()
    if settings.generated_password:
        print("\n" + "=" * 48)
        print("  管理员口令（请保存，仅本次首次生成显示）:")
        print(f"  {settings.generated_password}")
        print("=" * 48 + "\n")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _image_dict(img: Image) -> dict[str, Any]:
    return {
        "id": img.id,
        "filename": img.filename,
        "note": img.note,
        "width": img.width,
        "height": img.height,
        "created_at": img.created_at.isoformat() if img.created_at else None,
        "url": f"/files/{img.id}",
        "thumb_url": f"/thumbs/{img.id}",
    }


def _group_dict(g: ComparisonGroup) -> dict[str, Any]:
    return {
        "id": g.id,
        "name": g.name,
        "image_ids": g.image_ids,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }


def _share_dict(s: Share, *, include_url: bool = True) -> dict[str, Any]:
    data = {
        "id": s.id,
        "title": s.title,
        "image_ids": s.image_ids,
        "revoked": s.revoked,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
    if include_url:
        data["url"] = f"/s/{s.id}"
    return data


def _valid_image_ids(db: SASession, ids: list[str]) -> list[str]:
    if not ids:
        return []
    rows = db.scalars(select(Image.id).where(Image.id.in_(ids))).all()
    found = set(rows)
    return [i for i in ids if i in found]


# ---------- Auth ----------


class LoginBody(BaseModel):
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=4, max_length=128)


@app.post("/api/login")
def login(body: LoginBody, response: Response):
    if not settings.verify_password(body.password):
        raise HTTPException(status_code=401, detail="口令错误")
    response = JSONResponse({"ok": True})
    response.set_cookie(
        SESSION_COOKIE,
        make_session_token(),
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,
    )
    return response


@app.post("/api/admin/password")
def change_password(
    body: ChangePasswordBody,
    _: None = Depends(require_admin),
):
    if not settings.verify_password(body.current_password):
        raise HTTPException(status_code=401, detail="当前口令不正确")
    if body.new_password != body.new_password.strip():
        raise HTTPException(status_code=400, detail="新口令不能以空白字符开头或结尾")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=400, detail="新口令不能与当前口令相同")
    settings.set_password(body.new_password)
    note = None
    if settings.password_from_env or os.environ.get("ADMIN_PASSWORD", "").strip():
        note = (
            "口令已更新并写入配置文件。"
            "若启动环境设置了 ADMIN_PASSWORD，重启后会覆盖本次修改，请去掉该环境变量。"
        )
    return {"ok": True, "note": note}


@app.post("/api/logout")
def logout(response: Response):
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE)
    return response


@app.get("/api/me")
def me(authenticated: bool = Depends(optional_admin)):
    return {"authenticated": authenticated}


# ---------- Admin: images ----------


@app.get("/api/admin/images")
def list_images(db: SASession = Depends(get_db), _: None = Depends(require_admin)):
    rows = db.scalars(select(Image).order_by(Image.created_at.desc())).all()
    return [_image_dict(i) for i in rows]


def _save_upload(file: UploadFile, note: str, db: SASession) -> Image:
    filename = file.filename or "upload"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext or filename}")
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime and mime not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail=f"不支持的 MIME: {mime}")

    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="文件超过 50MB 限制")
    if not data:
        raise HTTPException(status_code=400, detail="空文件")

    img_id = uuid.uuid4().hex
    stored_name = f"{img_id}{ext}"
    dest = UPLOAD_DIR / stored_name
    dest.write_bytes(data)

    width = height = 0
    try:
        with PILImage.open(io.BytesIO(data)) as im:
            im.load()
            width, height = im.size
            thumb = im.convert("RGB")
            thumb.thumbnail((THUMB_MAX, THUMB_MAX))
            thumb_path = THUMB_DIR / f"{img_id}.jpg"
            thumb.save(thumb_path, "JPEG", quality=82, optimize=True)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        (THUMB_DIR / f"{img_id}.jpg").unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"无法解析图片: {exc}") from exc

    row = Image(
        id=img_id,
        filename=filename,
        stored_name=stored_name,
        note=note or "",
        width=width,
        height=height,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.post("/api/admin/images")
def upload_images(
    file: UploadFile = File(...),
    note: str = Form(""),
    db: SASession = Depends(get_db),
    _: None = Depends(require_admin),
):
    row = _save_upload(file, note, db)
    return _image_dict(row)


class ImagePatch(BaseModel):
    note: str | None = None


@app.patch("/api/admin/images/{image_id}")
def patch_image(
    image_id: str,
    body: ImagePatch,
    db: SASession = Depends(get_db),
    _: None = Depends(require_admin),
):
    row = db.get(Image, image_id)
    if not row:
        raise HTTPException(status_code=404, detail="图片不存在")
    if body.note is not None:
        row.note = body.note
    db.commit()
    db.refresh(row)
    return _image_dict(row)


@app.delete("/api/admin/images/{image_id}")
def delete_image(
    image_id: str,
    db: SASession = Depends(get_db),
    _: None = Depends(require_admin),
):
    row = db.get(Image, image_id)
    if not row:
        raise HTTPException(status_code=404, detail="图片不存在")
    (UPLOAD_DIR / row.stored_name).unlink(missing_ok=True)
    (THUMB_DIR / f"{row.id}.jpg").unlink(missing_ok=True)
    db.delete(row)

    for g in db.scalars(select(ComparisonGroup)).all():
        ids = g.image_ids
        if image_id in ids:
            g.image_ids = [x for x in ids if x != image_id]
            db.add(g)
    for s in db.scalars(select(Share)).all():
        ids = s.image_ids
        if image_id in ids:
            s.image_ids = [x for x in ids if x != image_id]
            db.add(s)
    db.commit()
    return {"ok": True}


# ---------- Admin: groups ----------


class GroupBody(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    image_ids: list[str] = Field(default_factory=list)


class GroupPatch(BaseModel):
    name: str | None = None
    image_ids: list[str] | None = None


@app.get("/api/admin/groups")
def list_groups(db: SASession = Depends(get_db), _: None = Depends(require_admin)):
    rows = db.scalars(select(ComparisonGroup).order_by(ComparisonGroup.created_at.desc())).all()
    return [_group_dict(g) for g in rows]


@app.post("/api/admin/groups")
def create_group(
    body: GroupBody,
    db: SASession = Depends(get_db),
    _: None = Depends(require_admin),
):
    ids = _valid_image_ids(db, body.image_ids)
    g = ComparisonGroup(name=body.name.strip())
    g.image_ids = ids
    db.add(g)
    db.commit()
    db.refresh(g)
    return _group_dict(g)


@app.patch("/api/admin/groups/{group_id}")
def patch_group(
    group_id: str,
    body: GroupPatch,
    db: SASession = Depends(get_db),
    _: None = Depends(require_admin),
):
    g = db.get(ComparisonGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="对比组不存在")
    if body.name is not None:
        g.name = body.name.strip() or g.name
    if body.image_ids is not None:
        g.image_ids = _valid_image_ids(db, body.image_ids)
    db.commit()
    db.refresh(g)
    return _group_dict(g)


@app.delete("/api/admin/groups/{group_id}")
def delete_group(
    group_id: str,
    db: SASession = Depends(get_db),
    _: None = Depends(require_admin),
):
    g = db.get(ComparisonGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="对比组不存在")
    db.delete(g)
    db.commit()
    return {"ok": True}


# ---------- Admin: shares ----------


class ShareBody(BaseModel):
    title: str = ""
    image_ids: list[str] = Field(default_factory=list)


class SharePatch(BaseModel):
    title: str | None = None
    image_ids: list[str] | None = None
    revoked: bool | None = None


@app.get("/api/admin/shares")
def list_shares(db: SASession = Depends(get_db), _: None = Depends(require_admin)):
    rows = db.scalars(select(Share).order_by(Share.created_at.desc())).all()
    return [_share_dict(s) for s in rows]


@app.post("/api/admin/shares")
def create_share(
    body: ShareBody,
    db: SASession = Depends(get_db),
    _: None = Depends(require_admin),
):
    ids = _valid_image_ids(db, body.image_ids)
    if not ids:
        raise HTTPException(status_code=400, detail="至少选择一张图片")
    s = Share(title=(body.title or "").strip())
    s.image_ids = ids
    db.add(s)
    db.commit()
    db.refresh(s)
    return _share_dict(s)


@app.patch("/api/admin/shares/{share_id}")
def patch_share(
    share_id: str,
    body: SharePatch,
    db: SASession = Depends(get_db),
    _: None = Depends(require_admin),
):
    s = db.get(Share, share_id)
    if not s:
        raise HTTPException(status_code=404, detail="分享不存在")
    if body.title is not None:
        s.title = body.title.strip()
    if body.image_ids is not None:
        ids = _valid_image_ids(db, body.image_ids)
        if not ids:
            raise HTTPException(status_code=400, detail="至少保留一张图片")
        s.image_ids = ids
    if body.revoked is not None:
        s.revoked = body.revoked
    db.commit()
    db.refresh(s)
    return _share_dict(s)


@app.delete("/api/admin/shares/{share_id}")
def delete_share(
    share_id: str,
    db: SASession = Depends(get_db),
    _: None = Depends(require_admin),
):
    s = db.get(Share, share_id)
    if not s:
        raise HTTPException(status_code=404, detail="分享不存在")
    db.delete(s)
    db.commit()
    return {"ok": True}


# ---------- Public share ----------


@app.get("/api/share/{share_id}")
def get_share(share_id: str, db: SASession = Depends(get_db)):
    s = db.get(Share, share_id)
    if not s or s.revoked:
        raise HTTPException(status_code=404, detail="分享不存在或已撤销")
    ids = s.image_ids
    if not ids:
        raise HTTPException(status_code=404, detail="分享内容为空")
    rows = {
        r.id: r
        for r in db.scalars(select(Image).where(Image.id.in_(ids))).all()
    }
    images = [_image_dict(rows[i]) for i in ids if i in rows]
    if not images:
        raise HTTPException(status_code=404, detail="分享图片已失效")
    return {
        "id": s.id,
        "title": s.title,
        "images": images,
    }


def _image_accessible(db: SASession, image_id: str, is_admin: bool) -> Image | None:
    row = db.get(Image, image_id)
    if not row:
        return None
    if is_admin:
        return row
    shares = db.scalars(
        select(Share).where(Share.revoked.is_(False))
    ).all()
    for s in shares:
        if image_id in s.image_ids:
            return row
    return None


@app.get("/files/{image_id}")
def serve_file(
    image_id: str,
    db: SASession = Depends(get_db),
    is_admin: bool = Depends(optional_admin),
):
    row = _image_accessible(db, image_id, is_admin)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    path = UPLOAD_DIR / row.stored_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    media = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media, filename=row.filename)


@app.get("/thumbs/{image_id}")
def serve_thumb(
    image_id: str,
    db: SASession = Depends(get_db),
    is_admin: bool = Depends(optional_admin),
):
    row = _image_accessible(db, image_id, is_admin)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    path = THUMB_DIR / f"{row.id}.jpg"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="image/jpeg")


# ---------- Pages ----------


def _read_static(name: str) -> str:
    path = STATIC_DIR / name
    if not path.exists():
        return f"<h1>missing {name}</h1>"
    return path.read_text(encoding="utf-8")


@app.get("/", response_class=HTMLResponse)
def admin_page():
    return HTMLResponse(_read_static("admin.html"))


@app.get("/s/{share_id}", response_class=HTMLResponse)
def share_page(share_id: str):
    html = _read_static("share.html")
    # Safe JS string injection (json + prevent </script> breakout)
    token = json.dumps(share_id).replace("<", "\\u003c").replace(">", "\\u003e")
    html = html.replace(
        "window.__SHARE_ID__ = null;",
        f"window.__SHARE_ID__ = {token};",
        1,
    )
    return HTMLResponse(html)


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
