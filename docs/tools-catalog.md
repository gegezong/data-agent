# DataAgent 工具目录

## 1. 这份目录回答什么问题

当前保守版本对模型开放的是 **3 个业务工具**：`query_sales`、`compare_periods` 和 `breakdown_metric`。它们不是通用 SQL 工具，而是由 DataAgent 自己定义输入、权限边界、查询语义和输出结构的受控能力。

Pi Agent 本身还提供了 `read`、`bash`、`write`、`edit` 等通用工具，但 `DataAgentManager` 创建会话时明确使用了：

```ts
tools: ["query_sales", "compare_periods", "breakdown_metric"]
```

因此当前产品会话不会把文件系统、Shell 或原始数据库操作暴露给模型。工具数量少是有意的最小权限设计；Agent 的价值来自意图识别、工具选择、权限拦截、指标口径和结果解释，而不是让模型自由拼接 SQL。

## 2. 工具总览

| 工具 | 作用 | 读写 | 主要输入 | 返回内容 | 权限控制 |
| --- | --- | --- | --- | --- | --- |
| `query_sales` | 查询销售明细并做合计 | 只读 | 日期、地区、产品、销售人员、明细条数 | 记录数、销售额、数量、明细表、结构化详情 | `scopeGuard`、`limitGuard`、Repository 再校验 |
| `compare_periods` | 比较两个期间的同一指标 | 只读 | 指标、两个日期区间及可选维度 | 当前值、对比值、绝对变化、变化率、指标口径 | `scopeGuard`、Repository 再校验 |
| `breakdown_metric` | 按维度拆解两个期间的指标变化 | 只读 | 指标、两个日期区间、拆解维度及筛选条件 | 分组值、变化率、贡献率、校验状态 | `scopeGuard`、指标维度白名单、Repository 再校验 |

三个工具都使用 SQLite 参数绑定查询，都不会修改数据，也都不会接收 `data_scope` 作为模型参数。数据范围来自当前登录用户的服务端上下文。进入 Tool Executor 后，结构化 `details` 会追加 `calculationId`、`verification` 和 `evidenceIds`，用于结果校验和证据追溯。

## 3. 工具调用链

```text
用户自然语言
    ↓
Pi Agent 判断是否需要业务工具，并生成结构化参数
    ↓
TypeBox 参数校验
    ↓
tool_call 扩展事件
    ├─ limitGuard：限制 query_sales.limit
    └─ scopeGuard：阻止三个工具的越权地区
    ↓（通过后）
业务工具 execute()
    ↓
DataRepository：解析服务端 data_scope + 绑定 SQL 参数
    ↓
SQLite sales / metric_definitions
    ↓
content 文本 + details 结构化结果
    ↓
模型组织最终答案，server 翻译为 SSE
```

模型只能选择产品注册的工具；它不能通过工具参数绕过 `users.data_scope`。即使绕过了 Agent 层扩展，Repository 仍会在 SQL 前执行权限校验并把授权地区拼入查询条件。

## 4. `query_sales`：销售明细查询

源文件：`src/tools/query-sales.ts`

### 4.1 适用场景

- “华东地区笔记本电脑卖了多少？”
- “查询 2024 年 3 月华南的手机销售明细。”
- “张三负责的订单有哪些？”
- “给我销售额最高的前 10 条明细。”

当问题包含“哪些记录、明细、订单、谁卖的、列出数据”等明细诉求时使用该工具。单纯的环比、同比或两个区间对照优先使用 `compare_periods`。

### 4.2 输入参数

| 参数 | 类型 | 必填 | 约束与含义 |
| --- | --- | --- | --- |
| `dateFrom` | `string` | 否 | 开始日期，建议使用 `YYYY-MM-DD` |
| `dateTo` | `string` | 否 | 结束日期，建议使用 `YYYY-MM-DD` |
| `region` | `string` | 否 | 地区，如华东、华南、华北 |
| `product` | `string` | 否 | 产品，如笔记本电脑、手机、平板电脑 |
| `salesperson` | `string` | 否 | 销售人员姓名 |
| `limit` | `number` | 否 | 返回明细条数，默认由数据层处理，允许范围 1～100 |

参数由 TypeBox schema 校验。`limit` 还会经过 `limitGuardExtension`，所以即使模型生成了超出范围的参数，也会在真正查询前被阻止。

### 4.3 返回结果

工具同时返回两种结果：

