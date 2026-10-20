import type { AnalysisPlan, AnalysisStep, BusinessToolName } from "./types.ts";

const ALL_TOOLS: BusinessToolName[] = ["query_sales", "compare_periods", "breakdown_metric"];

function step(id: string, purpose: string, tool: BusinessToolName, expectedEvidence: string[]): AnalysisStep {
  return { id, purpose, tool, expectedEvidence };
}

/**
 * 保守版 Planner：不让模型生成任意流程，只根据问题中的业务意图给出有限的推荐步骤。
 * 日期和筛选条件仍由模型通过工具 schema 提取，计划负责工具边界和停止条件。
 */
export function buildAnalysisPlan(analysisId: string, prompt: string): AnalysisPlan {
  const needsBreakdown = /原因|主要由|贡献|构成|哪些产品|哪些地区|哪些销售人员|拆解|排名/u.test(prompt);
  const needsComparison = /比较|对比|环比|同比|增长|下降|变化|趋势|上月|本月|季度/u.test(prompt);
  const steps: AnalysisStep[] = [];

  if (needsComparison) {
    steps.push(step(
      "compare",
      "确认当前期间与对比期间的指标变化",
      "compare_periods",
      ["当前指标值", "对比指标值", "绝对变化", "变化率"],
    ));
  }
  if (needsBreakdown) {
    steps.push(step(
      "breakdown",
      "按业务维度拆解变化来源",
      "breakdown_metric",
      ["分组当前值", "分组对比值", "分组变化", "贡献率"],
    ));
  }
  if (!steps.length || (!needsComparison && !needsBreakdown)) {
    steps.push(step(
      "query",
      "查询用户问题涉及的销售事实和汇总结果",
      "query_sales",
      ["匹配记录数", "销售额合计", "数量合计"],
    ));
  }

  return {
    analysisId,
    goal: prompt,
    preferredTools: steps.map((item) => item.tool),
    // 当前版本允许三个只读业务工具，避免自然语言分类误判导致正常请求被阻断。
    allowedTools: ALL_TOOLS,
    steps,
    stopConditions: [
      "工具结果已返回且通过基础校验",
      "没有新的证据需求或工具调用预算已用尽",
      "用户数据权限不足时立即停止相关查询",
    ],
  };
}
