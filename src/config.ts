import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = resolve(PROJECT_ROOT, "data");
export const PROMPTS_DIR = resolve(PROJECT_ROOT, "prompts", "analyst");

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = Object.freeze({
  port: numberEnv("PORT", 3000),
  dbPath: resolve(PROJECT_ROOT, process.env.DB_PATH ?? "data/data-agent.db"),
  defaultUserId: process.env.DEFAULT_USER_ID ?? "u001",
  model: process.env.MODEL?.trim() || "",
  maxQueryLimit: 100,
  requestBodyLimit: "32kb",
});
