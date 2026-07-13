# 像素引擎 PixelEngine

像素引擎是一个统一图片生成、模型调用与额度管理平台。项目正在从浏览器直连上游接口的单机前端，升级为带账户、充值、模型池、渠道路由和外部 API 能力的完整平台。

## 项目结构

```text
frontend/  React 19 + Vite + TypeScript 前端
backend/   FastAPI + PostgreSQL 后端，当前待实现
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

```bash
cd frontend
npm install
npm run dev
```

默认开发地址由 Vite 输出，通常为 `http://localhost:5173`。

## 前端验证

```bash
cd frontend
npm run build
npm test
```

前端构建产物位于 `frontend/dist/`，不要手动修改。

## 后端状态

`backend/` 目前只保留目录位置。后续将在该目录实现 FastAPI 应用、PostgreSQL 数据模型、认证、支付、计费、渠道路由和管理员接口。
