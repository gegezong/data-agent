import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UserContext } from "../data/repository.ts";

export type StaticPrompt = {
  persona: string;
  rules: string;
  outputFormat: string;
};

export async function loadStaticPrompt(promptDir: string): Promise<StaticPrompt> {
  const [persona, rules, outputFormat] = await Promise.all([
    readFile(join(promptDir, "persona.md"), "utf8"),
    readFile(join(promptDir, "rules.md"), "utf8"),
    readFile(join(promptDir, "output-format.md"), "utf8"),
  ]);
  return { persona, rules, outputFormat };
}

export function buildSystemPrompt(
  staticPrompt: StaticPrompt,
  user: UserContext,
  roleInstructions: string,
): string {
  return [
    staticPrompt.persona,
    "## 当前用户上下文",
    `用户 ID：${user.id}`,
    `姓名：${user.name}`,
    `部门：${user.department}`,
    `角色：${user.role}`,
    `数据权限范围：${user.dataScope}`,
    "",
    "## 当前角色补充规则",
    roleInstructions,
    staticPrompt.rules,
    staticPrompt.outputFormat,
  ].join("\n\n");
}
