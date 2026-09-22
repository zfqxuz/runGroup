import { runDshTask } from "@/server/dsh/runner";
import { resolveDshContext } from "@/server/dsh/context";
import { buildReadTask } from "@/server/dsh/skills/prompts";
import { resolveSkillForContext } from "@/server/dsh/skills/registry";
import { runModuleDshTurn } from "@/server/dsh/module-assistant";
import type { DshTurnInput, DshTurnOptions, DshTurnResult } from "@/server/dsh/types";

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * dsh 统一入口：解析页面上下文 → 选技能 → 执行。
 *
 * - READ 技能：把有界上下文写成 context.json，交给 dsh 产出 result.json.reply。
 * - WRITE 技能：目前只有 `module.edit`，委托给既有的 `runModuleDshTurn` 落库。
 */
export async function runDshTurn(input: DshTurnInput, options: DshTurnOptions = {}): Promise<DshTurnResult> {
  const resolved = await resolveDshContext(input.pathname, {
    id: input.userId,
    username: input.username,
    role: input.role
  });
  if (resolved.ok === false) return { ok: false, reply: "", error: resolved.error };
  const context = resolved.context;

  const picked = resolveSkillForContext(input.skillId, context);
  if (picked.ok === false) return { ok: false, reply: "", error: picked.error };
  const skill = picked.skill;

  if (skill.effect === "WRITE") {
    if (skill.id === "module.edit") {
      if (context.moduleId === undefined) {
        return { ok: false, reply: "", error: "当前页面没有团本上下文，无法修改团本" };
      }
      if (context.canEditModule === false) {
        return { ok: false, reply: "", error: "只有团本作者或房间 KP 可以修改团本" };
      }
      const result = await runModuleDshTurn(
        { moduleId: context.moduleId, userId: input.userId, message: input.message, history: input.history },
        options
      );
      return { ...result, skillId: skill.id };
    }
    return { ok: false, reply: "", error: "该写入技能暂未实现" };
  }

  if (skill.spec === undefined) return { ok: false, reply: "", error: "技能缺少提示词配置" };

  const built = buildReadTask({
    context,
    message: input.message,
    history: input.history,
    spec: skill.spec
  });

  options.onEvent?.({ type: "progress", text: skill.spec.progressLabel ?? "ai 正在处理…" });
  const run = await runDshTask(built, options);
  if (run.exitCode !== 0) {
    console.error("[dsh] 技能执行失败", skill.id, run.exitCode, run.stderr.slice(0, 2000));
    return { ok: false, reply: "", error: "ai 执行失败（退出码 " + String(run.exitCode) + "），请稍后重试" };
  }

  const reply = cleanText(recordOf(run.result)?.reply, 8_000);
  if (reply === null) {
    console.error("[dsh] 技能没有返回 reply", skill.id, run.stdout.slice(0, 1000));
    return { ok: false, reply: "", error: "ai 没有返回可用内容，请换个说法再试" };
  }
  return { ok: true, reply, skillId: skill.id };
}
