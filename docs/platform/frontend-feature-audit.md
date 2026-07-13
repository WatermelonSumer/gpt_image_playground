# 现有前端平台化功能审计

本文档基于当前 `frontend/` 源码，对登录、充值、模型池、渠道路由和用户 API Key 平台化改造进行功能处置审计。

- 审计日期：2026-07-13
- 审计范围：前端 UI、Zustand 状态、IndexedDB、上游 API 调用、数据导入导出、PWA、Vite 和 Docker 部署配置
- 已确认需求：[confirmed-requirements.md](./confirmed-requirements.md)

## 1. 总体结论

现有画廊、参考图、遮罩、收藏、预览和下载能力可以继续作为产品主体。

需要删除的不是整个图片工作台，而是“浏览器直接管理并调用上游渠道”的整套能力。平台化后，浏览器只应调用 FastAPI 后端，后端负责身份、额度、模型池、渠道、上游凭证、计费和退款。

处置分为四类：

| 类别 | 结论 |
|------|------|
| 必须删除 | 上游 Base URL/API Key 配置、配置分享导入、浏览器直连供应商、上游代理、原始上游调试信息、客户端配置备份 |
| 必须替换 | 生成、重试、异步恢复、模型选择、参数兼容、任务元数据、部署 API 地址 |
| 可以保留 | 画廊、图片输入、遮罩编辑、收藏、搜索、灯箱、ZIP 下载、本地图片缓存、透明背景后处理 |
| 需要决策 | PWA 离线能力 |

## 2. 必须删除的功能

### 2.1 普通用户的上游 API 配置

当前设置页允许用户创建和切换多个 `ApiProfile`，直接填写：

- 服务商类型。
- Base URL。
- API Key。
- Images API 或 Responses API。
- 原始模型 ID。
- 请求超时。
- API 代理。
- 流式传输和中间步骤图片数量。
- Base64 返回格式。
- Codex CLI 兼容模式。

这些配置位于：

- `frontend/src/components/SettingsModal.tsx` 的“API 配置”页签。
- `frontend/src/types.ts` 的 `ApiProfile` 和 `AppSettings` 上游字段。
- `frontend/src/lib/apiProfiles.ts` 的配置创建、迁移、校验和合并逻辑。
- `frontend/src/store.ts` 的 `settings`、`setSettings` 和 API 配置复用逻辑。

平台化后普通用户只能选择后端返回的平台模型 ID，因此以上普通用户配置功能必须删除。

管理员的渠道管理不能复用这套本地设置。渠道是服务端资源，应该新建管理员页面，通过受保护的管理员 API 保存到 PostgreSQL。

BYOK 已确认取消。现有实现中的用户上游 API Key、Base URL、API Profile、自定义供应商和浏览器直连能力必须永久删除，不保留隐藏开关或兼容入口。

### 2.2 自定义服务商创建、JSON 导入和配置分享

当前前端支持：

- 创建自定义 HTTP 服务商 Manifest。
- 使用 LLM 根据第三方文档生成配置。
- 从剪贴板导入服务商和 API 配置。
- 将配置编码到 URL。
- 选择是否把 API Key 放入分享 URL。
- 使用 `apiUrl`、`apiKey`、`apiMode`、`model` 等查询参数覆盖配置。
- 从 `VITE_DEFAULT_API_URL` 或远程 JSON 自动导入配置。

涉及文件：

- `frontend/src/components/SettingsModal.tsx`
- `frontend/src/lib/apiProfiles.ts`
- `frontend/src/lib/customProviderConfigUrl.ts`
- `frontend/src/lib/urlSettings.ts`
- `frontend/src/lib/defaultApiUrl.ts`
- `frontend/src/App.tsx` 中的启动导入逻辑
- `frontend/src/types.ts` 中全部 `CustomProvider*` 类型
- `docs/custom-provider-llm-prompt.md`

这些功能允许客户端自行定义上游协议和凭证，会绕过模型池、厂商绑定、价格和额度校验，必须从普通用户前端删除。

如果未来需要“通用渠道协议”，应在 FastAPI 后端实现管理员专用适配器配置，并由后端验证，不应恢复客户端 Manifest 执行能力。

### 2.3 浏览器直连上游厂商

