export type BusinessToolName = "query_sales" | "compare_periods" | "breakdown_metric";

export type AnalysisStep = {
  id: string;
  purpose: string;
  tool: BusinessToolName;
  expectedEvidence: string[];
};

export type AnalysisPlan = {
  analysisId: string;
  goal: string;
  preferredTools: BusinessToolName[];
  allowedTools: BusinessToolName[];
  steps: AnalysisStep[];
  stopConditions: string[];
};

export type VerificationStatus = "passed" | "warning" | "failed";

export type VerificationResult = {
  status: VerificationStatus;
  evidenceCoverageRate: number;
  checks: string[];
  warnings: string[];
};

export type EvidenceItem = {
  evidenceId: string;
  calculationId: string;
  title: string;
  source: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type CalculationRecord = {
  calculationId: string;
  analysisId: string;
  toolCallId: string;
  toolName: BusinessToolName;
  input: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  isError?: boolean;
  verification?: VerificationResult;
  evidenceIds: string[];
};

export type AnalysisEvent =
  | { type: "tool_started"; calculationId: string; toolCallId: string; toolName: BusinessToolName; input: Record<string, unknown> }
  | { type: "tool_finished"; calculationId: string; toolCallId: string; toolName: BusinessToolName; isError: boolean }
  | { type: "verification"; calculationId: string; toolName: BusinessToolName; verification: VerificationResult }
  | { type: "evidence_added"; calculationId: string; evidence: EvidenceItem };

export type AnalysisRun = {
  analysisId: string;
  userId: string;
  prompt: string;
  plan: AnalysisPlan;
  status: "running" | "completed" | "failed" | "aborted";
  calculations: CalculationRecord[];
  evidence: EvidenceItem[];
  events: AnalysisEvent[];
  createdAt: string;
  finishedAt?: string;
};