1. `content[0].text`：供模型直接阅读的中文摘要和 Markdown 表格。
2. `details`：供程序、测试和后续前端组件使用的结构化对象。

`details` 的当前形态：

```ts
{
  totalMatches: number;
  totalAmount: number;
  totalQuantity: number;
  rows: Array<{
    date: string;
    product: string;
    region: string;
    amount: number;
    quantity: number;
    salesperson: string;
  }>;
  appliedScope: string;
}
```

文本结果包含授权范围、匹配记录数、销售额合计、数量合计和明细表。如果匹配记录超过 `limit`，会明确说明只展示前若干条，避免模型把截断结果误认为全量结果。

### 4.4 权限与失败行为

- `scopeGuardExtension` 先检查用户主动提供的 `region` 是否越权。
- `DataRepository.assertRegionAllowed()` 再检查一次，形成 Agent 层和数据访问层两道防线。
- 区域用户访问其他地区时，查询不会执行，也不会把空结果解释成“销售额为 0”。
- `limit` 不是整数、低于 1 或高于配置上限时，`limitGuardExtension` 返回可解释的阻断原因。
- 日期、产品和人员筛选通过 SQL 参数绑定传递，避免把自然语言直接拼入 SQL。

### 4.5 示例调用

```json
{
  "dateFrom": "2024-03-01",
  "dateTo": "2024-03-31",
  "region": "华东",
  "product": "笔记本电脑",
  "limit": 20
}
```

## 5. `compare_periods`：指标期间比较

源文件：`src/tools/compare-periods.ts`

### 5.1 适用场景

- “3 月销售额比 2 月增长多少？”
- “比较华东一季度和去年一季度的销售数量。”
- “笔记本电脑本月平均订单金额变化如何？”

该工具把“比较两个期间”变成一个明确的业务操作，避免模型自行拼接两次查询、选错指标或用不一致的口径计算增长率。

### 5.2 输入参数

| 参数 | 类型 | 必填 | 约束与含义 |
| --- | --- | --- | --- |
| `metricKey` | 联合字面量 | 是 | `sales_amount`、`sales_quantity`、`order_count`、`avg_order_value` |
| `currentFrom` | `string` | 是 | 当前期间开始日期 |
| `currentTo` | `string` | 是 | 当前期间结束日期 |
| `previousFrom` | `string` | 是 | 对比期间开始日期 |
| `previousTo` | `string` | 是 | 对比期间结束日期 |
| `region` | `string` | 否 | 地区过滤 |
| `product` | `string` | 否 | 产品过滤 |
| `salesperson` | `string` | 否 | 销售人员过滤 |

### 5.3 当前指标定义

指标定义同时存在于代码中的 `METRIC_DEFINITIONS` 和 SQLite 的 `metric_definitions` 表中。数据库表为后续指标后台管理和版本化保留了扩展点。

| `metricKey` | 展示名 | 公式 | 单位 |
| --- | --- | --- | --- |
| `sales_amount` | 销售额 | `SUM(amount)` | 元 |
| `sales_quantity` | 销售数量 | `SUM(quantity)` | 件 |
| `order_count` | 订单数 | `COUNT(*)` | 笔 |
| `avg_order_value` | 平均订单金额 | `SUM(amount) / COUNT(*)` | 元/笔 |

每个指标还声明时间字段 `sale_date`、可用维度 `region`/`product`/`salesperson` 和版本号。工具返回这些口径信息，便于回答中的数字可追溯、可解释。

### 5.4 返回结果

```ts
{
  metric: {
    metricKey: string;
    displayName: string;
    description: string;
    formula: string;
    unit: string;
    timeField: string;
    dimensions: string[];
    version: number;
  };
  currentPeriod: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  current: { value: number; recordCount: number; totalAmount: number; totalQuantity: number };
  previous: { value: number; recordCount: number; totalAmount: number; totalQuantity: number };
  absoluteChange: number;
  changeRate: number | null;
  filters: Record<string, string>;
  appliedScope: string;
}
```

`changeRate` 使用 `(current - previous) / previous`。当对比期间值为 0 时返回 `null`，工具文本会写成“无法计算”，避免制造无穷大或虚假的百分比。

### 5.5 权限与失败行为

该工具与明细查询使用同一套地区权限校验。`region` 越权时在 `tool_call` 阶段阻止；Repository 仍会拒绝越权请求。没有权限的地区不会被当作合法的空期间参与比较。

## 6. `breakdown_metric`：指标变化拆解

