import type { AnalysisEvent } from "../analysis/types.ts";

type AgentEvent = {
  type?: string;
  assistantMessageEvent?: { type?: string; delta?: unknown };
  message?: { role?: string; stopReason?: string; errorMessage?: string };
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
};

export function sse(type: string, data: unknown): string {
  return `data: ${JSON.stringify({ type, data })}\n\n`;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 将 Pi 生命周期事件转换成稳定的浏览器事件协议。 */
export function translateAgentEvent(event: AgentEvent, analysisId: string): string | null {
  switch (event.type) {
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta") return sse("text", { analysisId, delta: textOf(update.delta) });
      // 不把模型原始内部推理透传到浏览器，前端展示中文分析状态和工具进度。
      return null;
    }
    case "message_end": {
      const message = event.message;
      if (message?.role === "assistant" && message.stopReason === "error") {
        return sse("error", {
          analysisId,
          message: message.errorMessage || "模型连接失败，请检查模型配置、网络和 API 凭据。",
        });
      }
      return null;
    }
    case "tool_execution_start":
      return sse("tool_start", {
        analysisId,
        id: event.toolCallId,
        name: event.toolName,
        args: event.args ?? {},
      });
    case "tool_execution_end":
      {
        const result = event.result as { content?: Array<{ text?: unknown }> } | undefined;
      return sse("tool_end", {
        analysisId,
        id: event.toolCallId,
        name: event.toolName,
        result: textOf(result?.content?.[0]?.text).slice(0, 1200),
        isError: event.isError ?? false,
      });
      }
    default:
      return null;
  }
}

export function translateAnalysisEvent(event: AnalysisEvent): string {
  return sse(event.type, event);
}
