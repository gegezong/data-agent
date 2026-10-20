import type { DatabaseSync } from "node:sqlite";
import { METRIC_DEFINITIONS, type MetricKey } from "./metrics.ts";
import { validateBreakdown, validateComparison, type ValidationSummary } from "./validation.ts";

export type UserContext = {
  id: string;
  name: string;
  department: string;
  role: string;
  dataScope: string;
  scope: DataScope;
  promptProfile: string;
};

/**
 * 已解析的授权范围。查询层只接受这个受控结构，不接受模型或浏览器传入的原始 scope。
 */
export type DataScope =
  | { kind: "all"; label: "all" }
  | { kind: "region"; label: `region:${string}`; region: string };

export class InvalidDataScopeError extends Error {
  constructor(value: string) {
    super(`用户数据范围配置非法：${value}`);
    this.name = "InvalidDataScopeError";
  }
}

export class DataScopeViolationError extends Error {
  readonly code = "DATA_SCOPE_DENIED";

  constructor(scope: string, requestedRegion: string) {
    super(`权限不足：当前数据范围为 ${scope}，不能查询 ${requestedRegion}。请调整问题范围或切换到有权限的用户。`);
    this.name = "DataScopeViolationError";
  }
}

/**
 * 将数据库里的 scope 配置解析成白名单结构。
 * 这里拒绝空值、额外冒号和换行，避免把配置内容当成 SQL 片段或通配规则。
 */
export function parseDataScope(value: string): DataScope {
  const normalized = value.trim();
  if (normalized === "all") return { kind: "all", label: "all" };

  if (normalized.startsWith("region:")) {
    const region = normalized.slice("region:".length).trim();
    if (!region || region.includes(":") || /[\r\n*%]/u.test(region)) {
      throw new InvalidDataScopeError(value);
    }
    return { kind: "region", label: `region:${region}`, region };
  }

  throw new InvalidDataScopeError(value);
}

export type SalesQuery = {
  dateFrom?: string;
  dateTo?: string;
  region?: string;
  product?: string;
  salesperson?: string;
  limit?: number;
};

export type SaleRecord = {
  date: string;
  product: string;
  region: string;
  amount: number;
  quantity: number;
  salesperson: string;
};

export type SalesQueryResult = {
  totalMatches: number;
  totalAmount: number;
  totalQuantity: number;
  rows: SaleRecord[];
  appliedScope: string;
};

export type MetricDefinition = {
  metricKey: MetricKey;
  displayName: string;
  description: string;
  formula: string;
  unit: string;
  timeField: string;
  dimensions: string[];
  version: number;
};

export type MetricFilters = Pick<SalesQuery, "region" | "product" | "salesperson">;

export type ComparePeriodsQuery = {
  metricKey: MetricKey;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
} & MetricFilters;

export type PeriodMetricValue = {
  value: number;
  recordCount: number;
  totalAmount: number;
  totalQuantity: number;
};

export type ComparePeriodsResult = {
  metric: MetricDefinition;
  currentPeriod: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  current: PeriodMetricValue;
  previous: PeriodMetricValue;
  absoluteChange: number;
  changeRate: number | null;
  filters: MetricFilters;
  appliedScope: string;
  validation: ValidationSummary;
};

export type BreakdownDimension = "region" | "product" | "salesperson";

export type BreakdownMetricQuery = {
  metricKey: MetricKey;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  dimension: BreakdownDimension;
} & MetricFilters;

export type BreakdownGroup = {
  value: string;
  current: PeriodMetricValue;
  previous: PeriodMetricValue;
  absoluteChange: number;
  changeRate: number | null;
  contributionRate: number | null;
};

export type BreakdownMetricResult = {
  metric: MetricDefinition;
  dimension: BreakdownDimension;
  currentPeriod: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  current: PeriodMetricValue;
  previous: PeriodMetricValue;
  absoluteChange: number;
  changeRate: number | null;
  groups: BreakdownGroup[];
  filters: MetricFilters;
  appliedScope: string;
  validation: ValidationSummary;
};

export type UserSummary = Pick<UserContext, "id" | "name" | "department" | "role" | "dataScope">;

type UserRow = {
  id: string;
  name: string;
  department: string;
  role: string;
  data_scope: string;
  prompt_profile: string;
};

type AggregateRow = {
  total_matches: number;
  total_amount: number | null;
  total_quantity: number | null;
};

type SaleRow = {
  sale_date: string;
  product: string;
  region: string;
  amount: number;
  quantity: number;
  salesperson: string;
};

type MetricRow = {
  metric_key: string;
  display_name: string;
  description: string;
  formula: string;
  unit: string;
  time_field: string;
  dimensions_json: string;
  version: number;
};

