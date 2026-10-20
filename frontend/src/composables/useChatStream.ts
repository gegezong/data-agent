import { reactive, ref } from "vue";
import type { ChatTurn, ServerEvent, ToolState } from "../types";

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function useChatStream() {
  const turns = ref<ChatTurn[]>([]);
  const isBusy = ref(false);
  const statusText = ref("就绪");
  let abortRequest: (() => void) | null = null;

  function applyEvent(turn: ChatTurn, event: ServerEvent): void {
    const data = event.data;
    switch (event.type) {
      case "analysis_started":
        turn.analysisId = readString(data.analysisId);
        turn.statusText = "正在分析问题…";
        break;
      case "plan_created": {
        const plan = readRecord(data.plan);
        turn.plan = {
          steps: Array.isArray(plan.steps) ? plan.steps.filter((step): step is { id: string; purpose: string; tool: string } => {
            if (!step || typeof step !== "object") return false;
            const item = step as Record<string, unknown>;
            return typeof item.id === "string" && typeof item.purpose === "string" && typeof item.tool === "string";
          }) : [],
        };
        turn.statusText = "已生成分析计划，准备查询数据…";
        break;
      }
      case "thinking":
        turn.statusText = readString(data.delta) || "正在分析数据…";
        break;
      case "tool_start": {
        const existing = turn.tools.find((item) => item.id === readString(data.id));
        if (existing) {
          existing.name = readString(data.name) || existing.name;
          existing.args = readRecord(data.args);
          existing.status = "running";
          break;
        }
        const tool: ToolState = {
          id: readString(data.id),
          name: readString(data.name),
          args: readRecord(data.args),
          status: "running",
        };
        turn.tools.push(tool);
        turn.statusText = "正在查询和校验数据…";
        break;
      }
      case "tool_started": {
        const toolCallId = readString(data.toolCallId);
        const existing = turn.tools.find((item) => item.id === toolCallId);
        if (existing) {
          existing.calculationId = readString(data.calculationId);
        } else {
          turn.tools.push({
            id: toolCallId || readString(data.calculationId),
            calculationId: readString(data.calculationId),
            name: readString(data.toolName),
            args: readRecord(data.input),
            status: "running",
          });
        }
        turn.statusText = "正在查询和校验数据…";
        break;
      }
      case "tool_end": {
        const id = readString(data.id);
        const tool = turn.tools.find((item) => item.id === id);
        if (!tool) break;
        tool.status = "done";
        tool.result = readString(data.result);
        tool.isError = data.isError === true;
        turn.statusText = tool.isError ? "查询遇到问题" : "数据已返回，正在整理结论…";
        break;
      }
      case "verification": {
        const verification = readRecord(data.verification);
        const status = verification.status;
        if (status === "passed" || status === "warning" || status === "failed") {
          turn.verification = { status, evidenceCoverageRate: typeof verification.evidenceCoverageRate === "number" ? verification.evidenceCoverageRate : undefined };
          turn.statusText = status === "passed" ? "校验通过，正在整理结论…" : status === "warning" ? "校验完成，有提示需要关注" : "校验未通过";
        }
        break;
      }
      case "evidence_added":
        turn.evidenceCount += 1;
        break;
      case "text":
        turn.answer += readString(data.delta);
        break;
      case "error":
        turn.error = readString(data.message) || "Agent 请求失败";
        turn.statusText = "分析失败";
        break;
      case "done":
        turn.done = true;
        turn.statusText = turn.error ? "分析失败" : "已完成";
        break;
    }
  }

  async function send(message: string, userId: string): Promise<void> {
    if (!message || isBusy.value) return;
    isBusy.value = true;
    statusText.value = "分析中";
    const turn = reactive<ChatTurn>({
      id: crypto.randomUUID(),
      userText: message,
      answer: "",
      tools: [],
      statusText: "正在连接分析助手…",
      done: false,
      evidenceCount: 0,
    });
    turns.value.push(turn);
    try {
      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        let consumed = 0;
        let buffer = "";
        let settled = false;

        const parseAvailable = (): void => {
          const incoming = request.responseText.slice(consumed).replace(/\r\n/g, "\n");
          consumed = request.responseText.length;
          buffer += incoming;
          let separator = buffer.indexOf("\n\n");
          while (separator >= 0) {
            const raw = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            const line = raw.split("\n").find((item) => item.startsWith("data: "));
            if (line) applyEvent(turn, JSON.parse(line.slice(6)) as ServerEvent);
            separator = buffer.indexOf("\n\n");
          }
        };

        request.open("POST", "/chat");
        request.setRequestHeader("Content-Type", "application/json");
        request.onprogress = () => {
          turn.statusText = "已连接，正在接收分析结果…";
          parseAvailable();
        };
        request.onload = () => {
          try {
            parseAvailable();
            if (request.status < 200 || request.status >= 300) {
              let message = `HTTP ${request.status}`;
              try { message = (JSON.parse(request.responseText) as { error?: string }).error || message; } catch { /* plain text */ }
              throw new Error(message);
            }
            if (!turn.done) {
              turn.done = true;
              turn.statusText = turn.error ? "分析失败" : "已完成";
            }
            settled = true;
            resolve();
          } catch (error) {
            settled = true;
            reject(error);
          }
        };
        request.onerror = () => { if (!settled) { settled = true; reject(new Error("网络连接失败")); } };
        request.onabort = () => { if (!settled) { settled = true; reject(new DOMException("请求已停止", "AbortError")); } };
        abortRequest = () => request.abort();
        turn.statusText = "请求已发送，等待分析结果…";
        request.send(JSON.stringify({ message, userId }));
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        turn.statusText = "已停止";
        turn.done = true;
      } else {
        turn.error = error instanceof Error ? error.message : "请求失败";
        turn.statusText = "分析失败";
      }
    } finally {
      abortRequest = null;
      isBusy.value = false;
      statusText.value = "就绪";
    }
  }

  function stop(): void {
    abortRequest?.();
  }

  return { turns, isBusy, statusText, send, stop };
}
