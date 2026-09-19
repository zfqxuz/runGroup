import { createHash } from "node:crypto";
import { parseStructuredBlocks } from "@/server/modules/structure";
import { syncModuleTemplatesFromModule } from "@/server/modules/templates";
import { ensureModuleRevision } from "@/server/modules/revision";
import { prisma } from "@/server/db/prisma";
import { runDshTask, type DshStreamEvent } from "@/server/dsh/runner";

export interface DshHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ModuleDshTurnInput {
  readonly moduleId: string;
  readonly userId: string;
  readonly message: string;
  readonly history: readonly DshHistoryMessage[];
}

export interface ModuleDshTurnResult {
  readonly ok: boolean;
  readonly reply: string;
  readonly version?: string;
  readonly error?: string;
}

export interface ModuleDshTurnOptions {
  readonly onEvent?: (event: DshStreamEvent) => void;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function bumpMinorVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (match === null) return "1.1.0";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return String(major) + "." + String(minor + 1) + ".0";
}

function historyBlock(history: readonly DshHistoryMessage[]): string {
  if (history.length === 0) return "（这是第一轮对话）";
  return history
    .slice(-12)
    .map((item) => (item.role === "user" ? "用户：" : "助手：") + item.content.slice(0, 2000))
    .join("\n");
}

export function buildModuleDshTask(input: {
  readonly module: { readonly id: string; readonly title: string; readonly system: string | null; readonly era: string | null; readonly version: string; readonly author: string | null };
  readonly message: string;
  readonly history: readonly DshHistoryMessage[];
}): string {
  return [
    "# 角色",
    "你是「幽暗之门」平台的团本编辑助手，根据用户意见修改一个已有的团本。",
    "",
    "# 当前团本",
    "- 团本 id：" + input.module.id,
    "- 标题：" + input.module.title,
    "- 规则系统：" + (input.module.system ?? "未指定") + "（不可更改）",
    "- 年代：" + (input.module.era ?? "未指定") + "（不可更改）",
    "- 当前版本：" + input.module.version + "（版本号由系统管理，你不要修改）",
    "- 作者：" + (input.module.author ?? "未署名"),
    "",
    "# 数据来源（严格限制）",
    "- 只允许读取当前工作目录下的 module.json 与 task.md。",
    "- 禁止访问网络、数据库、其它团本，以及工作目录以外的任何文件。",
    "- 不要执行与本次团本修改无关的命令。",
    "",
    "# 可以改动",
    "- content.text：团本正文 Markdown。",
    "- content.structured 下的 npcs / clues / items / scenes / chapters / encounters / magic / rewards / endings。",
    "- 仅当用户明确要求时，才可以改 title / synopsis / background / occupationRecommendation。",
    "",
    "# 不可以改动",
    "- id、system、era、roomId、ownerId、assets、isPublished、sourceType、packagePath、metadata、version、createdAt。",
    "- 不要把 COC7 团本改成其它规则系统；不要删除或替换与本轮要求无关的内容。",
    "",
    "# 本轮对话",
    historyBlock(input.history),
    "用户新要求：" + input.message,
    "",
    "# 输出要求",
    "- 把修改后的完整团本数据写到当前目录的 result.json。",
    "- result.json 顶层结构：{ \"reply\": \"给用户看的中文简短回复\", \"title\": \"...\", \"synopsis\": \"...\", \"background\": \"...\", \"occupationRecommendation\": \"...\", \"content\": { \"format\": \"markdown\", \"text\": \"...\", \"structured\": { ... } } }。",
    "- reply 只写结论与改动摘要，不要包含思维链、推理过程或工具调用细节。",
    "- 如果用户要求超出可改动范围，保持原样，并在 reply 中说明原因。",
    "- 不要修改 version。"
  ].join("\n");
}

interface AppliedModule {
  readonly title: string;
  readonly synopsis: string | null;
  readonly background: string | null;
  readonly occupationRecommendation: string | null;
  readonly content: Record<string, unknown>;
}

function validateResult(raw: unknown, moduleId: string, existingContent: Record<string, unknown>): AppliedModule | { error: string } {
  const result = recordOf(raw);
  if (result === null) return { error: "dsh 没有返回合法的 result.json" };
  const content = recordOf(result.content);
  if (content === null) return { error: "dsh 返回的 content 不是对象" };
  const text = cleanText(content.text, 400_000);
  if (text.length === 0) return { error: "dsh 返回的正文为空" };

  const id = cleanText(result.id, 120);
  if (id.length > 0 && id !== moduleId) return { error: "dsh 试图修改团本 id，已拒绝" };

  const structured = recordOf(content.structured) ?? (parseStructuredBlocks(text) as unknown as Record<string, unknown>);
  const nextContent: Record<string, unknown> = {
    ...existingContent,
    format: cleanText(content.format, 40) || (typeof existingContent.format === "string" ? existingContent.format : "markdown"),
    text,
    structured
  };
  return {
    title: cleanText(result.title, 120),
    synopsis: typeof result.synopsis === "string" ? cleanText(result.synopsis, 4000) : null,
    background: typeof result.background === "string" ? cleanText(result.background, 8000) : null,
    occupationRecommendation: typeof result.occupationRecommendation === "string" ? cleanText(result.occupationRecommendation, 8000) : null,
    content: nextContent
  };
}

