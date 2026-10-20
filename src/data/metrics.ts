export const METRIC_DEFINITIONS = [
  {
    metricKey: "sales_amount",
    displayName: "销售额",
    description: "销售事实表 amount 字段的合计金额",
    formula: "SUM(amount)",
    unit: "元",
    timeField: "sale_date",
    dimensions: ["region", "product", "salesperson"],
  },
  {
    metricKey: "sales_quantity",
    displayName: "销售数量",
    description: "销售事实表 quantity 字段的合计数量",
    formula: "SUM(quantity)",
    unit: "件",
    timeField: "sale_date",
    dimensions: ["region", "product", "salesperson"],
  },
  {
    metricKey: "order_count",
    displayName: "订单数",
    description: "销售事实表中的销售记录数，每条记录代表一笔订单",
    formula: "COUNT(*)",
    unit: "笔",
    timeField: "sale_date",
    dimensions: ["region", "product", "salesperson"],
  },
  {
    metricKey: "avg_order_value",
    displayName: "平均订单金额",
    description: "销售额除以订单数，用于观察单笔订单的平均金额",
    formula: "SUM(amount) / COUNT(*)",
    unit: "元/笔",
    timeField: "sale_date",
    dimensions: ["region", "product", "salesperson"],
  },
] as const;

export type MetricKey = (typeof METRIC_DEFINITIONS)[number]["metricKey"];

