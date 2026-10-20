import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { UserContext } from "../data/repository.ts";

/**
 * 在工具真正执行前阻止越权地区参数。
 * Repository 仍会再次校验，形成 Agent 层和数据访问层两道防线。
 */
export function scopeGuardExtension(user: UserContext) {
  return (pi: ExtensionAPI): void => {
    pi.on("tool_call", (event) => {
      if (
        event.toolName !== "query_sales" &&
        event.toolName !== "compare_periods" &&
        event.toolName !== "breakdown_metric"
      ) return;
      if (user.scope.kind === "all") return;

      const requestedRegion = event.input?.region;
      if (typeof requestedRegion !== "string" || !requestedRegion.trim()) return;
      if (requestedRegion.trim() === user.scope.region) return;

      return {
        block: true,
        reason: `权限不足：当前用户只能查询${user.scope.region}，不能查询${requestedRegion.trim()}。不要发起查询或把结果解释为 0，请直接告知用户调整数据范围。`,
      };
    });
  };
}

