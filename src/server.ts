import express from "express";
import { join } from "node:path";
import { config, PROJECT_ROOT } from "./config.ts";
import { DataAgentManager } from "./agent/manager.ts";
import { sse, translateAgentEvent, translateAnalysisEvent } from "./http/sse.ts";
import { toApiError } from "./errors.ts";

const manager = await DataAgentManager.create();
const app = express();
app.use(express.json({ limit: config.requestBodyLimit }));
app.use(express.static(join(PROJECT_ROOT, "public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "data-agent", model: manager.modelName });
});

app.get("/api/users", (_req, res) => {
  res.json({ users: manager.listUsers() });
});

app.get("/api/metrics", (_req, res) => {
  res.json({ metrics: manager.listMetrics() });
});

app.get("/api/analysis/:analysisId", (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const analysis = manager.getAnalysis(req.params.analysisId, userId);
  if (!analysis) return res.status(404).json({ error: "分析记录不存在" });
  res.json({ analysis });
});

app.post("/chat", async (req, res) => {
  const body = req.body as { message?: unknown; userId?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const userId = typeof body.userId === "string" && body.userId.trim()
    ? body.userId.trim()
    : config.defaultUserId;

  if (!message) return res.status(400).json({ error: "message 必填" });
  let managed;
  try {
    managed = await manager.getSession(userId);
  } catch (error) {
    const apiError = toApiError(error, "用户不可用");
    return res.status(apiError.statusCode).json({ code: apiError.code, error: apiError.message });
  }

  if (!manager.tryMarkBusy(userId)) return res.status(429).json({ error: "当前用户的 Agent 正忙，请稍后再试" });
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const analysis = manager.startAnalysis(userId, message);
  const analysisId = analysis.analysisId;
  res.write(sse("analysis_started", { analysisId }));
  res.write(sse("plan_created", { analysisId, plan: analysis.plan }));

  const offAnalysis = manager.subscribeAnalysis(analysisId, (event) => {
    try { res.write(translateAnalysisEvent(event)); } catch { /* 客户端已断开 */ }
  });

  const off = managed.session.subscribe((event) => {
    const payload = translateAgentEvent(event, analysisId);
    if (!payload) return;
    try { res.write(payload); } catch { /* 客户端已断开 */ }
  });

  let settled = false;
  let aborted = false;
  const abortIfDisconnected = () => {
    if (settled || aborted) return;
    aborted = true;
    void managed.session.abort().catch(() => { /* noop */ });
  };
  req.on("aborted", abortIfDisconnected);
  res.on("close", () => {
    off();
    offAnalysis();
    if (!res.writableEnded) abortIfDisconnected();
  });

  let promptFailed = false;
  try {
    await managed.session.prompt(message);
  } catch (error) {
    promptFailed = true;
    try {
      res.write(sse("error", { analysisId, message: error instanceof Error ? error.message : "Agent 出错" }));
    } catch { /* 客户端已断开 */ }
  } finally {
    settled = true;
    off();
    offAnalysis();
    manager.completeAnalysis(analysisId, aborted ? "aborted" : promptFailed ? "failed" : "completed");
    try { res.write(sse("done", { analysisId })); } catch { /* 客户端已断开 */ }
    res.end();
    manager.markIdle(userId);
  }
});

const server = app.listen(config.port, () => {
  console.log("\n════════ DataAgent ════════");
  console.log(`  浏览器：http://localhost:${config.port}`);
  console.log(`  模型：${manager.modelName}`);
  console.log(`  数据库：${config.dbPath}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Server] 收到 ${signal}，正在关闭...`);
  server.close();
  await manager.dispose();
  process.exit(0);
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
