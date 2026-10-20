import type { BusinessToolName, VerificationResult } from "./types.ts";

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function coverage(found: number, total: number): number {
  return total === 0 ? 1 : Number((found / total).toFixed(4));
}

function statusFor(rate: number, warnings: string[]): VerificationResult["status"] {
  if (rate < 0.5) return "failed";
  return warnings.length ? "warning" : "passed";
}

export function verifyToolResult(
  toolName: BusinessToolName,
  details: unknown,
  isError: boolean,
): VerificationResult {
  if (isError) {
    return {
      status: "failed",
      evidenceCoverageRate: 0,
      checks: [],
      warnings: ["工具执行失败，无法形成有效证据"],
    };
  }

  if (!isRecord(details)) {
    return {
      status: "failed",
      evidenceCoverageRate: 0,
      checks: [],
      warnings: ["工具没有返回结构化 details，无法建立证据关联"],
    };
  }

  const warnings: string[] = [];
  const checks: string[] = [];
  let found = 0;
  let total = 0;
  const requireField = (name: string, valid: boolean): void => {
    total++;
    if (valid) found++;
    else warnings.push(`缺少可验证字段：${name}`);
  };

  if (toolName === "query_sales") {
    requireField("totalMatches", isFiniteNumber(details.totalMatches));
    requireField("totalAmount", isFiniteNumber(details.totalAmount));
    requireField("totalQuantity", isFiniteNumber(details.totalQuantity));
    requireField("rows", Array.isArray(details.rows));
    requireField("appliedScope", typeof details.appliedScope === "string");
    checks.push("销售汇总字段和数据范围已检查");
  } else if (toolName === "compare_periods") {
    requireField("metric", isRecord(details.metric));
    requireField("current", isRecord(details.current));
    requireField("previous", isRecord(details.previous));
    requireField("absoluteChange", isFiniteNumber(details.absoluteChange));
    requireField("changeRate", details.changeRate === null || isFiniteNumber(details.changeRate));
    requireField("appliedScope", typeof details.appliedScope === "string");
    checks.push("当前值、对比值和变化率字段已检查");
    if (isRecord(details.validation) && details.validation.status === "warning") {
      warnings.push(...(Array.isArray(details.validation.warnings) ? details.validation.warnings : ["工具基础校验存在警告"]));
    }
  } else {
    requireField("metric", isRecord(details.metric));
    requireField("dimension", typeof details.dimension === "string");
    requireField("current", isRecord(details.current));
    requireField("previous", isRecord(details.previous));
    requireField("absoluteChange", isFiniteNumber(details.absoluteChange));
    requireField("groups", Array.isArray(details.groups));
    requireField("appliedScope", typeof details.appliedScope === "string");
    checks.push("维度分组和贡献率字段已检查");
    if (Array.isArray(details.groups)) {
      const groupChanges = details.groups
        .map((group) => isRecord(group) ? group.absoluteChange : undefined)
        .filter(isFiniteNumber);
      if (groupChanges.length !== details.groups.length) warnings.push("部分分组缺少可验证的绝对变化");
      if (isFiniteNumber(details.absoluteChange)) {
        const sum = groupChanges.reduce((totalValue, value) => totalValue + value, 0);
        const tolerance = 0.000001 * Math.max(1, Math.abs(details.absoluteChange));
        if (Math.abs(sum - details.absoluteChange) > tolerance) {
          warnings.push("分组变化合计与总体变化不一致");
        } else {
          checks.push("分组变化合计与总体变化一致");
        }
      }
    }
    if (isRecord(details.validation) && details.validation.status === "warning") {
      warnings.push(...(Array.isArray(details.validation.warnings) ? details.validation.warnings : ["工具基础校验存在警告"]));
    }
  }

  const evidenceCoverageRate = coverage(found, total);
  if (evidenceCoverageRate < 1) warnings.push(`证据字段覆盖率为 ${(evidenceCoverageRate * 100).toFixed(1)}%`);
  return {
    status: statusFor(evidenceCoverageRate, warnings),
    evidenceCoverageRate,
    checks,
    warnings,
  };
}
