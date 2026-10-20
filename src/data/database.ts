import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      role TEXT NOT NULL,
      data_scope TEXT NOT NULL CHECK (
        data_scope = 'all'
        OR (substr(data_scope, 1, 7) = 'region:' AND length(data_scope) > 7)
      ),
      prompt_profile TEXT NOT NULL DEFAULT 'analyst',
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS prompt_profiles (
      name TEXT PRIMARY KEY,
      instructions TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metric_definitions (
      metric_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      formula TEXT NOT NULL,
      unit TEXT NOT NULL,
      time_field TEXT NOT NULL,
      dimensions_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY,
      sale_date TEXT NOT NULL,
      product TEXT NOT NULL,
      region TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 0),
      quantity INTEGER NOT NULL CHECK (quantity >= 0),
      salesperson TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
    CREATE INDEX IF NOT EXISTS idx_sales_region ON sales(region);
    CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(product);
    CREATE INDEX IF NOT EXISTS idx_sales_date_region ON sales(sale_date, region);
  `);
}
