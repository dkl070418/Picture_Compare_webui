---
feature: image-compare-share
status: delivered
updated: 2026-02-20
branch: feature/image-compare-share
commits: 36dd1b6..5df5a6b
---

# Image Compare Share

## Report

**What was built** — 基于嵌入式 Python 的本地图片对比分享服务。管理员口令登录后可在现代化后台上传图片、编辑备注、创建对比组，并勾选子集生成分享链接。分享页默认并排展示前两张图，支持并排 / 擦除滑杆 / 透明度叠加三种模式，仅暴露分享图集，适配手机横竖屏。原图仅在属于未撤销分享或管理员会话时可访问。

**Verification** — `scripts/e2e_smoke.py` 33/33 PASS（含 XSS 注入与 `$$` 回归）；`scripts/live_check.py` 11/11 PASS；`scripts/fe_e2e.py` Playwright 前端 23/23 PASS（登录、上传、选中、备注、分享页三模式、擦除拖拽、缩略图切换、竖屏/横屏、无 JS 错误）。复审确认 CRITICAL 修复有效。

**Journey log**
- 首版分享页 XSS：`replace` 原始 path 进 `<script>`；改为 `json.dumps` + `<`/`>` unicode 转义。
- `share.js` 漏定义 `$$` 导致模式切换全挂；API 冒烟测不出，需 Playwright 真浏览器。
- 竖屏并排缺 `grid-template-rows: 1fr 1fr`，行高被内容撑开；诊断脚本确认 626+626 后修复。
- 嵌入式 Python 会优先用用户 site-packages，缺 pydantic/click 时需对 `D:\TOOLS\embedded\python\python.exe -m pip` 补装。
- 沙箱禁止 `git worktree add`，feature 在主检出分支上落地。

## [S1] Problem

需要一个本地自托管的照片对比服务：

1. 管理员在后台上传照片、备注（如「A效果」）、把若干照片编成对比组。
2. 管理员可从图库中勾选若干照片生成分享链接。
3. 被分享者打开链接后看到干净的对比页：默认展示前两张图的对比，可只在这几张分享图之间切换，支持手机横竖屏。
4. 后台管理 UI 现代化；分享页极简、少干扰。

运行环境：Windows，嵌入式 Python `D:\TOOLS\embedded\python\python.exe`（3.12），已有 FastAPI/uvicorn/SQLAlchemy。

## [S2] Design

### 2.1 技术栈与运行

| 层 | 选择 |
|---|---|
| 运行时 | `D:\TOOLS\embedded\python\python.exe` |
| Web | FastAPI + Uvicorn |
| 元数据 | SQLite（`data/app.db`，SQLAlchemy 2.x） |
| 文件 | `data/uploads/<uuid>.<ext>` |
| 缩略图 | `data/thumbs/<uuid>.jpg`（Pillow 生成，服务端展示用） |
| 前端 | 单页静态 HTML/CSS/JS（无构建步骤），Admin / Share 两套页面 |
| 会话 | 签名 Cookie（itsdangerous），口令登录 |

启动：`start.ps1` → 激活/调用 embedded python → `uvicorn app.main:app --host 0.0.0.0 --port 8765`。

环境变量 / `data/config.json`：

- `ADMIN_PASSWORD`（或 config）：管理员口令；首次未设置时启动日志打印随机口令并写入 config。
- `SECRET_KEY`：Cookie 签名密钥（首次自动生成写入 config）。
- `PORT`：默认 8765。

### 2.2 数据模型

```
Image
  id: str (uuid4 hex)
  filename: str          # 上传时原始文件名
  stored_name: str       # 磁盘文件名
  note: str              # 备注，如「A效果」
  width, height: int
  created_at: datetime

ComparisonGroup          # 管理员侧「对比组」
  id: str
  name: str
  image_ids: list[str]   # 有序
  created_at: datetime

Share                    # 分享链接
  id: str                # token，URL 中 /s/{id}
  image_ids: list[str]   # 有序；仅这些图对分享页可见
  title: str             # 可选标题
  created_at: datetime
  revoked: bool
```

SQLite 表：`images`、`groups`、`shares`；有序 id 列表以 JSON 文本列存储。

### 2.3 鉴权

- `POST /api/login` `{password}` → 校验 argon2 哈希或明文（启动时按 config 存储形式）；成功则 `Set-Cookie: session=...; HttpOnly; SameSite=Lax`。
- `POST /api/logout` 清 Cookie。
- 管理 API：`/api/admin/*` 需有效 session，否则 401。
- 分享页与图片只读：`/s/{share_id}`、`/api/share/{share_id}`、`/files/{image_id}` **不要求登录**；但 `/files/{image_id}` 必须属于某个未撤销 share，或请求携带有效 admin session（防扫库）。实现：管理员可看全部；分享页通过 share 元数据拿到允许的 image id，前端只请求这些；`/files/{id}` 对无 session 请求检查「该图至少属于一个未撤销 share」。

### 2.4 API 契约

**Auth**

- `POST /api/login` → 204 + cookie / 401
- `POST /api/logout` → 204
- `GET /api/me` → `{authenticated: bool}`

**Admin**（需登录）

