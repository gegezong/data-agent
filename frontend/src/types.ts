export type UserSummary = {
  id: string;
  name: string;
  department: string;
  role: string;
  dataScope: string;
};

export type ToolState = {
  id: string;
  calculationId?: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  status: "running" | "done";
};

export type AnalysisPlan = {
  steps: Array<{ id: string; purpose: string; tool: string }>;
};

export type ChatTurn = {
  id: string;
  analysisId?: string;
  userText: string;
  answer: string;
  tools: ToolState[];
  statusText: string;
  done: boolean;
  plan?: AnalysisPlan;
  verification?: { status: "passed" | "warning" | "failed"; evidenceCoverageRate?: number };
  evidenceCount: number;
  error?: string;
};

export type ServerEventType =
  | "analysis_started"
  | "plan_created"
  | "tool_start"
  | "tool_started"
  | "tool_end"
  | "tool_finished"
  | "verification"
  | "evidence_added"
  | "thinking"
  | "text"
  | "error"
  | "done";

export type ServerEvent = {
  type: ServerEventType;
  data: Record<string, unknown>;
};