当前普通生成由 `store.executeTask()` 调用 `callImageApi()`，再由前端直接访问 OpenAI 兼容接口、fal.ai 或自定义渠道。

Agent 同样由浏览器直接访问 Responses API，并在客户端执行工具调用循环。

平台化后以下直连实现应删除，并替换为后端 API 客户端：

- `frontend/src/lib/api.ts`
- `frontend/src/lib/imageApiShared.ts`
- `frontend/src/lib/openaiCompatibleImageApi.ts`
- `frontend/src/lib/falAiImageApi.ts`
- 对应的 API 协议测试文件
- `frontend/src/lib/agentApi.ts` 中的浏览器直连部分
- `@fal-ai/client` 前端依赖

前端不应知道最终上游 URL、上游鉴权头、渠道重试顺序或渠道请求格式。

### 2.4 浏览器侧上游异步任务恢复

当前任务记录包含并处理：

- `falRequestId`
- `falEndpoint`
- `falRecoverable`
- `customTaskId`
- `customRecoverable`
- fal.ai 和自定义异步任务的定时恢复查询
- OpenAI 请求看门狗和渠道网络错误提示

这些逻辑位于 `frontend/src/store.ts`，并与 `frontend/src/lib/falAiImageApi.ts`、`frontend/src/lib/openaiCompatibleImageApi.ts` 深度耦合。

平台化后渠道异步任务、断线恢复、重试和故障切换必须由后端负责。前端只保留平台 `generation_request_id`，通过轮询、SSE 或 WebSocket 获取平台任务状态。

以上供应商专用恢复字段和定时器应从前端删除。

### 2.5 上游 API 代理和运行时上游地址

当前项目支持：

- Vite 开发代理到任意上游。
- Nginx `/api-proxy/` 转发。
- `DEFAULT_API_URL`、`API_PROXY_URL`、`ENABLE_API_PROXY`、`LOCK_API_PROXY`。
- Docker 运行时注入上游地址。
- Docker 旧变量迁移提示。

涉及文件：

- `frontend/src/lib/devProxy.ts`
- `frontend/src/hooks/useDockerApiUrlMigrationNotice.ts`
- `frontend/dev-proxy.config.example.json`
- `frontend/vite.config.ts`
- `frontend/deploy/nginx.conf`
- `frontend/deploy/inject-api-url.sh`
- `frontend/deploy/migrate-api-env.envsh`
- `frontend/deploy/Dockerfile`
- `frontend/src/vite-env.d.ts`

这些“任意上游代理”能力必须删除。后续只保留平台后端地址，例如同源 `/api` 或受控的 `VITE_BACKEND_URL`。

开发环境可以将 `/api` 固定代理到本地 FastAPI，但不能继续让用户配置任意代理目标。

### 2.6 API 配置持久化、导出和导入

当前 `getPersistedState()` 会把完整 `settings` 放入 Zustand persist，其中包含上游 API Key。设置页还允许：

- ZIP 导出“包含配置”。
- ZIP 导入“包含配置”。
- 分享包含 API Key 的配置 URL。

涉及位置：

- `frontend/src/store.ts` 的 `getPersistedState()`、`exportData()`、`importData()`。
- `frontend/src/lib/exportZip.ts`。
- `frontend/src/types.ts` 的 `ExportData.settings`。
- `frontend/src/components/SettingsModal.tsx` 的导入导出选项。

平台化后必须删除配置导入、配置导出和上游密钥本地持久化。

任务、图片、缩略图和收藏夹的 ZIP 备份可以保留，但备份中不能包含：

- 登录令牌。
- 用户平台 API Key 原文。
- 上游渠道凭证。
- 管理员支付配置。
- 管理员渠道配置。

### 2.7 原始上游响应和图片 URL 展示

当前任务详情允许普通用户查看或复制：

- `rawResponsePayload`
- `rawImageUrls`
- 上游 API 实际原始错误
- API 配置名称和供应商信息

涉及：

- `frontend/src/types.ts` 的 `TaskRecord`。
- `frontend/src/components/DetailModal.tsx`。
- `frontend/src/store.ts` 的错误持久化逻辑。

平台化后这些信息可能泄露渠道结构、上游地址、供应商返回内容或内部调试细节。普通用户端应删除原始响应和原始 URL 查看功能。

