# DataAgent

基于 [Pi Coding Agent SDK](https://github.com/earendil-works/pi) 构建的企业销售数据分析 Agent。这个目录是产品化项目；学习过程中的章节示例保留在 `D:\Code\pi-learning`。

## 当前能力

- Pi Agent 会话、模型运行时和资源加载器统一初始化。
- 分层系统提示词：静态人设、工作规则、输出格式，加上数据库中的用户上下文和角色提示。
- `query_sales` 工具：按用户权限查询销售数据，并返回匹配数量、销售额合计、数量合计和明细。
- 指标语义层：在 SQLite 中维护销售额、销售数量、订单数和平均订单金额的公式、单位、维度和版本。
- `compare_periods` 工具：比较两个日期期间的指标值、绝对变化和变化率，并自动应用用户数据范围。
- `breakdown_metric` 工具：按产品、地区或销售人员拆解两个期间的指标变化，并返回贡献率。
- SQLite 本地数据库：CSV 作为可复现的导入源，运行时从数据库读取。
- 服务端数据权限：用户的 `data_scope` 在 SQL 查询层强制执行，不依赖模型自觉遵守。
- 扩展式安全门：拦截过大的 `limit`，避免一次返回过多数据。
- 调用前权限拦截：区域用户请求越权地区时，在工具执行前直接阻止，不发起数据库查询。
- 基础结果校验：复核期间变化率和维度分组变化合计，向 Agent 暴露校验状态和提示。
- 最小分析闭环：Planner 生成有限步骤，Tool Executor 记录 `calculationId`，Verifier 校验结果并关联 Evidence。
- 每个用户独立的 AgentSession 和忙碌状态，支持不同用户并行请求。
- Express + SSE 流式响应，Vue 前端显示分析 ID、分析计划、工具卡片、校验状态和回答。
- 前端安全 Markdown 表格渲染：表格有边框、隔行颜色、数字右对齐和横向滚动。
- `/health` 健康检查、配置文件、数据库种子脚本和 Node 测试脚本。
- `/api/metrics` 指标目录和 `/api/analysis/:analysisId` 分析记录查询接口。

## 运行

需要 Node.js `>=22.19.0`。Node 24 自带 `node:sqlite`，因此本项目不需要额外安装 SQLite 原生模块。

第一次准备环境：

```powershell
npm install                 # 安装依赖，只有 package.json 变化或首次运行时需要
npm run generate:data       # 重新生成示例 CSV 时才需要
npm run seed                # 初始化/重建 SQLite 数据库时需要，会重置种子数据
```

日常开发只需要：

```powershell
npm run dev                 # 同时启动 Express 后端和 Vite 前端
```

开发模式浏览器打开 <http://localhost:5173>。`5173` 是 Vue/Vite 前端，`3000` 是 Express 后端和 API；直接打开 `3000` 只是生产构建的静态页面入口，开发时以 `5173` 为准。生产构建使用 `npm run build`，之后执行 `npm start`，由 Express 提供 `public` 中的构建产物。

页面可以选择 `u001`、`u002` 或 `u003`，观察不同用户的销售数据范围。

## 数据和权限

`data/sales.csv` 是可复现的数据导入源，包含 2024 年 1～12 月、3 个区域和 3 类产品的 108 条销售记录。执行 `npm run generate:data` 可以重新生成同一份数据；执行 `npm run seed` 会重建业务种子数据：销售记录、用户、角色提示配置和指标定义。

可以在浏览器中尝试：

```text
比较华东 2024 年 2 月和 1 月的销售额
比较全公司 2024 年第二季度和第一季度的订单数
比较华南 2024 年 11 月和 10 月的平均订单金额
```

当前示例用户：

| 用户 | 角色 | 数据范围 |
| --- | --- | --- |
| 王小姐（u001） | 销售经理 | 华东 |
| 李先生（u002） | 财务分析师 | 全公司 |
| 陈先生（u003） | 销售经理 | 华南 |

## 架构

```text
浏览器
  ↓ POST /chat + SSE
Express Server
  ↓ userId
DataAgentManager
  ├─ UserRepository → SQLite users / prompt_profiles
  ├─ PromptLoader → prompts/analyst/*.md + 用户上下文
  ├─ AnalysisStore / ToolExecutor → Planner / Verifier / Evidence
  ├─ query_sales → SQLite sales（服务端强制 data_scope）
  ├─ compare_periods → metric_definitions + sales（确定性计算）
  └─ LimitGuard / ScopeGuard → 工具调用前安全拦截
        ↓
Pi AgentSession → ModelRuntime → LLM Provider
```

## 当前版本边界

当前 v1 已覆盖单指标查询、期间比较、维度拆解、有限分析计划、结果校验、证据关联、权限拦截和流式展示。分析记录目前保存在进程内，示例身份来自请求参数，数据库使用 SQLite；登录认证、持久化审计、多租户和 PostgreSQL 属于后续生产化阶段。
