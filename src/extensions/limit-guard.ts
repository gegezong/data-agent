import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function limitGuardExtension(maxLimit = 100) {
  return (pi: ExtensionAPI): void => {
    pi.on("tool_call", (event) => {
      if (event.toolName !== "query_sales") return;
      const rawLimit = event.input?.limit;
      if (rawLimit === undefined) return;
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
        return {
          block: true,
          reason: `单次明细数量必须是 1 到 ${maxLimit} 之间的整数，你请求的是 ${String(rawLimit)}。请缩小查询范围后重试。`,
        };
      }
    });
  };
}
