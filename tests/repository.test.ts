import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createSchema } from "../src/data/database.ts";
import { METRIC_DEFINITIONS } from "../src/data/metrics.ts";
import { DataRepository } from "../src/data/repository.ts";
import { createBreakdownMetricTool } from "../src/tools/breakdown-metric.ts";

function makeRepository(): DataRepository {
  const db = new DatabaseSync(":memory:");
  createSchema(db);
  db.exec(`
    INSERT INTO users VALUES ('u001', '王小姐', '销售部', '销售经理', 'region:华东', 'analyst', 1);
    INSERT INTO users VALUES ('u002', '李先生', '财务部', '财务分析师', 'all', 'finance', 1);
    INSERT INTO prompt_profiles VALUES ('analyst', '先查数据');
    INSERT INTO metric_definitions
      (metric_key, display_name, description, formula, unit, time_field, dimensions_json, version)
    VALUES
      ${METRIC_DEFINITIONS.map((metric) => `('${metric.metricKey}', '${metric.displayName}', '${metric.description}', '${metric.formula}', '${metric.unit}', '${metric.timeField}', '${JSON.stringify(metric.dimensions)}', 1)`).join(",\n      ")};
    INSERT INTO sales (sale_date, product, region, amount, quantity, salesperson)
      VALUES ('2024-01-01', '笔记本电脑', '华东', 45000, 15, '张伟');
    INSERT INTO sales (sale_date, product, region, amount, quantity, salesperson)
      VALUES ('2024-01-02', '手机', '华南', 28000, 20, '李娜');
    INSERT INTO sales (sale_date, product, region, amount, quantity, salesperson)
      VALUES ('2024-02-01', '笔记本电脑', '华东', 52000, 17, '张伟');
    INSERT INTO sales (sale_date, product, region, amount, quantity, salesperson)
      VALUES ('2024-02-02', '手机', '华南', 31000, 24, '李娜');
  `);
  return new DataRepository(db);
}

describe("DataRepository", () => {
  it("在查询层强制执行区域权限", () => {
    const repository = makeRepository();
    const user = repository.getUser("u001");
    assert.ok(user);
    const result = repository.querySales(user, {});
    assert.equal(result.totalMatches, 2);
    assert.equal(result.totalAmount, 97000);
  });

  it("允许全公司用户查询所有区域", () => {
    const repository = makeRepository();
    const user = repository.getUser("u002");
    assert.ok(user);
    const result = repository.querySales(user, {});
    assert.equal(result.totalMatches, 4);
    assert.equal(result.totalAmount, 156000);
  });

  it("业务过滤条件不能扩大区域用户的授权范围", () => {
    const repository = makeRepository();
    const user = repository.getUser("u001");
    assert.ok(user);
    assert.throws(
      () => repository.querySales(user, { region: "华南" }),
      /权限不足.*华南/,
    );
  });

  it("非法 data_scope 配置默认失败，不进入查询层", () => {
    const repository = makeRepository();
    const db = (repository as unknown as { db: { prepare: (sql: string) => { run: (...args: string[]) => void } } }).db;
    db.prepare(`
      INSERT INTO users (id, name, department, role, data_scope, prompt_profile)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("u999", "错误配置", "测试部", "测试", "region:*", "analyst");

    assert.throws(() => repository.getUser("u999"), /数据范围配置非法/);
  });

  it("读取指标定义并按指标口径比较两个期间", () => {
    const repository = makeRepository();
    const user = repository.getUser("u001");
    assert.ok(user);

    const definitions = repository.listMetricDefinitions();
    assert.equal(definitions.length, 4);
    assert.equal(repository.getMetricDefinition("sales_amount")?.formula, "SUM(amount)");

    const result = repository.comparePeriods(user, {
      metricKey: "sales_amount",
      currentFrom: "2024-02-01",
      currentTo: "2024-02-29",
      previousFrom: "2024-01-01",
      previousTo: "2024-01-31",
    });
    assert.equal(result.current.value, 52000);
    assert.equal(result.previous.value, 45000);
    assert.equal(result.absoluteChange, 7000);
    assert.equal(result.changeRate, 7000 / 45000);
    assert.equal(result.appliedScope, "region:华东");
  });

  it("期间比较在授权检查失败时不会执行数据库聚合", () => {
    const repository = makeRepository();
    const user = repository.getUser("u001");
    assert.ok(user);
    assert.throws(
      () => repository.comparePeriods(user, {
        metricKey: "sales_amount",
        currentFrom: "2024-02-01",
        currentTo: "2024-02-29",
        previousFrom: "2024-01-01",
        previousTo: "2024-01-31",
        region: "华南",
      }),
      /权限不足.*华南/,
    );
  });

  it("按产品拆解两个期间的指标变化并校验分组合计", () => {
    const repository = makeRepository();
    const user = repository.getUser("u001");
    assert.ok(user);

    const result = repository.breakdownMetric(user, {
      metricKey: "sales_amount",
      currentFrom: "2024-02-01",
      currentTo: "2024-02-29",
      previousFrom: "2024-01-01",
      previousTo: "2024-01-31",
      dimension: "product",
    });
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0]?.value, "笔记本电脑");
    assert.equal(result.groups[0]?.absoluteChange, 7000);
    assert.equal(result.validation.status, "passed");
    assert.equal(result.validation.warnings.length, 0);
  });

  it("维度拆解同样执行区域权限", () => {
    const repository = makeRepository();
    const user = repository.getUser("u001");
    assert.ok(user);
    assert.throws(
      () => repository.breakdownMetric(user, {
        metricKey: "sales_amount",
        currentFrom: "2024-02-01",
        currentTo: "2024-02-29",
        previousFrom: "2024-01-01",
        previousTo: "2024-01-31",
        dimension: "product",
        region: "华南",
      }),
      /权限不足.*华南/,
    );
  });

  it("可以注册维度拆解工具", () => {
    const repository = makeRepository();
    const user = repository.getUser("u001");
    assert.ok(user);
    const tool = createBreakdownMetricTool(repository, user);
    assert.equal(tool.name, "breakdown_metric");
  });

  it("拒绝无效日期和倒置的明细查询区间", () => {
    const repository = makeRepository();
    const user = repository.getUser("u001");
    assert.ok(user);
    assert.throws(() => repository.querySales(user, { dateFrom: "2024-02-30" }), /不是有效日期/);
    assert.throws(() => repository.querySales(user, {
      dateFrom: "2024-02-02",
      dateTo: "2024-02-01",
    }), /开始日期不能晚于结束日期/);
  });
});
