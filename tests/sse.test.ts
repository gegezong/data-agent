import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translateAgentEvent } from "../src/http/sse.ts";

function parseSse(payload: string): { type: string; data: Record<string, unknown> } {
  const line = payload.trim().slice("data: ".length);
  return JSON.parse(line) as { type: string; data: Record<string, unknown> };
}

describe("SSE 协议适配", () => {
  it("把模型连接错误转换成前端可读事件", () => {
    const payload = translateAgentEvent({
      type: "message_end",
      message: { role: "assistant", stopReason: "error", errorMessage: "Connection error." },
    }, "analysis-1");
    assert.ok(payload);
    const event = parseSse(payload);
    assert.equal(event.type, "error");
    assert.equal(event.data.analysisId, "analysis-1");
    assert.equal(event.data.message, "Connection error.");
  });

  it("不会把原始 thinking_delta 透传到浏览器", () => {
    const payload = translateAgentEvent({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "internal reasoning" },
    }, "analysis-1");
    assert.equal(payload, null);
  });

  it("保留工具调用的稳定关联 ID", () => {
    const payload = translateAgentEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "query_sales",
      args: { region: "华东" },
    }, "analysis-1");
    assert.ok(payload);
    const event = parseSse(payload);
    assert.equal(event.type, "tool_start");
    assert.equal(event.data.id, "call-1");
    assert.deepEqual(event.data.args, { region: "华东" });
  });
});
