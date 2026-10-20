# DataAgent 扩展事件目录

## 1. 事件在本项目中的两种角色

本项目同时使用了 Pi Agent 的两类事件能力，必须区分：

1. **扩展事件**：通过 `pi.on(...)` 注册逻辑，改变或阻止 Agent 行为。当前真正承担业务安全职责的是 `tool_call`。
2. **会话事件**：通过 `session.subscribe(...)` 观察 Agent 流式运行状态，翻译成 SSE 给浏览器。它们主要服务于可观测性和用户体验，不负责数据库授权。

因此，“当前有几个工具”和“当前监听了几个事件”不是同一个问题：产品目前有 2 个业务工具；Pi 生命周期事件很多，DataAgent 当前只实现了其中一部分。

## 2. Pi Agent 生命周期

Pi SDK 的典型调用顺序如下。一次回答可能因为模型多次调用工具而重复执行 `turn` 和工具事件。

```text
session_start
    ↓
用户输入 / input
    ↓
before_agent_start
    ↓
agent_start
    ↓
message_start / message_update / message_end
    ↓
turn_start
    ↓
context / provider request
    ↓
tool_execution_start
    ↓
tool_call                 ← DataAgent 在这里做前置阻断
    ├─ block=true → 工具不执行，模型收到阻断原因
    └─ 通过 → 工具 execute()
              ↓
          tool_execution_update（可选）
              ↓
          tool_result（可修改结果）
              ↓
          tool_execution_end
    ↓
turn_end
    ↓
agent_end
    ↓
agent_settled
```

SDK 还提供会话切换、压缩、模型选择、资源发现和退出等事件。当前 DataAgent 没有为这些事件实现业务扩展。

## 3. 当前已实现的扩展

### 3.1 `limitGuardExtension`

源文件：`src/extensions/limit-guard.ts`

注册方式：

```ts
limitGuardExtension(config.maxQueryLimit)(pi);
```

监听 `tool_call`，只处理 `query_sales`：

```ts
if (event.toolName !== "query_sales") return;
const rawLimit = event.input?.limit;
```

当 `limit` 不是整数、低于 1 或高于配置上限时返回：

```ts
{
  block: true,
  reason: "单次明细数量必须是 1 到 ... 之间的整数..."
}
```

`tool_call` 发生在工具执行之前，因此错误参数不会触发数据库查询。这一层是成本和结果规模控制；TypeBox schema 是参数形状校验，二者职责不同。

### 3.2 `scopeGuardExtension`

源文件：`src/extensions/scope-guard.ts`

注册方式：

```ts
scopeGuardExtension(user)(pi);
```

监听 `tool_call`，处理 `query_sales`、`compare_periods` 和 `breakdown_metric`：

- `all` 范围用户直接通过；
- 区域用户未指定地区时通过，Repository 会自动应用用户授权地区；
- 指定的地区等于授权地区时通过；
- 指定其他地区时返回 `block: true`，并说明用户只能查询授权地区。

它专门解决“提示词要求模型遵守范围，但模型仍然尝试查询越权地区”的问题。阻断原因也明确要求模型不要把未授权结果解释成 0。

### 3.3 为什么还需要 Repository 校验

扩展是 Agent 调用链的第一道防线，但不能成为唯一防线。`DataRepository` 的 `assertRegionAllowed()` 在 SQL 执行前再次校验；区域用户的授权地区会作为绑定参数进入查询条件，用户筛选和权限筛选通过 `AND` 合并。

```text
模型生成参数
    ↓
tool_call 扩展：快速阻断明显越权
    ↓
工具 execute()
    ↓
Repository：服务端用户上下文 + assertRegionAllowed + 参数化 SQL
    ↓
数据库
```

这让权限不依赖模型是否听懂系统提示，也不依赖前端是否传入了正确的 `userId`。

## 4. 当前事件清单

| 事件 | 当前是否注册业务处理 | 当前用途 | 能否阻断/修改 |
| --- | --- | --- | --- |
| `session_start` | 否 | SDK 会话开始 | SDK 生命周期通知 |
| `before_agent_start` | 否 | 可注入本轮上下文或修改系统提示 | 可以 |
| `agent_start` | 否 | Agent 运行开始 | 通知 |
| `message_start` | 否 | 消息开始 | 通知 |
| `message_update` | server 订阅 | 接收模型流式文本和思考增量 | 这里不做业务修改 |
| `analysis_started` | server 生成 | 为一次 `/chat` 请求生成分析 ID | 前端记录本轮分析上下文 |
| `message_end` | 否 | 消息完成 | 可替换最终消息 |
| `turn_start` / `turn_end` | 否 | 每轮模型调用边界 | 通知 |
| `tool_execution_start` | server 订阅 | 通知前端工具卡片开始 | 通知 |
| `tool_call` | 是，两个扩展共用 | 限制条数、阻止三个工具的越权地区 | 可以阻断，也可修改 `event.input` |
| `tool_execution_update` | 否 | 工具的中间进度 | 通知 |
| `tool_result` | 是，Tool Executor | 生成 calculationId、Verifier 校验并追加 Evidence 引用 | 可以修改 `details` |
| `tool_execution_end` | server 订阅 | 通知前端工具卡片结束 | 通知 |
| `agent_end` | 否 | 一次低层 Agent run 结束 | 通知 |
| `agent_settled` | 否 | 确认没有重试、压缩或 follow-up | 通知 |
| `session_shutdown` | 否 | 关闭时释放资源 | 生命周期通知 |

“server 订阅”表示 `src/server.ts` 使用 `session.subscribe` 观察事件；它不是通过扩展工厂注册业务规则。

## 5. `tool_call` 的具体语义