- `GET /api/admin/images` → `[{id, filename, note, url, thumb_url, width, height, created_at}]`
- `POST /api/admin/images` multipart `file` + form `note` → 单文件；可循环多文件
- `PATCH /api/admin/images/{id}` `{note}` → 更新备注
- `DELETE /api/admin/images/{id}` → 删除文件与记录；从 group/share 中移除引用
- `GET /api/admin/groups` → `[{id, name, image_ids, created_at}]`
- `POST /api/admin/groups` `{name, image_ids}`
- `PATCH /api/admin/groups/{id}` `{name?, image_ids?}`
- `DELETE /api/admin/groups/{id}`
- `GET /api/admin/shares` → `[{id, title, image_ids, created_at, revoked, url}]`
- `POST /api/admin/shares` `{title?, image_ids}` → `{id, url}`
- `PATCH /api/admin/shares/{id}` `{title?, image_ids?, revoked?}`
- `DELETE /api/admin/shares/{id}`

**Share**（公开）

- `GET /api/share/{share_id}` → `{id, title, images: [{id, note, url, thumb_url, width, height}]}`；revoked 或不存在 → 404
- `GET /s/{share_id}` → HTML 分享页
- `GET /files/{image_id}` → 原图；`GET /thumbs/{image_id}` → 缩略图

**Pages**

- `GET /` → 管理后台（未登录显示登录框）
- `GET /s/{share_id}` → 分享对比页

### 2.5 管理后台 UI

风格锚点：现代工具类 SaaS 后台（Linear / Vercel Dashboard 气质）——深色侧栏 + 浅色内容区、克制阴影、圆角 10px、Inter/系统字体。

- 布局：左侧导航（图库 / 对比组 / 分享），右侧内容。
- 图库：网格卡片（缩略图 + 备注角标）；多选 checkbox；顶栏「新建对比组」「生成分享」「删除」。
- 上传：拖拽区 + 文件选择；上传后可就地编辑备注。
- 对比组列表：名称、图数、缩略图条；可编辑。
- 分享列表：标题、图数、复制链接、撤销、删除。
- 响应式：窄屏导航折叠为顶栏。

### 2.6 分享对比页 UI

风格锚点：照片查看器——近黑背景 `#0a0a0a`，前景字 `#f5f5f5`，accent 仅用于激活态 `#5b8def`。零侧栏、零营销文案。

交互：

1. 进入即对比视图，默认第 0、1 张（若仅 1 张则单图铺满）。
2. 模式切换（底部极简工具条）：
   - **并排**：横屏左右、竖屏上下。
   - **擦除**：两图叠放，可拖动竖直分割线（触摸友好，命中区 ≥ 24px）。
   - **叠透**：两图叠放，滑杆调上层 opacity 0–100%。
3. 图对选择：每侧下拉/横向缩略图条，仅列出该 share 内图片；备注显示在角标（如「A效果」）。
4. 键盘：`←/→` 切换当前选中侧的图；`1/2/3` 切模式（桌面）。
5. 移动端：
   - 竖屏并排 → 上下堆叠；擦除线横向可拖。
   - 横屏并排 → 左右；擦除线竖向可拖。
   - 工具条可点、滑杆 `touch-action: none` 防滚动冲突。
   - 安全区 `env(safe-area-inset-*)`。

### 2.7 图片处理

- 接受 `image/jpeg|png|webp|gif`，单文件上限 50MB。
- Pillow 读尺寸；生成最长边 640px 的 JPEG 缩略图（质量 82）。
- 原图按扩展名落盘，URL 不暴露随机之外的信息。

### 2.8 错误行为

- 上传非图片 → 400 `{detail}`。
- 超限 → 413。
- 无效 share id / 已撤销 → 404。
- 未登录访问 admin API → 401。
- 服务启动时确保 `data/uploads`、`data/thumbs` 存在；DB `create_all`。

## [S3] Out of Scope

- 多用户 / 角色体系
- 外网 HTTPS 终结、反向代理配置
- 图片编辑/滤镜
- 实时协同
- 云对象存储
- 分享页访问统计/密码（本轮不做分享密码）
- 批量 zip 导出

## Tasks

- [x] T1: 项目骨架与启动 — `app/` 包、config、SQLite models、`start.ps1`、可 `uvicorn` 启动并 200 `/api/me` (covers: S2.1, S2.2, S2.8)
- [x] T2: 鉴权 API — login/logout/me + session cookie + admin 依赖 (covers: S2.3)
- [x] T3: 图片上传/列表/备注/删除 + 缩略图 (covers: S2.4 admin images, S2.7)
- [x] T4: 对比组 CRUD (covers: S2.4 groups)
- [x] T5: 分享 CRUD + 公开 share API + 文件访问控制 (covers: S2.4 share, S2.3 files)
- [x] T6: 管理后台前端 — 登录、图库网格、上传、分组、分享管理 (covers: S2.5)
- [x] T7: 分享对比前端 — 三模式、图对选择、移动横竖屏 (covers: S2.6)
- [x] T8: 端到端验证 — 启动服务、API 冒烟、页面结构检查 (covers: S2.1, S2.4, S2.6)
