import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildAnalysisPlan } from "./planner.ts";
import { verifyToolResult } from "./verifier.ts";
import type {
  AnalysisEvent,
  AnalysisRun,
  BusinessToolName,
  CalculationRecord,
  EvidenceItem,
} from "./types.ts";

type Listener = (event: AnalysisEvent) => void;

function now(): string {
  return new Date().toISOString();
}

function isBusinessToolName(value: string): value is BusinessToolName {
  return value === "query_sales" || value === "compare_periods" || value === "breakdown_metric";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AnalysisStore {
  private readonly runs = new Map<string, AnalysisRun>();
  private readonly activeByUser = new Map<string, string>();
  private readonly listeners = new Map<string, Set<Listener>>();

  start(userId: string, prompt: string): AnalysisRun {
    const analysisId = randomUUID();
    const run: AnalysisRun = {
      analysisId,
      userId,
      prompt,
      plan: buildAnalysisPlan(analysisId, prompt),
      status: "running",
      calculations: [],
      evidence: [],
      events: [],
      createdAt: now(),
    };
    this.runs.set(analysisId, run);
    this.activeByUser.set(userId, analysisId);
    return run;
  }

  currentForUser(userId: string): AnalysisRun | undefined {
    const analysisId = this.activeByUser.get(userId);
    return analysisId ? this.runs.get(analysisId) : undefined;
  }

  get(analysisId: string, userId?: string): AnalysisRun | undefined {
    const run = this.runs.get(analysisId);
    if (!run || (userId && run.userId !== userId)) return undefined;
    return run;
  }

  subscribe(analysisId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(analysisId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(analysisId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(analysisId);
    };
  }

  startCalculation(
    analysisId: string,
    toolCallId: string,
    toolName: BusinessToolName,
    input: Record<string, unknown>,
  ): CalculationRecord | undefined {
    const run = this.runs.get(analysisId);
    if (!run) return undefined;
    const calculation: CalculationRecord = {
      calculationId: `calc_${randomUUID()}`,
      analysisId,
      toolCallId,
      toolName,
      input,
      startedAt: now(),
      evidenceIds: [],
    };
    run.calculations.push(calculation);
    this.publish(run, {
      type: "tool_started",
      calculationId: calculation.calculationId,
      toolCallId,
      toolName,
      input,
    });
    return calculation;
  }

  finishCalculation(
    analysisId: string,
    toolCallId: string,
    details: unknown,
    isError: boolean,
  ): CalculationRecord | undefined {
    const run = this.runs.get(analysisId);
    const calculation = run?.calculations.find((item) => item.toolCallId === toolCallId);
    if (!run || !calculation) return undefined;

    calculation.finishedAt = now();
    calculation.isError = isError;
    calculation.verification = verifyToolResult(calculation.toolName, details, isError);
    this.publish(run, {
      type: "verification",
      calculationId: calculation.calculationId,
      toolName: calculation.toolName,
      verification: calculation.verification,
    });

    if (!isError && isRecord(details)) {
      const evidence: EvidenceItem = {
        evidenceId: `evidence_${randomUUID()}`,
        calculationId: calculation.calculationId,
        title: `${calculation.toolName} 结构化结果`,
        source: "DataRepository",
        data: details,
        createdAt: now(),
      };
      run.evidence.push(evidence);
      calculation.evidenceIds.push(evidence.evidenceId);
      this.publish(run, {
        type: "evidence_added",
        calculationId: calculation.calculationId,
        evidence,
      });
    }

    this.publish(run, {
      type: "tool_finished",
      calculationId: calculation.calculationId,
      toolCallId,
      toolName: calculation.toolName,
      isError,
    });
    return calculation;
  }

  complete(analysisId: string, status: AnalysisRun["status"]): void {
    const run = this.runs.get(analysisId);
    if (!run) return;
    run.status = status;
    run.finishedAt = now();
    if (this.activeByUser.get(run.userId) === analysisId) this.activeByUser.delete(run.userId);
  }

  private publish(run: AnalysisRun, event: AnalysisEvent): void {
    run.events.push(event);
    for (const listener of this.listeners.get(run.analysisId) ?? []) listener(event);
  }

  clear(): void {
    this.runs.clear();
    this.activeByUser.clear();
    this.listeners.clear();
  }
}

/**
 * 将 Pi 的工具生命周期接到应用层的 Tool Executor。
 * Pi 负责实际执行，应用层负责记录计算、校验结果和建立 Evidence 关联。
 */
export class ToolExecutor {
  constructor(private readonly store: AnalysisStore) {}

  extension(userId: string) {
    return (pi: ExtensionAPI): void => {
      pi.on("tool_execution_start", (event) => {
        if (!isBusinessToolName(event.toolName)) return;
        const run = this.store.currentForUser(userId);
        if (!run) return;
        this.store.startCalculation(run.analysisId, event.toolCallId, event.toolName, event.args ?? {});
      });

      pi.on("tool_result", (event) => {
        if (!isBusinessToolName(event.toolName)) return;
        const run = this.store.currentForUser(userId);
        if (!run) return;
        const calculation = this.store.finishCalculation(run.analysisId, event.toolCallId, event.details, event.isError);
        if (!calculation) return;
        return {
          details: {
            ...(isRecord(event.details) ? event.details : { value: event.details }),
            calculationId: calculation.calculationId,
            verification: calculation.verification,
            evidenceIds: calculation.evidenceIds,
          },
        };
      });
    };
  }
}