type MetricAggregateRow = {
  record_count: number;
  total_amount: number | null;
  total_quantity: number | null;
};

type GroupAggregateRow = MetricAggregateRow & { group_value: string };

const METRIC_KEYS = new Set<string>(METRIC_DEFINITIONS.map((metric) => metric.metricKey));

export class DataRepository {
  constructor(private readonly db: DatabaseSync) {}

  getUser(id: string): UserContext | undefined {
    const row = this.db.prepare(`
      SELECT id, name, department, role, data_scope, prompt_profile
      FROM users WHERE id = ? AND active = 1
    `).get(id) as UserRow | undefined;
    if (!row) return undefined;
    const scope = parseDataScope(row.data_scope);
    return {
      id: row.id,
      name: row.name,
      department: row.department,
      role: row.role,
      dataScope: scope.label,
      scope,
      promptProfile: row.prompt_profile,
    };
  }

  listUsers(): UserSummary[] {
    const rows = this.db.prepare(`
      SELECT id, name, department, role, data_scope
      FROM users WHERE active = 1 ORDER BY id
    `).all() as unknown as Array<{
      id: string;
      name: string;
      department: string;
      role: string;
      data_scope: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      department: row.department,
      role: row.role,
      dataScope: row.data_scope,
    }));
  }

  getPromptProfile(name: string): string {
    const row = this.db.prepare(
      "SELECT instructions FROM prompt_profiles WHERE name = ?",
    ).get(name) as { instructions?: string } | undefined;
    return row?.instructions ?? "遵守当前用户的数据访问范围。";
  }

  listMetricDefinitions(): MetricDefinition[] {
    const rows = this.db.prepare(`
      SELECT metric_key, display_name, description, formula, unit,
             time_field, dimensions_json, version
      FROM metric_definitions
      WHERE active = 1
      ORDER BY metric_key
    `).all() as unknown as MetricRow[];
    return rows.flatMap((row) => {
      const definition = this.parseMetricRow(row);
      return definition ? [definition] : [];
    });
  }

  getMetricDefinition(metricKey: string): MetricDefinition | undefined {
    if (!METRIC_KEYS.has(metricKey)) return undefined;
    const row = this.db.prepare(`
      SELECT metric_key, display_name, description, formula, unit,
             time_field, dimensions_json, version
      FROM metric_definitions
      WHERE metric_key = ? AND active = 1
    `).get(metricKey) as MetricRow | undefined;
    return row ? this.parseMetricRow(row) : undefined;
  }

  querySales(user: UserContext, query: SalesQuery): SalesQueryResult {
    this.assertRegionAllowed(user, query.region);
    this.assertOptionalDateRange(query.dateFrom, query.dateTo);
    const { where, params } = this.buildWhere(user, query);
    const aggregate = this.db.prepare(`
      SELECT COUNT(*) AS total_matches,
             COALESCE(SUM(amount), 0) AS total_amount,
             COALESCE(SUM(quantity), 0) AS total_quantity
      FROM sales WHERE ${where}
    `).get(...params) as AggregateRow;

    const requestedLimit = query.limit ?? 20;
    const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit)));
    const rows = this.db.prepare(`
      SELECT sale_date, product, region, amount, quantity, salesperson
      FROM sales WHERE ${where}
      ORDER BY sale_date ASC, id ASC
      LIMIT ?
    `).all(...params, limit) as unknown as SaleRow[];

    return {
      totalMatches: Number(aggregate.total_matches),
      totalAmount: Number(aggregate.total_amount ?? 0),
      totalQuantity: Number(aggregate.total_quantity ?? 0),
      rows: rows.map((row) => ({
        date: row.sale_date,
        product: row.product,
        region: row.region,
        amount: Number(row.amount),
        quantity: Number(row.quantity),
        salesperson: row.salesperson,
      })),
      appliedScope: user.dataScope,
    };
  }

  comparePeriods(user: UserContext, query: ComparePeriodsQuery): ComparePeriodsResult {
    const metric = this.getMetricDefinition(query.metricKey);
    if (!metric) throw new Error(`指标不存在或未启用：${query.metricKey}`);
    this.assertRegionAllowed(user, query.region);
    this.assertDate(query.currentFrom, "currentFrom");
    this.assertDate(query.currentTo, "currentTo");
    this.assertDate(query.previousFrom, "previousFrom");
    this.assertDate(query.previousTo, "previousTo");
    if (query.currentFrom > query.currentTo) throw new Error("当前期间开始日期不能晚于结束日期");
    if (query.previousFrom > query.previousTo) throw new Error("对比期间开始日期不能晚于结束日期");

    const filters: MetricFilters = {
      ...(query.region ? { region: query.region } : {}),
      ...(query.product ? { product: query.product } : {}),
      ...(query.salesperson ? { salesperson: query.salesperson } : {}),
    };
    const current = this.queryMetricPeriod(user, query.currentFrom, query.currentTo, filters, query.metricKey);
    const previous = this.queryMetricPeriod(user, query.previousFrom, query.previousTo, filters, query.metricKey);
    const absoluteChange = current.value - previous.value;
    const changeRate = previous.value === 0 ? null : absoluteChange / previous.value;

    return {
      metric,
      currentPeriod: { from: query.currentFrom, to: query.currentTo },
      previousPeriod: { from: query.previousFrom, to: query.previousTo },
      current,
      previous,
      absoluteChange,
      changeRate,
      filters,
      appliedScope: user.dataScope,
      validation: validateComparison(current.value, previous.value, absoluteChange, changeRate),
    };
  }

  breakdownMetric(user: UserContext, query: BreakdownMetricQuery): BreakdownMetricResult {
    const metric = this.getMetricDefinition(query.metricKey);
    if (!metric) throw new Error(`指标不存在或未启用：${query.metricKey}`);
    if (!metric.dimensions.includes(query.dimension)) {
      throw new Error(`指标 ${metric.displayName} 不支持按 ${query.dimension} 拆解`);
    }
    this.assertRegionAllowed(user, query.region);
    this.assertDate(query.currentFrom, "currentFrom");
    this.assertDate(query.currentTo, "currentTo");
    this.assertDate(query.previousFrom, "previousFrom");
    this.assertDate(query.previousTo, "previousTo");
    if (query.currentFrom > query.currentTo) throw new Error("当前期间开始日期不能晚于结束日期");
    if (query.previousFrom > query.previousTo) throw new Error("对比期间开始日期不能晚于结束日期");

    const filters: MetricFilters = {
      ...(query.region ? { region: query.region } : {}),
      ...(query.product ? { product: query.product } : {}),
      ...(query.salesperson ? { salesperson: query.salesperson } : {}),
    };
    const current = this.queryMetricPeriod(user, query.currentFrom, query.currentTo, filters, query.metricKey);
    const previous = this.queryMetricPeriod(user, query.previousFrom, query.previousTo, filters, query.metricKey);
    const absoluteChange = current.value - previous.value;
    const changeRate = previous.value === 0 ? null : absoluteChange / previous.value;
    const currentGroups = this.queryGroupedMetric(user, query.currentFrom, query.currentTo, filters, query.metricKey, query.dimension);
    const previousGroups = this.queryGroupedMetric(user, query.previousFrom, query.previousTo, filters, query.metricKey, query.dimension);
    const values = new Set([...currentGroups.keys(), ...previousGroups.keys()]);
    const groups = [...values].sort().map((value) => {
      const currentGroup = currentGroups.get(value) ?? this.emptyPeriodMetricValue();
      const previousGroup = previousGroups.get(value) ?? this.emptyPeriodMetricValue();
      const groupChange = currentGroup.value - previousGroup.value;
      return {
        value,
        current: currentGroup,
        previous: previousGroup,
        absoluteChange: groupChange,
        changeRate: previousGroup.value === 0 ? null : groupChange / previousGroup.value,
        contributionRate: absoluteChange === 0 ? null : groupChange / absoluteChange,
      };
    });

    return {
      metric,
      dimension: query.dimension,
      currentPeriod: { from: query.currentFrom, to: query.currentTo },
      previousPeriod: { from: query.previousFrom, to: query.previousTo },
      current,
      previous,
      absoluteChange,
      changeRate,
      groups,
      filters,
      appliedScope: user.dataScope,
      validation: validateBreakdown(absoluteChange, groups.map((group) => group.absoluteChange)),
    };
  }

  private queryMetricPeriod(
    user: UserContext,
    dateFrom: string,
    dateTo: string,
    filters: MetricFilters,
    metricKey: MetricKey,
  ): PeriodMetricValue {
    const { where, params } = this.buildWhere(user, { dateFrom, dateTo, ...filters });
    const aggregate = this.db.prepare(`
      SELECT COUNT(*) AS record_count,
             COALESCE(SUM(amount), 0) AS total_amount,
             COALESCE(SUM(quantity), 0) AS total_quantity
      FROM sales WHERE ${where}
    `).get(...params) as MetricAggregateRow;

    const recordCount = Number(aggregate.record_count);
    const totalAmount = Number(aggregate.total_amount ?? 0);
    const totalQuantity = Number(aggregate.total_quantity ?? 0);
    const value = metricKey === "sales_amount"
      ? totalAmount
      : metricKey === "sales_quantity"
        ? totalQuantity
        : metricKey === "order_count"
          ? recordCount
          : recordCount === 0 ? 0 : totalAmount / recordCount;

    return { value, recordCount, totalAmount, totalQuantity };
  }

  private queryGroupedMetric(
    user: UserContext,
    dateFrom: string,
    dateTo: string,
    filters: MetricFilters,
    metricKey: MetricKey,
    dimension: BreakdownDimension,
  ): Map<string, PeriodMetricValue> {
    const column = this.dimensionColumn(dimension);
    const { where, params } = this.buildWhere(user, { dateFrom, dateTo, ...filters });
    const rows = this.db.prepare(`
      SELECT ${column} AS group_value,
             COUNT(*) AS record_count,
             COALESCE(SUM(amount), 0) AS total_amount,
             COALESCE(SUM(quantity), 0) AS total_quantity
      FROM sales WHERE ${where}
      GROUP BY ${column}
    `).all(...params) as unknown as GroupAggregateRow[];
    return new Map(rows.map((row) => {
      const recordCount = Number(row.record_count);
      const totalAmount = Number(row.total_amount ?? 0);
      const totalQuantity = Number(row.total_quantity ?? 0);
      return [row.group_value, {
        value: this.metricValue(metricKey, recordCount, totalAmount, totalQuantity),
        recordCount,
        totalAmount,
        totalQuantity,
      }];
    }));
  }

  private emptyPeriodMetricValue(): PeriodMetricValue {
    return { value: 0, recordCount: 0, totalAmount: 0, totalQuantity: 0 };
  }

  private metricValue(metricKey: MetricKey, recordCount: number, totalAmount: number, totalQuantity: number): number {
    return metricKey === "sales_amount"
      ? totalAmount
      : metricKey === "sales_quantity"
        ? totalQuantity
        : metricKey === "order_count"
          ? recordCount
          : recordCount === 0 ? 0 : totalAmount / recordCount;
  }

  private dimensionColumn(dimension: BreakdownDimension): "region" | "product" | "salesperson" {
    const columns: Record<BreakdownDimension, "region" | "product" | "salesperson"> = {
      region: "region",
      product: "product",
      salesperson: "salesperson",
    };
    return columns[dimension];
  }

  private parseMetricRow(row: MetricRow): MetricDefinition | undefined {
    if (!METRIC_KEYS.has(row.metric_key)) return undefined;
    let dimensions: string[];
    try {
      const parsed = JSON.parse(row.dimensions_json);
      dimensions = Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
        ? parsed
        : [];
    } catch {
      dimensions = [];
    }
    return {
      metricKey: row.metric_key as MetricKey,
      displayName: row.display_name,
      description: row.description,
      formula: row.formula,
      unit: row.unit,
      timeField: row.time_field,
      dimensions,
      version: Number(row.version),
    };
  }

  private assertDate(value: string, field: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      throw new Error(`${field} 必须使用 YYYY-MM-DD 格式`);
    }
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error(`${field} 不是有效日期`);
    }
  }

  private assertOptionalDateRange(dateFrom?: string, dateTo?: string): void {
    if (dateFrom) this.assertDate(dateFrom, "dateFrom");
    if (dateTo) this.assertDate(dateTo, "dateTo");
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new Error("开始日期不能晚于结束日期");
    }
  }

  private assertRegionAllowed(user: UserContext, requestedRegion?: string): void {
    if (!requestedRegion || user.scope.kind === "all") return;
    if (requestedRegion.trim() !== user.scope.region) {
      throw new DataScopeViolationError(user.dataScope, requestedRegion.trim());
    }
  }

  private buildWhere(user: UserContext, query: SalesQuery): { where: string; params: string[] } {
    const clauses: string[] = [];
    const params: string[] = [];

    // 授权条件始终由服务端先追加，模型只能提供额外的业务过滤条件。
    // scope 已在 getUser() 中解析成白名单结构，不能由工具参数覆盖。
    if (user.scope.kind === "region") {
      clauses.push("region = ?");
      params.push(user.scope.region);
    } else if (user.scope.kind !== "all") {
      // 防御性分支：任何未来新增但未实现的 scope 类型都默认拒绝。
      clauses.push("1 = 0");
    }

    if (query.dateFrom) { clauses.push("sale_date >= ?"); params.push(query.dateFrom); }
    if (query.dateTo) { clauses.push("sale_date <= ?"); params.push(query.dateTo); }
    if (query.region) { clauses.push("region = ?"); params.push(query.region); }
    if (query.product) { clauses.push("product = ?"); params.push(query.product); }
    if (query.salesperson) { clauses.push("salesperson = ?"); params.push(query.salesperson); }

    return { where: clauses.length ? clauses.join(" AND ") : "1 = 1", params };
  }
}
