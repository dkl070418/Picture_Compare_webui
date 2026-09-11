# Picture Compare WebUI

本地自托管的**图片对比分享**服务：管理员上传照片、备注、分组，并生成只包含所选图片的分享链接；对方打开后即可在干净的对比页里查看（擦除 / 并排 / 叠透），支持手机横竖屏、双指缩放。

## 功能

- **管理后台**：口令登录、拖拽上传、备注（如「A效果」）、对比组、分享链接管理、修改口令
- **分享对比页**：默认「擦除」模式；并排 / 叠透可切换；仅暴露该分享内的图片
- **移动端**：竖屏上下并排、横屏左右；双指缩放+平移；单指拖分割线；备注贴着分割线
- **桌面端**：滚轮缩放、拖动平移、快捷键（`1/2/3` 切模式、`0` 100%、`F` 适应）
- **安全**：管理 API 需会话；未分享原图不对匿名开放；分享可撤销

## 快速开始（本机）

```powershell
# 使用嵌入式 Python（Windows 示例）
D:\TOOLS\embedded\python\python.exe -m pip install -r requirements.txt
.\start.ps1
# 打开 http://127.0.0.1:8765/
```

首次未设置口令时，终端会打印一次随机管理员口令；也可在启动前设置：

```powershell
$env:ADMIN_PASSWORD = "你的口令"
.\start.ps1
```

改口令：后台侧栏「修改口令」，或：

```powershell
D:\TOOLS\embedded\python\python.exe scripts\set_password.py
```

数据默认写在项目下 `data/`（数据库、原图、缩略图、`config.json`）。

## Docker / NAS 部署

镜像仓库（阿里云个人版）：

```text
crpi-wjscuxkxm163odo3.cn-hangzhou.personal.cr.aliyuncs.com/dkl091219/picture_comparetool
```

```bash
docker compose up -d
# 默认映射主机端口 18765
# http://<NAS_IP>:18765/
```

`docker-compose.yml` 要点：

- 端口：`18765:18765`
- 数据卷：`./data:/data`
- 可选环境变量：`ADMIN_PASSWORD`（设置后会覆盖 `data/config.json` 中的口令）

重新构建并推送：

```bash
docker build -t crpi-wjscuxkxm163odo3.cn-hangzhou.personal.cr.aliyuncs.com/dkl091219/picture_comparetool:1.0.1 .
docker push crpi-wjscuxkxm163odo3.cn-hangzhou.personal.cr.aliyuncs.com/dkl091219/picture_comparetool:1.0.1
```

## 目录结构

```text
app/
  main.py          # FastAPI 路由
  config.py        # 口令 / 路径 / 密钥
  models.py        # SQLite 模型
  auth.py          # 会话 Cookie
  static/          # 管理后台 + 分享页前端
scripts/           # 样图、E2E、改口令
docs/compose/spec/ # 功能规格
Dockerfile
docker-compose.yml
```

## 主要接口（摘要）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | 登录，设置会话 Cookie |
| GET | `/api/admin/images` | 图库列表（需登录） |
| POST | `/api/admin/images` | 上传图片 |
| POST | `/api/admin/shares` | 用选中图片生成分享 |
| GET | `/api/share/{id}` | 公开分享元数据与图列表 |
| GET | `/s/{id}` | 分享对比页 |
| GET | `/files/{id}` | 原图（仅分享中或已登录） |

完整交互式文档：服务启动后访问 `/api/docs`。

## 开发与测试

```powershell
# API 冒烟（含改口令、XSS 注入检查）
D:\TOOLS\embedded\python\python.exe scripts\e2e_smoke.py

# Playwright 前端（登录、预览灯箱、擦除/缩放、移动端视口）
D:\TOOLS\embedded\python\python.exe scripts\fe_e2e.py
```

依赖见 `requirements.txt`：FastAPI、Uvicorn、SQLAlchemy、Pillow、argon2-cffi 等。

## 环境变量

| 变量 | 说明 |
|------|------|
| `ADMIN_PASSWORD` | 管理员口令（优先于配置文件） |
| `SECRET_KEY` | Cookie 签名密钥（默认自动生成并写入 config） |
| `PORT` | 监听端口（默认 8765） |
| `PICTURE_COMPARE_DATA` | 数据目录（默认 `<项目>/data`，Docker 内为 `/data`） |

## License

见 [LICENSE](./LICENSE)。