后端可以保存经过脱敏的调试记录，仅在管理员审计或排障页面展示。普通用户只接收平台错误码、可理解的错误消息和平台请求 ID。

### 2.8 当前 Service Worker 缓存策略

`frontend/public/sw.js` 会缓存所有同源 GET 请求。登录后如果 FastAPI 与前端同源，这可能缓存：

- 当前用户资料。
- 余额和额度流水。
- 充值订单。
- 管理员模型和渠道数据。
- 其他带身份信息的 GET 响应。

这是账户和支付平台中的高风险行为。

在 API 缓存规则完成前，应删除或暂时禁用当前 Service Worker 注册。若以后恢复 PWA，只能缓存明确的静态资源，必须排除 `/api/`、`/v1/`、认证响应和任何带用户数据的请求。

### 2.9 旧版推广入口

旧版自动推广弹窗、设置页推广内容、帮助页外部入口和外部版本检查均与收费平台定位冲突，现已从前端永久移除。

“关于”页只展示像素引擎名称、英文名、产品定位和当前版本。根目录许可证文件继续保留，但不作为产品推广内容展示。

## 3. 必须替换而不是直接删除的功能

### 3.1 图片生成提交

保留 `submitTask()` 的输入检查、遮罩校验、图片准备和本地任务创建体验，但删除 API Profile 校验和 `callImageApi()`。

新流程应为：

1. 读取当前平台模型 ID。
2. 校验模型仍在后端可用模型列表中。
3. 计算前端展示用预估额度：模型单价乘图片数量。
4. 调用 FastAPI 创建生成请求。
5. 保存平台请求 ID、模型价格快照和计费数量。
6. 订阅或轮询平台任务状态。
7. 将后端返回的结果图片写入现有画廊缓存。

扣费结果必须以后端为准，前端计算只用于展示。

### 3.2 模型选择和参数兼容

当前模型 ID 位于 API 设置页，`InputBar` 根据 `ApiProfile.provider` 判断 fal.ai/OpenAI 参数限制。

需要替换为：

- 参数栏中的平台模型选择器。
- 后端 `/api/models` 返回平台模型 ID、名称、厂商、单价、能力和参数限制。
- 用户偏好保存上次选择的平台模型 ID。
- `paramCompatibility.ts` 从硬编码厂商判断改为根据模型能力元数据约束数量、尺寸、编辑能力和输出格式。

纯图片尺寸规整逻辑，例如 `frontend/src/lib/size.ts`，可以保留。

### 3.3 任务记录字段

当前 `TaskRecord` 的渠道相关字段需要替换：

| 当前字段 | 处置 | 新字段示例 |
|---------|------|------------|
| `apiProfileId` | 删除 | 不向用户暴露渠道配置 ID |
| `apiProfileName` | 删除 | 不向用户暴露渠道配置名称 |
| `apiProvider` | 替换 | `providerId` 或安全展示用厂商标识 |
| `apiModel` | 替换 | `platformModelId`、`platformModelName` |
| `apiMode` | 删除或后端内部化 | 普通用户不选择上游协议 |
| `falRequestId`、`customTaskId` | 删除 | `generationRequestId` |
| `rawResponsePayload`、`rawImageUrls` | 普通用户删除 | `errorCode`、`requestId` |
| 无 | 新增 | `unitPrice`、`requestedImageCount`、`chargedCredits` |

`actualParams`、实际尺寸和安全的 revised prompt 可以保留，但必须由后端返回经过筛选的标准字段。

### 3.4 重试和复用

“重试任务”可以保留，但每次重试都是新的计费请求，必须再次展示价格并由后端扣费。

当前“复用配置”应改名为“复用参数”或“再次创作”：

- 保留提示词、参考图、遮罩和生成参数恢复。
- 可以恢复原平台模型 ID，但模型已下架时要求用户重新选择。
- 删除临时复用历史 API Profile 的功能。
- 删除“找不到 API 配置，改用当前配置”的提示链路。

因此应删除：

- `reuseTaskApiProfileTemporarily`
- `reusedTaskApiProfileId`
- `reusedTaskApiProfileName`
- `reusedTaskApiProfileMissing`
- `getTaskApiProfile()` 和 `createSettingsForApiProfile()` 等复用逻辑

