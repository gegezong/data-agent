import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSchema, openDatabase } from "../data/database.ts";
import { config, PROJECT_ROOT } from "../config.ts";
import { METRIC_DEFINITIONS } from "../data/metrics.ts";

type SaleSeed = {
  date: string;
  product: string;
  region: string;
  amount: number;
  quantity: number;
  salesperson: string;
};

function loadCsv(): SaleSeed[] {
  const file = resolve(PROJECT_ROOT, "data", "sales.csv");
  const [, ...lines] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  return lines.map((line) => {
    const [date, product, region, amount, quantity, salesperson] = line.split(",").map((value) => value.trim());
    return { date, product, region, amount: Number(amount), quantity: Number(quantity), salesperson };
  });
}

const db = openDatabase(config.dbPath);
createSchema(db);
db.exec("DELETE FROM sales; DELETE FROM users; DELETE FROM prompt_profiles; DELETE FROM metric_definitions;");

db.prepare(`
  INSERT INTO prompt_profiles (name, instructions) VALUES (?, ?)
`).run("analyst", "先查数据再回答；需要多行明细时使用 Markdown 表格；明确区分事实、推断和建议。\n");
db.prepare(`
  INSERT INTO prompt_profiles (name, instructions) VALUES (?, ?)
`).run("finance", "关注金额、数量、趋势和异常；所有结论必须能从工具返回的数据验证。\n");

const insertMetric = db.prepare(`
  INSERT INTO metric_definitions
    (metric_key, display_name, description, formula, unit, time_field, dimensions_json, version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const metric of METRIC_DEFINITIONS) {
  insertMetric.run(
    metric.metricKey,
    metric.displayName,
    metric.description,
    metric.formula,
    metric.unit,
    metric.timeField,
    JSON.stringify(metric.dimensions),
    1,
  );
}

const users = [
  ["u001", "王小姐", "销售部", "销售经理", "region:华东", "analyst"],
  ["u002", "李先生", "财务部", "财务分析师", "all", "finance"],
  ["u003", "陈先生", "销售部", "销售经理", "region:华南", "analyst"],
] as const;
const insertUser = db.prepare(`
  INSERT INTO users (id, name, department, role, data_scope, prompt_profile)
  VALUES (?, ?, ?, ?, ?, ?)
`);
for (const user of users) insertUser.run(...user);

const insertSale = db.prepare(`
  INSERT INTO sales (sale_date, product, region, amount, quantity, salesperson)
  VALUES (?, ?, ?, ?, ?, ?)
`);
for (const row of loadCsv()) {
  insertSale.run(row.date, row.product, row.region, row.amount, row.quantity, row.salesperson);
}

const count = db.prepare("SELECT COUNT(*) AS count FROM sales").get() as { count: number };
console.log(`数据库已初始化：${count.count} 条销售记录，3 个用户，${METRIC_DEFINITIONS.length} 个指标，2 个角色提示配置。`);
console.log(`数据库文件：${config.dbPath}`);
db.close();