Pi SDK 文档定义：`tool_call` 在 `tool_execution_start` 之后、工具真正执行之前触发，并且可以阻止调用。当前代码使用的事件字段为：

| 字段 | 含义 | 本项目用途 |
| --- | --- | --- |
| `event.toolName` | 工具名称 | 区分三个业务工具 |
| `event.toolCallId` | 本次调用 ID | 目前由 server 用于前端卡片关联 |
| `event.input` | 结构化参数，SDK 标记为可变 | 读取 `region`、`limit` 做校验 |

扩展返回 `undefined` 表示放行；返回 `{ block: true, reason }` 表示阻断。`reason` 会作为模型可见的工具失败原因，模型随后应直接向用户解释边界，而不是再次发起同一越权查询。

`limitGuard` 和 `scopeGuard` 只读参数，没有修改 `event.input`；`ToolExecutor` 监听 `tool_result` 并修改结构化 `details`，追加 `calculationId`、`verification` 和 `evidenceIds`。如果未来增加默认值注入或强制范围收敛，必须注意 Pi 对扩展修改后的参数不会重新做 schema 校验，因此修改逻辑需要自行保证类型和边界。

## 6. Server 如何把事件变成 SSE

源文件：`src/server.ts`

`translateAgentEvent()` 只把对浏览器有价值的事件转成 SSE：

| Pi 事件 | 嵌套事件/字段 | SSE 类型 | 前端效果 |
| --- | --- | --- | --- |
| server 请求开始 | 生成 `analysisId` | `analysis_started` | 标记一次分析请求 |
| `message_update` | `assistantMessageEvent.type === "text_delta"` | `text` | 追加最终答案文本 |
| `message_update` | `assistantMessageEvent.type === "thinking_delta"` | 不透传 | 不向浏览器暴露模型原始内部推理，前端展示中文分析状态 |
| `tool_execution_start` | `toolCallId`、`toolName`、`args` | `tool_start` | 创建工具卡片 |
| `tool_execution_end` | `toolCallId`、`toolName`、`result`、`isError` | `tool_end` | 更新工具卡片结果 |
| 其他事件 | — | 不发送 | server 忽略 |

请求结束时 server 发送 `done`；异常时发送 `error`。客户端断开会触发 `session.abort()`，同时释放订阅和用户 busy 状态。

## 7. 前端展示与事件顺序

前端为每次回答创建一个 assistant turn。`thinking` 和 `tool_start/tool_end` 都追加到这个 turn 的过程区域；`text` 追加到同一 turn 的最终答案区域。因此思考卡片和工具卡片应出现在最终答案之前，而不是在答案之后。

最终答案文本使用 Markdown 渲染器处理标题、列表、表格和代码块。流式过程中先保存原始文本，答案完成或增量更新时再渲染，避免把尚未闭合的 Markdown 表格或标题误判成普通文本。

这套设计把事件顺序和视觉顺序对齐：

```text
分析状态 / tool_start / tool_end
                ↓
       过程卡片（先展示）
                ↓
          text_delta
                ↓
       最终答案 Markdown
```

## 8. 并发和顺序边界

Pi 默认可以并行执行同一条助手消息中的多个工具调用。SDK 保证 `tool_call` 预检按源顺序发生，但 `tool_execution_end` 可能按完成顺序到达。因此前端必须用 `toolCallId` 关联开始和结束事件，不能只依赖事件数组下标。

当前 DataAgent 通过 `busyUsers` 防止同一用户同时提交两条 `/chat` 请求；单个 Agent 轮次内部仍应按 `toolCallId` 处理工具卡片。

## 9. 当前没有实现的扩展点与建议

以下是 SDK 提供、但本项目尚未接入的方向：

| 扩展点 | 可用于什么 | 推荐阶段 |
| --- | --- | --- |
| `before_agent_start` | 注入租户、日期、用户偏好等本轮上下文 | 增加多租户或动态上下文时 |
| `tool_result` | 脱敏、统一错误格式、追加证据 ID | 增加审计和证据链时 |
| `tool_execution_end` | 记录工具耗时、行数和错误率 | 增加可观测性时 |
| `agent_end` / `agent_settled` | 记录一次回答的完整生命周期 | 增加用量统计和评测时 |
| `context` | 清理过长历史，控制上下文成本 | 长会话稳定后 |
| `session_shutdown` | 释放外部连接和临时资源 | 引入缓存、连接池后 |

建议先实现 `tool_execution_end` 的审计日志和 `tool_result` 的统一错误结构，再考虑开放更多工具。安全扩展应优先于工具数量增长。

## 10. 测试清单

当前事件设计至少应覆盖以下场景：

1. `query_sales.limit = 0`：收到阻断原因，数据库查询未发生。
2. 区域用户请求其他地区：`scopeGuard` 阻断，不产生“0 销售额”的误导答案。
3. 区域用户不传 `region`：查询自动限定在授权地区。
4. `compare_periods`、`breakdown_metric` 的越权地区：与明细查询使用同一阻断策略。
5. 正常工具调用：`tool_start` 和 `tool_end` 的 `toolCallId` 一致。
6. 流式文本包含标题和表格：思考/工具卡片在前，最终 Markdown 答案在后。
7. 浏览器主动断开：Agent 被 abort，服务端不继续占用用户 busy 状态。

## 11. 面试表达

可以这样描述事件设计：

> 我把 Pi Agent 的事件分成控制面和展示面。控制面在 `tool_call` 做调用前策略，限制查询条数和越权地区；数据层再做一次权限校验。展示面订阅 `message_update`、`tool_execution_start/end`，转换成稳定的 SSE 协议，让前端按同一个 assistant turn 展示分析状态、工具过程和最终答案。这样权限、执行和 UI 流式渲染各自有清晰边界，也能为后续审计、耗时统计和证据链扩展保留事件入口。

