import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { DataRepository, UserContext } from "../data/repository.ts";

function formatResult(result: ReturnType<DataRepository["querySales"]>): string {
  const lines = [
    `数据权限范围：${result.appliedScope}`,
    `匹配记录：${result.totalMatches} 条`,
    `销售额合计：${result.totalAmount.toLocaleString("zh-CN")} 元`,
    `数量合计：${result.totalQuantity.toLocaleString("zh-CN")} 件`,
    "",
    "日期 | 产品 | 地区 | 销售额 | 数量 | 销售人员",
    "--- | --- | --- | ---: | ---: | ---",
  ];
  for (const row of result.rows) {
    lines.push([
      row.date,
      row.product,
      row.region,
      row.amount.toLocaleString("zh-CN"),
      row.quantity.toLocaleString("zh-CN"),
      row.salesperson,
    ].join(" | "));
  }
  if (result.rows.length < result.totalMatches) {
    lines.push(``, `明细仅展示前 ${result.rows.length} 条。`);
  }
  return lines.join("\n");
}

export function createQuerySalesTool(repository: DataRepository, user: UserContext) {
  return defineTool({
    name: "query_sales",
    label: "查询销售数据",
    description: "按日期、地区、产品或销售人员查询销售数据，并返回匹配数量、销售额合计、数量合计和明细。服务端会自动应用当前用户的数据权限范围。",
    parameters: Type.Object({
      dateFrom: Type.Optional(Type.String({ description: "开始日期，格式 YYYY-MM-DD" })),
      dateTo: Type.Optional(Type.String({ description: "结束日期，格式 YYYY-MM-DD" })),
      region: Type.Optional(Type.String({ description: "地区，如华东、华南、华北" })),
      product: Type.Optional(Type.String({ description: "产品名称，如笔记本电脑、手机、平板电脑" })),
      salesperson: Type.Optional(Type.String({ description: "销售人员姓名" })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "最多返回多少条明细，默认 20，最大 100" })),
    }),
    async execute(_id, params) {
      const result = repository.querySales(user, params);
      return {
        content: [{ type: "text", text: formatResult(result) }],
        details: result,
      };
    },
  });
}
