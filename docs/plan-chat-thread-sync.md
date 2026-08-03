# 行程规划对话云端同步

> 目标：登录用户在不同设备（含未来移动端）访问同一套对话线程与消息历史。  
> 前端契约对齐 `@assistant-ui` `RemoteThreadListAdapter` + history `load`/`append`。

## 阶段划分

| 阶段 | 范围 | 状态 |
|------|------|------|
| **P1** | PostgreSQL `plan_chat_threads`、REST `/api/v1/plan/threads/*`、鉴权与归属校验、API 测试 | 已完成 |
| **P2** | 前端 `planService` + `createPlanRemoteThreadAdapter`；已登录走服务端，未登录仍 `localStorage` | 已完成 |
| **P3** | 登录后本地 `ctg-plan:*` 一次性上行合并；体积上限与冲突策略（`updated_at`） | 已完成 |
| **P4** | `streamChat` 携带 `threadId`；可选服务端在流结束后补写摘要（审计/检索） | 待做 |

## API（P1）

前缀：`/api/v1/plan/threads`（均需 JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 线程元数据列表（`regular` / `archived`） |
| POST | `/` | 初始化线程，`{ "threadId": "…" }`（与 assistant-ui `remoteId` 一致） |
| GET | `/{threadId}` | 单条元数据 |
| PATCH | `/{threadId}` | `title` / `status` / `custom` |
| DELETE | `/{threadId}` | 删除线程及历史 |
| GET | `/{threadId}/history` | assistant-ui 消息仓库 `{ messages, headId? }` |
| PUT | `/{threadId}/history` | 全量替换消息仓库（history `append` 由客户端读-改-写） |

## 数据模型

- `plan_chat_threads.id`：字符串主键（客户端 `threadId` / `remoteId`）
- `history_repo`：JSONB，与 localStorage `messages:{id}` 结构一致
- `custom`：JSONB（置顶 `pinned` / `pinnedAt` 等）

## 冲突策略（P3）

1. **历史消息**：按 `message.id` **并集合并**；本地有服务端没有的 id、或同条数但 id 不一致、或本地更长 → 上传合并结果；否则以服务端为准。
2. **元数据**：服务端无标题时用本地标题；`custom`（置顶等）与本地合并。
3. **去重**：`sessionStorage` 标记本会话是否已合并；登录/OAuth 强制再合并；`localStorage` 记录每线程 `serverUpdatedAt` + `localMessageCount`。

## 跨端同步（浏览器 ↔ 桌面）

- 浏览器与 Electron **不共享** `localStorage`；对话要在桌面端可见，必须先**登录**并写入服务端。
- 未登录时对话仅保存在当前浏览器本地；请在**同一浏览器**登录后自动上行，或在已登录状态下直接聊天（实时写云端）。
- 桌面端打开「规划历史」时会从服务端拉取列表；若浏览器端对话仍不可见，请在浏览器确认已登录并重开规划页。

## 附件与体积（生产约束）

- 云端 `history_repo` 只存**文本、工具元数据、`workspace:<path>` 引用**，不嵌入 PDF/Markdown base64。
- 写入前客户端走 `sanitizeHistoryForCloud`（remote `append`、本地→云端 merge 均强制）。
- 各端预览通过 `GET /api/v1/plan/workspace/file` 按路径拉字节；文件本体在服务端 agent workspace，不在 Postgres。
- 历史仍超限时 PUT 返回明确 400；客户端保留本地备份且不阻断当前会话。

## 后续

- 按消息行拆表全文检索
- 未登录用户的云端草稿
- 实时多设备 CRDT 合并
- 工件对象存储（跨机房持久化文件字节）
