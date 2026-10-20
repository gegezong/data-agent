# 最小 Planner–Tool Executor–Verifier 闭环

## 1. 当前实现范围

当前项目实现的是一个保守版、单进程的分析闭环：

```text
用户问题
  ↓
Planner：生成有限步骤和工具边界
  ↓
Pi Agent：理解参数并选择受控业务工具
  ↓
Tool Executor：记录工具生命周期和 calculationId
  ↓
Verifier：校验结构化结果和证据字段覆盖率
  ↓
Evidence：把工具结果关联到 calculationId
  ↓
SSE：推送计划、工具状态、验证结果和证据
```

它没有引入独立的第二个模型调用，也没有实现自动 Replan。Planner 负责给出有限的推荐流程，Pi Agent 负责从用户自然语言中补齐具体日期和筛选参数。

## 2. Planner

源文件：`src/analysis/planner.ts`

`buildAnalysisPlan()` 根据问题中的业务意图生成计划：

- 普通明细问题：推荐 `query_sales`；
- 比较、环比、同比、增长或下降问题：推荐 `compare_periods`；
- 原因、贡献、拆解或排名问题：推荐 `compare_periods` + `breakdown_metric`。

计划包含：

```ts
{
  analysisId,
  goal,
  preferredTools,
  allowedTools,
  steps,
  stopConditions
}
```

当前为了避免自然语言分类误判，`allowedTools` 仍包含三个只读业务工具；`preferredTools` 和 `steps` 用于展示和后续校验。这样既有结构化 Planner，又不会因为关键词识别不完整而阻断正常请求。

## 3. Tool Executor

源文件：`src/analysis/executor.ts`

Pi Agent 继续负责真正的工具执行，应用层通过 Extension API 接入工具生命周期：

1. `tool_execution_start`：生成 `calc_<uuid>` 格式的 `calculationId`，保存工具名称、调用 ID、输入和开始时间；
2. `tool_result`：读取工具结构化 `details`，调用 Verifier，并创建 Evidence；
3. 返回新的 `details`：在原始结果上追加 `calculationId`、`verification` 和 `evidenceIds`；
4. `tool_execution_end`：由 server 继续向浏览器发送工具结束事件。

`AnalysisStore` 在进程内保存当前分析、计算记录和证据，并通过 `GET /api/analysis/:analysisId` 提供查看入口。当前是本地演示级内存存储，进程重启后记录会消失。

## 4. Verifier

源文件：`src/analysis/verifier.ts`

Verifier 对三类工具使用不同的最小校验规则：

| 工具 | 校验内容 |
| --- | --- |
| `query_sales` | 汇总字段、明细数组和应用权限范围是否存在 |
| `compare_periods` | 当前值、对比值、绝对变化、变化率和权限范围是否存在 |
| `breakdown_metric` | 分组字段是否完整，分组变化合计是否等于总体变化 |

返回结构：

```ts
{
  status: "passed" | "warning" | "failed";
  evidenceCoverageRate: number;
  checks: string[];
  warnings: string[];
}
```

证据覆盖率表示工具结构化结果中预期字段的存在比例。它是当前版本的字段级覆盖校验，不是完整的自然语言数字引用校验。

## 5. Evidence 关联

每次成功的业务工具调用会生成一个 Evidence：

```ts
{
  evidenceId,
  calculationId,
  title,
  source: "DataRepository",
  data,
  createdAt
}
```

关系为：

```text
AnalysisRun
  └─ CalculationRecord
       ├─ calculationId
       ├─ verification
       └─ evidenceIds[]
             └─ EvidenceItem.calculationId
```

因此可以从分析记录定位某次工具计算，再定位该计算产生的结构化证据。当前 Evidence 保存原始结构化结果，适合本地调试和演示；尚未做数据库持久化、脱敏和长期审计。

## 6. SSE 事件

一次 `/chat` 请求现在会额外推送：

```text
analysis_started
plan_created
tool_started
verification
evidence_added
tool_finished
text / analysis status
done
```

前端在最终答案之前展示计划、校验状态和证据 ID。原有的 `tool_start` / `tool_end` 事件仍然保留，用于兼容已有工具卡片渲染。

## 7. 当前边界

- Planner 是规则型轻量规划器，不负责复杂日期解析和动态任务分解；
- Tool Executor 是 Pi 工具执行生命周期的应用层适配器，不替代 Pi Runtime；
- Verifier 校验结构化字段和确定性数字，不判断模型自然语言中的每一个数字引用；
- Evidence 是进程内记录，不是数据库审计系统；
- 验证失败会产生 `warning` 或 `failed` 事件，但当前不会自动重规划；
- 没有引入 PostgreSQL、Redis、队列和多实例共享状态。

这套边界适合当前本地作品集版本：已经能够演示“计划—工具—校验—证据”的完整工程链路，同时保持代码量和运行依赖可控。
