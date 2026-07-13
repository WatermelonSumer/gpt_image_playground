# 像素引擎 PixelEngine

像素引擎是一个统一图片生成、模型调用与额度管理平台。项目正在从浏览器直连上游接口的单机前端，升级为带账户、充值、模型池、渠道路由和外部 API 能力的完整平台。

## 项目结构

```text
frontend/  React 19 + Vite + TypeScript 前端
backend/   Python 3.14 + FastAPI + PostgreSQL 18 后端
docs/      业务需求、平台设计和前端改造审计
```

## 已确认方向

- 邮箱注册和登录。
- 普通用户与超级管理员角色。
- 额度充值，初期 1 元人民币兑换 1 额度。
- EPay 标准协议支付，由超级管理员维护支付配置。
- 支持 Google、xAI、OpenAI 等图片模型厂商。
- 超级管理员管理渠道、模型池和模型价格。
- 按“模型单价 × 请求图片数量”计费。
- 用户可创建绑定厂商的平台 API Key。
- Agent 多轮对话模式永久移除。

完整需求见 [已确认需求](docs/platform/confirmed-requirements.md) 和 [业务设计](docs/platform/business-design.md)。

## 前端开发

前后端统一读取根目录 `.env`。首次运行先创建本地配置：

```bash
cp .env.example .env
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env
```

启动 PostgreSQL 18 和 Redis 8：

```bash
docker compose up -d postgres redis
```

初始化后端：

```bash
cd backend
uv python install 3.14
uv sync
uv run python -m app.cli init
uv run uvicorn app.main:app --reload
```

`app.cli init` 会执行 Alembic 迁移，并使用根目录 `.env` 中的 `INITIAL_SUPER_ADMIN_EMAIL` 和 `INITIAL_SUPER_ADMIN_PASSWORD` 创建初始超级管理员。

启动前端：

```bash
cd frontend
npm install
npm run dev
```

默认开发地址由 Vite 输出，通常为 `http://localhost:5173`。
Vite 通过 `envDir` 读取根目录 `.env` 中的 `VITE_BACKEND_URL`。

## 前端验证

```bash
cd frontend
npm run build
npm test
```

前端构建产物位于 `frontend/dist/`，不要手动修改。

## 后端验证

```bash
cd backend
uv run pytest
uv run alembic check
```

当前后端已包含用户、刷新会话、登录、刷新、退出和当前用户接口。刷新令牌通过 HttpOnly Cookie 保存，数据库只保存不可逆哈希。
