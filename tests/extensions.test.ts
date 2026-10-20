import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { limitGuardExtension } from "../src/extensions/limit-guard.ts";
import { scopeGuardExtension } from "../src/extensions/scope-guard.ts";

type Handler = (event: { toolName: string; input?: Record<string, unknown> }) => unknown;

function captureHandler(factory: (pi: any) => void): Handler {
  let handler: Handler | undefined;
  factory({
    on: (_event: string, callback: Handler) => { handler = callback; },
  });
  assert.ok(handler);
  return handler;
}

describe("Agent extensions", () => {
  it("在 query_sales 执行前阻止超出上限的 limit", () => {
    const handler = captureHandler(limitGuardExtension(100));
    const result = handler({ toolName: "query_sales", input: { limit: 101 } }) as { block?: boolean; reason?: string };
    assert.equal(result.block, true);
    assert.match(result.reason ?? "", /1 到 100/);
  });

  it("在 breakdown_metric 执行前阻止区域越权", () => {
    const handler = captureHandler(scopeGuardExtension({
      id: "u001",
      name: "王小姐",
      department: "销售部",
      role: "销售经理",
      dataScope: "region:华东",
      scope: { kind: "region", label: "region:华东", region: "华东" },
      promptProfile: "analyst",
    }));
    const result = handler({ toolName: "breakdown_metric", input: { region: "华南" } }) as { block?: boolean; reason?: string };
    assert.equal(result.block, true);
    assert.match(result.reason ?? "", /只能查询华东/);
  });
});
