import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnalysisStore, ToolExecutor } from "../src/analysis/executor.ts";
import { buildAnalysisPlan } from "../src/analysis/planner.ts";
import { verifyToolResult } from "../src/analysis/verifier.ts";

describe("Analysis loop", () => {
  it("Planner 为变化原因问题生成有限步骤", () => {
    const plan = buildAnalysisPlan("analysis-test", "华东销售额下降主要是哪些产品造成的？");
    assert.deepEqual(plan.preferredTools, ["compare_periods", "breakdown_metric"]);
    assert.equal(plan.steps.length, 2);
    assert.ok(plan.stopConditions.length > 0);
  });

  it("Verifier 检查结构化结果并计算证据覆盖率", () => {
    const result = verifyToolResult("compare_periods", {
      metric: { metricKey: "sales_amount" },
      current: { value: 52000 },
      previous: { value: 45000 },
      absoluteChange: 7000,
      changeRate: 7000 / 45000,
      appliedScope: "region:华东",
    }, false);
    assert.equal(result.status, "passed");
    assert.equal(result.evidenceCoverageRate, 1);
  });

  it("Tool Executor 生成 calculationId 并关联 Evidence", () => {
    const store = new AnalysisStore();
    const run = store.start("u001", "华东销售额是多少？");
    const calculation = store.startCalculation(run.analysisId, "tool-call-1", "query_sales", { region: "华东" });
    assert.ok(calculation);
    store.finishCalculation(run.analysisId, "tool-call-1", {
      totalMatches: 1,
      totalAmount: 45000,
      totalQuantity: 15,
      rows: [],
      appliedScope: "region:华东",
    }, false);
    const saved = store.get(run.analysisId);
    assert.ok(saved);
    assert.match(saved.calculations[0]?.calculationId ?? "", /^calc_/);
    assert.equal(saved.evidence.length, 1);
    assert.equal(saved.evidence[0]?.calculationId, saved.calculations[0]?.calculationId);
    assert.equal(saved.calculations[0]?.verification?.status, "passed");
  });

  it("Tool Executor 扩展把 calculationId 注入 tool_result details", async () => {
    const store = new AnalysisStore();
    const run = store.start("u001", "华东销售额是多少？");
    const handlers = new Map<string, (event: any) => unknown>();
    new ToolExecutor(store).extension("u001")({
      on: (event: string, handler: (event: any) => unknown) => handlers.set(event, handler),
    } as any);
    handlers.get("tool_execution_start")?.({
      toolName: "query_sales",
      toolCallId: "tool-call-2",
      args: { region: "华东" },
    });
    const result = await handlers.get("tool_result")?.({
      toolName: "query_sales",
      toolCallId: "tool-call-2",
      details: { totalMatches: 1, totalAmount: 45000, totalQuantity: 15, rows: [], appliedScope: "region:华东" },
      isError: false,
    }) as { details?: { calculationId?: string; evidenceIds?: string[] } };
    assert.match(result.details?.calculationId ?? "", /^calc_/);
    assert.equal(result.details?.evidenceIds?.length, 1);
    assert.ok(store.get(run.analysisId)?.evidence.length === 1);
  });
});
