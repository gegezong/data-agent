import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { DataRepository, UserContext } from "../data/repository.ts";
import type { MetricKey } from "../data/metrics.ts";

const metricKeySchema = Type.Union([
  Type.Literal("sales_amount"),
  Type.Literal("sales_quantity"),
  Type.Literal("order_count"),
  Type.Literal("avg_order_value"),
], { description: "指标标识：sales_amount、sales_quantity、order_count 或 avg_order_value" });

function formatNumber(value: number, unit: string): string {
  const digits = unit === "元/笔" ? 2 : 0;
  return `${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

function formatRate(value: number | null): string {
  if (value === null) return "无法计算（对比期间指标值为 0）";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function formatComparison(result: ReturnType<DataRepository["comparePeriods"]>): string {
  const { metric } = result;
  const filterText = Object.entries(result.filters)
    .map(([key, value]) => `${key}=${value}`)
    .join("、") || "无额外筛选";
  return [
    `指标：${metric.displayName}（${metric.metricKey}）`,
    `口径：${metric.description}，公式 ${metric.formula}，版本 v${metric.version}`,
    `当前期间：${result.currentPeriod.from} 至 ${result.currentPeriod.to}`,
    `对比期间：${result.previousPeriod.from} 至 ${result.previousPeriod.to}`,
    `当前值：${formatNumber(result.current.value, metric.unit)}`,
    `对比值：${formatNumber(result.previous.value, metric.unit)}`,
    `绝对变化：${formatNumber(result.absoluteChange, metric.unit)}`,
    `变化率：${formatRate(result.changeRate)}`,
    `当前记录数：${result.current.recordCount}，对比记录数：${result.previous.recordCount}`,
    `筛选条件：${filterText}`,
    `数据权限范围：${result.appliedScope}`,
  ].join("\n");
}

export function createComparePeriodsTool(repository: DataRepository, user: UserContext) {
  return defineTool({
    name: "compare_periods",
    label: "比较两个时间段",
    description: "比较两个日期期间的同一业务指标，返回当前值、对比值、绝对变化和变化率。指标口径来自服务端 metric_definitions，查询会自动应用当前用户的数据权限范围。适用于同比、环比和自定义期间比较。",
    parameters: Type.Object({
      metricKey: metricKeySchema,
      currentFrom: Type.String({ description: "当前期间开始日期，格式 YYYY-MM-DD" }),
      currentTo: Type.String({ description: "当前期间结束日期，格式 YYYY-MM-DD" }),
      previousFrom: Type.String({ description: "对比期间开始日期，格式 YYYY-MM-DD" }),
      previousTo: Type.String({ description: "对比期间结束日期，格式 YYYY-MM-DD" }),
      region: Type.Optional(Type.String({ description: "可选地区，如华东、华南、华北" })),
      product: Type.Optional(Type.String({ description: "可选产品，如笔记本电脑、手机、平板电脑" })),
      salesperson: Type.Optional(Type.String({ description: "可选销售人员姓名" })),
    }),
    async execute(_id, params) {
      const result = repository.comparePeriods(user, {
        ...params,
        metricKey: params.metricKey as MetricKey,
      });
      return {
        content: [{ type: "text", text: formatComparison(result) }],
        details: result,
      };
    },
  });
}