### 3.5 设置页

`SettingsModal` 不应整体删除。建议拆分为：

- 用户偏好：提交方式、清空输入、参考图编辑行为、通知、下载方式。
- 本地数据：任务和图片导入导出、清除本地缓存。
- 账户与额度：跳转到账户、充值、流水和用户 API Key 管理。
- 关于：只展示像素引擎名称、产品定位和当前版本。

原“API 配置”页签删除。管理员的厂商、渠道、模型池、价格和 EPay 配置使用独立管理员页面，不放进普通设置弹窗。

### 3.6 本地数据说明

当前设置页文案声称“所有配置、任务和生成图片仅保存在浏览器本地”。平台化后该描述不再准确。

应拆分说明：

- 账户、额度、订单、模型和计费记录保存在服务器。
- 首版图片原文件和画廊历史保存在浏览器本地，不提供跨设备图片恢复；后续版本使用 MinIO。
- 清除本地数据不能删除账户、余额、充值订单或服务端审计记录。

### 3.7 帮助文档和部署文档

`HelpModal`、README 和 Docker 文档中关于 API Key、上游 URL、代理、Responses API、自定义服务商导入的内容需要删除或重写。

新的帮助内容应聚焦：

- 登录和额度。
- 模型价格和图片数量计费。
- 平台模型选择。
- 充值订单。
- 用户平台 API Key。
- 本地图片与服务端记录的边界。

## 4. 可以保留的现有能力

以下功能与平台化不冲突，可以在替换请求层后继续使用：

- 提示词输入和 `@` 引用参考图。
- 图片上传、拖拽、剪贴板输入和排序。
- 遮罩编辑、遮罩校验和局部重绘交互。
- 尺寸、质量、格式、压缩、审核、数量等参数控件。
- 透明背景本地后处理。
- 生成任务卡片、瀑布流画廊和搜索筛选。
- 收藏夹、多选、批量删除和批量下载。
- 灯箱、详情预览、右键菜单和图片复制下载。
- IndexedDB 原图、缩略图和本地缓存机制。
- 任务和图片 ZIP 备份，但需要移除配置与密钥。
- 浏览器任务完成通知。
- 响应式布局、移动端输入栏和拖拽选择。
- PWA 安装和静态资源离线能力，但服务端接口必须排除在缓存范围外。

首版不建设图片对象存储，现有 IndexedDB 图片保存和画廊缓存继续作为图片原文件的主要存储。服务端只保存生成请求、计费和审计记录，不保证跨设备恢复图片。后续接入 MinIO 时再迁移为受控的服务端图片存储，不能直接把当前浏览器中的旧图片自动上传。

## 5. Agent 模式的确定结论

Agent 不是简单的图片生成 UI。当前实现包含：

- Responses 文本模型。
- 原生或混合图像 API 配置。
- Web Search 工具。
- 多轮工具调用上限。
- 并发批量生成工具。
- Agent 对话、分支、恢复和 IndexedDB 持久化。
- Markdown、GFM 和数学公式渲染。

当前已确认的计费规则只覆盖“图片模型单价乘请求图片数量”，没有定义：

- 文本模型 token 如何计费。
- Web Search 如何计费。
- Agent 工具轮次如何计费。
- Agent 自动决定图片数量时何时向用户确认价格。
- 文本模型和图片模型是否使用独立模型池。

产品已确认永久删除 Agent 模式，不保留兼容入口。以下功能和代码应全部删除：

- Header 中的画廊/Agent 切换。
- `frontend/src/components/AgentWorkspace.tsx`
- `frontend/src/components/settings/AgentSettingsTab.tsx`
- `frontend/src/components/HistoryModal.tsx` 中 Agent 对话历史
- `frontend/src/components/MarkdownRenderer.tsx`
- `frontend/src/lib/agentApi.ts`
- `frontend/src/lib/agentWebSearch.ts`
- `frontend/src/lib/agentImageReferences.ts`
- `frontend/src/types.ts` 中 Agent 会话类型
- `frontend/src/store.ts` 中 Agent 状态和执行逻辑
- `frontend/src/lib/db.ts` 中 Agent 会话存储
- Agent 相关测试和导出数据