function moduleSnapshot(module: {
  readonly id: string;
  readonly title: string;
  readonly system: string | null;
  readonly era: string | null;
  readonly version: string;
  readonly author: string | null;
  readonly synopsis: string | null;
  readonly background: string | null;
  readonly occupationRecommendation: string | null;
  readonly content: unknown;
}): Record<string, unknown> {
  return {
    id: module.id,
    title: module.title,
    system: module.system,
    era: module.era,
    version: module.version,
    author: module.author,
    synopsis: module.synopsis,
    background: module.background,
    occupationRecommendation: module.occupationRecommendation,
    content: module.content
  };
}

export async function runModuleDshTurn(input: ModuleDshTurnInput, options: ModuleDshTurnOptions = {}): Promise<ModuleDshTurnResult> {
  const moduleRecord = await prisma.module.findUnique({ where: { id: input.moduleId } });
  if (moduleRecord === null) return { ok: false, reply: "", error: "团本不存在" };

  const existingContent = recordOf(moduleRecord.content) ?? {};
  const snapshot = moduleSnapshot(moduleRecord);
  const task = buildModuleDshTask({
    module: {
      id: moduleRecord.id,
      title: moduleRecord.title,
      system: moduleRecord.system,
      era: moduleRecord.era,
      version: moduleRecord.version,
      author: moduleRecord.author
    },
    message: input.message,
    history: input.history
  });

  options.onEvent?.({ type: "progress", text: "ai 正在阅读团本并思考…" });
  const run = await runDshTask({
    task: "读取当前目录的 task.md，严格按照其中的要求执行，完成后只输出一句话结论。",
    files: {
      "module.json": JSON.stringify(snapshot, null, 2),
      "task.md": task
    }
  }, { onEvent: options.onEvent });

  if (run.exitCode !== 0) {
    console.error("[module-dsh] dsh 执行失败", run.exitCode, run.stderr.slice(0, 2000));
    return { ok: false, reply: "", error: "dsh 执行失败（退出码 " + String(run.exitCode) + "），请稍后重试" };
  }

  options.onEvent?.({ type: "progress", text: "正在校验修改结果…" });
  const validated = validateResult(run.result, moduleRecord.id, existingContent);
  if ("error" in validated) {
    console.error("[module-dsh] 结果校验失败", validated.error, run.stdout.slice(0, 1000));
    return { ok: false, reply: "", error: validated.error };
  }
  const reply = cleanText(recordOf(run.result)?.reply, 4000) || "团本已按你的意见修改。";
  const newVersion = bumpMinorVersion(moduleRecord.version);

  options.onEvent?.({ type: "progress", text: "正在保存新版本…" });
  await prisma.module.update({
    where: { id: moduleRecord.id },
    data: {
      title: validated.title.length > 0 ? validated.title : moduleRecord.title,
      synopsis: validated.synopsis === null ? moduleRecord.synopsis : validated.synopsis,
      background: validated.background === null ? moduleRecord.background : validated.background,
      occupationRecommendation:
        validated.occupationRecommendation === null ? moduleRecord.occupationRecommendation : validated.occupationRecommendation,
      version: newVersion,
      content: validated.content as never
    }
  });

  try {
    await syncModuleTemplatesFromModule(moduleRecord.id);
  } catch (error) {
    console.error("[module-dsh] 同步模板失败", error);
  }
  try {
    await ensureModuleRevision(moduleRecord.id);
  } catch (error) {
    console.error("[module-dsh] 保存版本快照失败", error);
  }
  await prisma.adminAuditLog.create({
    data: {
      actorId: input.userId,
      action: "module.dsh",
      targetType: "Module",
      targetId: moduleRecord.id,
      detail: {
        message: input.message.slice(0, 500),
        fromVersion: moduleRecord.version,
        toVersion: newVersion,
        replyHash: createHash("sha256").update(reply).digest("hex").slice(0, 16)
      } as never
    }
  }).catch(() => undefined);

  return { ok: true, reply, version: newVersion };
}
