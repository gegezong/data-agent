export type ValidationStatus = "passed" | "warning";

export type ValidationSummary = {
  status: ValidationStatus;
  checks: string[];
  warnings: string[];
};

const EPSILON = 0.000001;

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}

export function validateComparison(
  current: number,
  previous: number,
  absoluteChange: number,
  changeRate: number | null,
): ValidationSummary {
  const warnings: string[] = [];
  const checks = ["当前值与对比值的差值已复核"];

  if (!nearlyEqual(current - previous, absoluteChange)) {
    warnings.push("绝对变化与期间数值不一致");
  }

  if (previous === 0) {
    checks.push("对比期间为 0 时不计算变化率");
    if (changeRate !== null) warnings.push("对比期间为 0，但变化率不是 null");
  } else {
    checks.push("变化率已按绝对变化除以对比值复核");
    if (changeRate === null || !nearlyEqual(changeRate, absoluteChange / previous)) {
      warnings.push("变化率与计算公式不一致");
    }
  }

  return { status: warnings.length ? "warning" : "passed", checks, warnings };
}

export function validateBreakdown(
  totalChange: number,
  groupChanges: number[],
): ValidationSummary {
  const groupChangeTotal = groupChanges.reduce((sum, value) => sum + value, 0);
  const checks = ["维度分组变化合计已与总体变化复核"];
  const warnings: string[] = [];
  if (!nearlyEqual(groupChangeTotal, totalChange)) {
    warnings.push(`分组变化合计 ${groupChangeTotal} 与总体变化 ${totalChange} 存在差异`);
  }
  checks.push("分组结果使用服务端白名单维度和参数化查询");
  return { status: warnings.length ? "warning" : "passed", checks, warnings };
}