Agent 删除后应一并删除仅由其使用的依赖：

- `streamdown`
- `@streamdown/math`
- `react-markdown`
- `remark-gfm`
- `katex`

## 6. 文件级处置摘要

### 6.1 可整文件删除或由新客户端替代

```text
frontend/src/lib/api.ts
frontend/src/lib/imageApiShared.ts
frontend/src/lib/openaiCompatibleImageApi.ts
frontend/src/lib/falAiImageApi.ts
frontend/src/lib/apiProfiles.ts
frontend/src/lib/customProviderConfigUrl.ts
frontend/src/lib/defaultApiUrl.ts
frontend/src/lib/urlSettings.ts
frontend/src/lib/devProxy.ts
frontend/src/hooks/useDockerApiUrlMigrationNotice.ts
frontend/dev-proxy.config.example.json
frontend/scripts/mock-image-api.mjs
docs/custom-provider-llm-prompt.md
docs/mock-image-api.md
```

对应测试文件需要一并删除，并为新的后端 API 客户端、模型能力和计费流程补充测试。

`frontend/src/lib/runtimeEnv.ts` 是否保留取决于是否需要运行时注入 `VITE_BACKEND_URL`，但不能继续用于注入上游 API 地址。

### 6.2 必须大幅重构

```text
frontend/src/types.ts
frontend/src/store.ts
frontend/src/App.tsx
frontend/src/components/SettingsModal.tsx
frontend/src/components/InputBar.tsx
frontend/src/components/TaskCard.tsx
frontend/src/components/DetailModal.tsx
frontend/src/components/HelpModal.tsx
frontend/src/components/settings/GeneralSettingsTab.tsx
frontend/src/lib/paramCompatibility.ts
frontend/src/lib/exportZip.ts
frontend/src/lib/db.ts
frontend/src/main.tsx
frontend/public/sw.js
frontend/vite.config.ts
frontend/deploy/*
```

这些文件同时包含可保留能力，不能直接整文件删除。

## 7. 推荐执行顺序

不要先从 UI 随机删除输入框，否则 store 和恢复逻辑会留下大量失效状态。建议按以下顺序实施：

1. 删除已确认不再保留的 BYOK 和 Agent 能力。
2. 定义后端模型列表、生成任务和错误响应契约。
3. 新建前端认证、平台模型和生成请求 API 客户端。
4. 修改 `TaskRecord` 和 `AppSettings` 类型，增加数据迁移。
5. 将 `submitTask()`、`retryTask()` 和任务恢复切换到平台后端。
6. 将 `InputBar` 改为平台模型选择和额度预估。
7. 删除 Settings 中的 API Profile 和自定义服务商 UI。
8. 删除直连适配器、代理、URL 导入和供应商恢复逻辑。
9. 删除配置导入导出和普通用户原始响应查看。
10. 禁用旧 Service Worker，再按静态资源白名单重建 PWA 缓存。
11. 更新 README、Help、Docker 和部署环境变量。
12. 运行数据迁移测试、生成流程测试和支付前端状态测试。

## 8. 迁移时不能忽略的数据兼容

现有用户浏览器中可能已经保存：

- 上游 API Key 和 Base URL。
- API Profiles 和自定义服务商 Manifest。
- 历史任务中的供应商和配置字段。
- fal.ai 或自定义异步任务恢复状态。
- Agent 会话。

升级时不应把这些旧凭证自动上传到服务器。

建议在 Zustand persist 迁移中：

- 主动丢弃 `apiKey`、`baseUrl`、profiles 和 customProviders。
- 将仍可展示的历史任务转换为只读旧记录。
- 删除无法继续恢复的上游异步状态并标记任务已中断。
- 保留本地图片、提示词、参数和收藏关系。
- Agent 已永久删除，升级时允许用户提前导出旧 Agent 数据，或明确告知旧 Agent 会话不再兼容。

## 9. 本轮尚不建议直接执行删除

本轮已移除所有 Agent 可见入口并强制旧持久化状态恢复到画廊模式。Agent 底层执行、会话、存储和测试代码仍需按本清单继续清理；BYOK 已确认取消，其余平台化删除应在后端 API 契约确定后分阶段执行。
