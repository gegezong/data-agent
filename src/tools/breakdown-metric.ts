import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { DataRepository, UserContext } from "../data/repository.ts";
import type { MetricKey } from "../data/metrics.ts";

const metricKeySchema = Type.Union([
  Type.Literal("sales_amount"),
  Type.Literal("sales_quantity"),
  Type.Literal("order_count"),
  Type.Literal("avg_order_value"),
], { description: "指标标识" });

const dimensionSchema = Type.Union([
  Type.Literal("region"),
  Type.Literal("product"),
  Type.Literal("salesperson"),
]);

function formatNumber(value: number, unit: string): string {
  const digits = unit === "元/笔" ? 2 : 0;
  return `${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

function formatRate(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatResult(result: ReturnType<DataRepository["breakdownMetric"]>): string {
  const filterText = Object.entries(result.filters)
    .map(([key, value]) => `${key}=${value}`)
    .join("、") || "无额外筛选";
  const lines = [
    `指标：${result.metric.displayName}（${result.metric.metricKey}）`,
    `拆解维度：${result.dimension}`,
    `当前期间：${result.currentPeriod.from} 至 ${result.currentPeriod.to}`,
    `对比期间：${result.previousPeriod.from} 至 ${result.previousPeriod.to}`,
    `总体变化：${formatNumber(result.absoluteChange, result.metric.unit)}（${formatRate(result.changeRate)}）`,
    `筛选条件：${filterText}`,
    `数据权限范围：${result.appliedScope}`,
    `校验状态：${result.validation.status === "passed" ? "通过" : "需关注"}`,
    "",
    "维度值 | 当前值 | 对比值 | 变化 | 变化率 | 贡献率",
    "--- | ---: | ---: | ---: | ---: | ---:",
  ];
  for (const group of result.groups) {
    lines.push([
      group.value,
      formatNumber(group.current.value, result.metric.unit),
      formatNumber(group.previous.value, result.metric.unit),
      formatNumber(group.absoluteChange, result.metric.unit),
      formatRate(group.changeRate),
      formatRate(group.contributionRate),
    ].join(" | "));
  }
  if (result.validation.warnings.length) {
    lines.push("", `校验提示：${result.validation.warnings.join("；")}`);
  }
  return lines.join("\n");
}

export function createBreakdownMetricTool(repository: DataRepository, user: UserContext) {
  return defineTool({
    name: "breakdown_metric",
    label: "拆解指标变化",
    description: "按地区、产品或销售人员拆解两个期间的指标变化，返回分组当前值、对比值、变化率和贡献率。服务端会应用指标定义和当前用户的数据权限。",
    parameters: Type.Object({
      metricKey: metricKeySchema,
      currentFrom: Type.String({ description: "当前期间开始日期，格式 YYYY-MM-DD" }),
      currentTo: Type.String({ description: "当前期间结束日期，格式 YYYY-MM-DD" }),
      previousFrom: Type.String({ description: "对比期间开始日期，格式 YYYY-MM-DD" }),
      previousTo: Type.String({ description: "对比期间结束日期，格式 YYYY-MM-DD" }),
      dimension: dimensionSchema,
      region: Type.Optional(Type.String({ description: "可选地区" })),
      product: Type.Optional(Type.String({ description: "可选产品" })),
      salesperson: Type.Optional(Type.String({ description: "可选销售人员" })),
    }),
    async execute(_id, params) {
      const result = repository.breakdownMetric(user, {
        ...params,
        metricKey: params.metricKey as MetricKey,
      });
      return {
        content: [{ type: "text", text: formatResult(result) }],
        details: result,
      };
    },
  });
}