源文件：`src/tools/breakdown-metric.ts`

### 6.1 适用场景

- “华东销售额下降主要是哪些产品造成的？”
- “比较本月和上月各销售人员的销售额变化。”
- “哪些地区对整体增长贡献最大？”

该工具是保守版本中最小的原因分析能力。它只允许按指标定义声明的 `region`、`product` 或 `salesperson` 维度分组，不开放任意字段或任意 SQL。

### 6.2 输入参数

| 参数 | 类型 | 必填 | 约束与含义 |
| --- | --- | --- | --- |
| `metricKey` | 联合字面量 | 是 | 当前四个受控指标之一 |
| `currentFrom` / `currentTo` | `string` | 是 | 当前期间，格式 `YYYY-MM-DD` |
| `previousFrom` / `previousTo` | `string` | 是 | 对比期间，格式 `YYYY-MM-DD` |
| `dimension` | 联合字面量 | 是 | `region`、`product` 或 `salesperson` |
| `region` / `product` / `salesperson` | `string` | 否 | 额外筛选条件 |

### 6.3 返回结果和校验

每个分组返回当前值、对比值、绝对变化、变化率和贡献率，同时返回总体变化和 `validation`：

```ts
{
  groups: Array<{
    value: string;
    current: PeriodMetricValue;
    previous: PeriodMetricValue;
    absoluteChange: number;
    changeRate: number | null;
    contributionRate: number | null;
  }>;
  validation: {
    status: "passed" | "warning";
    checks: string[];
    warnings: string[];
  };
}
```

服务端会复核分组变化合计是否等于总体变化；对比值为 0 时不计算变化率。校验结果会同时出现在模型可读文本和结构化 `details` 中。

### 6.4 权限与失败行为

该工具使用与其他工具相同的地区双重校验。区域用户不传 `region` 时，分组查询仍自动限定授权地区；主动请求其他地区时，在工具执行前阻断，Repository 继续作为第二道边界。

## 7. 三个工具如何协作

典型的 Agent 处理路径如下：

1. 用户问“卖了多少”且需要明细时，选择 `query_sales`。
2. 用户问“增长、下降、环比、同比、相比”时，选择 `compare_periods`。
3. 用户追问“主要由谁或什么造成”时，选择 `breakdown_metric`。
4. 如果问题既要趋势又要证据，先用 `compare_periods` 得到指标变化，再根据需要用 `breakdown_metric` 或 `query_sales` 提供支撑。
4. 工具返回的 `details` 是事实层；模型负责解释、组织表格和指出权限、样本截断等边界。

## 8. 工具设计中的工程要点

- **最小权限**：会话只注册三个只读业务工具，不开放通用文件和 Shell 工具。
- **结构化参数**：TypeBox schema 让参数可以被模型和运行时校验。
- **业务语义封装**：模型选择“销售额”而不是生成 `SUM(amount)`，指标口径集中在服务端。
- **权限不依赖提示词**：提示词只帮助模型理解角色，真正权限在扩展和 Repository 中执行。
- **双重防线**：Agent 层提前阻断，数据层在 SQL 前再次校验并绑定授权条件。
- **可验证输出**：文本用于对话，`details` 和 `validation` 用于前端、测试和后续证据链。
- **只读优先**：当前工具没有写入能力，降低演示阶段的业务风险。

## 9. 下一步工具扩展建议

以下是目标产品的规划能力，不代表当前已经注册：

| 规划工具 | 目的 | 建议前置条件 |
| --- | --- | --- |
| `detect_anomalies` | 识别异常月份并返回证据 | 至少 12 个月历史数据和异常规则 |
| `forecast_metric` | 预测未来期间指标 | 明确模型、置信区间和回测口径 |
| `export_report` | 导出带筛选条件和口径的报告 | 审计记录、文件权限和下载生命周期 |

这些能力应继续以受控业务工具实现，而不是开放“让模型自己写 SQL”。

## 10. 面试表达

可以把当前实现概括为：

> 我没有把 CSV 或 SQLite 直接暴露给模型，而是围绕销售明细、期间比较和维度拆解设计了三个只读业务工具。工具参数由 TypeBox 约束，调用前通过 Pi 的 `tool_call` 扩展做限流和数据范围拦截，Repository 再把服务端权限条件绑定到 SQL，并对期间变化和分组结果做基础校验。工具同时返回面向模型的文本和面向程序的结构化详情，让 Agent 负责理解和解释，数据层负责事实、口径和安全边界。

