import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { config, PROMPTS_DIR, PROJECT_ROOT } from "../config.ts";
import { createSchema, openDatabase } from "../data/database.ts";
import { DataRepository } from "../data/repository.ts";
import { limitGuardExtension } from "../extensions/limit-guard.ts";
import { scopeGuardExtension } from "../extensions/scope-guard.ts";
import { buildSystemPrompt, loadStaticPrompt } from "../prompts/loader.ts";
import { createComparePeriodsTool } from "../tools/compare-periods.ts";
import { createBreakdownMetricTool } from "../tools/breakdown-metric.ts";
import { createQuerySalesTool } from "../tools/query-sales.ts";
import { AnalysisStore, ToolExecutor } from "../analysis/executor.ts";
import type { AnalysisEvent, AnalysisRun } from "../analysis/types.ts";
import { DataAgentError } from "../errors.ts";

type ManagedSession = {
  userId: string;
  session: AgentSession;
};

type RuntimeModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];

export class DataAgentManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly busyUsers = new Set<string>();

  private constructor(
    private readonly db: ReturnType<typeof openDatabase>,
    private readonly repository: DataRepository,
    private readonly modelRuntime: ModelRuntime,
    private readonly model: RuntimeModel,
    private readonly staticPrompt: Awaited<ReturnType<typeof loadStaticPrompt>>,
    private readonly analysisStore: AnalysisStore,
    private readonly toolExecutor: ToolExecutor,
  ) {}

  static async create(): Promise<DataAgentManager> {
    const db = openDatabase(config.dbPath);
    createSchema(db);
    const repository = new DataRepository(db);
    const staticPrompt = await loadStaticPrompt(PROMPTS_DIR);
    const modelRuntime = await ModelRuntime.create();
    const available = await modelRuntime.getAvailable();
    const model = config.model
      ? available.find((item) => `${item.provider}/${item.id}` === config.model)
      : available.find((item) => item.provider === "deepseek") ?? available[0];
    if (!model) {
      const reason = config.model
        ? `指定模型 ${config.model} 不可用`
        : "没有可用模型";
      throw new Error(`${reason}，请检查模型配置和 ~/.pi/agent/models.json`);
    }
    const analysisStore = new AnalysisStore();
    return new DataAgentManager(db, repository, modelRuntime, model, staticPrompt, analysisStore, new ToolExecutor(analysisStore));
  }

  get modelName(): string {
    return `${this.model.provider}/${this.model.id}`;
  }

  listUsers() {
    return this.repository.listUsers();
  }

  listMetrics() {
    return this.repository.listMetricDefinitions();
  }

  startAnalysis(userId: string, prompt: string): AnalysisRun {
    return this.analysisStore.start(userId, prompt);
  }

  subscribeAnalysis(analysisId: string, listener: (event: AnalysisEvent) => void): () => void {
    return this.analysisStore.subscribe(analysisId, listener);
  }

  completeAnalysis(analysisId: string, status: AnalysisRun["status"]): void {
    this.analysisStore.complete(analysisId, status);
  }

  getAnalysis(analysisId: string, userId?: string): AnalysisRun | undefined {
    return this.analysisStore.get(analysisId, userId);
  }

  tryMarkBusy(userId: string): boolean {
    if (this.busyUsers.has(userId)) return false;
    this.busyUsers.add(userId);
    return true;
  }

  markIdle(userId: string): void {
    this.busyUsers.delete(userId);
  }

  async getSession(userId: string): Promise<ManagedSession> {
    const existing = this.sessions.get(userId);
    if (existing) return existing;

    const user = this.repository.getUser(userId);
    if (!user) throw new DataAgentError(`用户 ${userId} 不存在或已停用`, "USER_NOT_FOUND", 404);
    const roleInstructions = this.repository.getPromptProfile(user.promptProfile);
    const systemPrompt = buildSystemPrompt(this.staticPrompt, user, roleInstructions);
    const querySalesTool = createQuerySalesTool(this.repository, user);
    const comparePeriodsTool = createComparePeriodsTool(this.repository, user);
    const breakdownMetricTool = createBreakdownMetricTool(this.repository, user);

    const loader = new DefaultResourceLoader({
      cwd: PROJECT_ROOT,
      agentDir: getAgentDir(),
      systemPromptOverride: () => systemPrompt,
      appendSystemPromptOverride: () => [],
      extensionFactories: [
        (pi) => {
          pi.registerTool(querySalesTool);
          pi.registerTool(comparePeriodsTool);
          pi.registerTool(breakdownMetricTool);
          limitGuardExtension(config.maxQueryLimit)(pi);
          scopeGuardExtension(user)(pi);
          this.toolExecutor.extension(user.id)(pi);
        },
      ],
    });
    await loader.reload();

    const { session } = await createAgentSession({
      model: this.model,
      modelRuntime: this.modelRuntime,
      resourceLoader: loader,
      // 最小权限：产品 Agent 只允许调用受控的销售查询、期间比较和指标拆解工具。
      tools: ["query_sales", "compare_periods", "breakdown_metric"],
      sessionManager: SessionManager.inMemory(),
    });
    const managed = { userId, session };
    this.sessions.set(userId, managed);
    return managed;
  }

  async dispose(): Promise<void> {
    for (const managed of this.sessions.values()) managed.session.dispose();
    this.sessions.clear();
    this.analysisStore.clear();
    this.db.close();
  }
}
