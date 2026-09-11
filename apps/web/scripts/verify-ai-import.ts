/**
 * DeepSeek 智能团本导入验证。
 * 需要 apps/web/.env 中配置 DEEPSEEK_API_KEY；无 key 时输出 SKIP 并正常退出。
 * 运行：npx tsx --env-file=.env scripts/verify-ai-import.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { DEEPSEEK_MODELS, isDeepSeekConfigured } from "../src/server/ai/deepseek";
import { importModuleWithDeepSeek } from "../src/server/ai/module-import";
import { deleteAssetIfOrphan } from "../src/server/assets/cleanup";

const prisma = new PrismaClient();
const TEST_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function toFilePart(input: Buffer): ArrayBuffer {
  const output = new ArrayBuffer(input.byteLength);
  new Uint8Array(output).set(input);
  return output;
}

async function readOptionalImage(): Promise<Buffer> {
  const path = process.env.AI_IMPORT_TEST_IMAGE;
  if (path === undefined || path.length === 0) return TEST_IMAGE;
  try {
    return readFileSync(path);
  } catch {
    return TEST_IMAGE;
  }
}

async function main(): Promise<void> {
  if (isDeepSeekConfigured() === false) {
    console.log("SKIP DeepSeek 智能导入：未配置 DEEPSEEK_API_KEY");
    return;
  }

  const suffix = Date.now().toString(36);
  const username = "e2e_ai_" + suffix;
  const password = "e2e_ai_pass";
  let moduleId: string | null = null;
  let userId: string | null = null;

  try {
    const user = await prisma.user.create({
      data: { username, displayName: "AI 导入验证", passwordHash: "not-used-for-login", email: username + "@example.test" },
      select: { id: true }
    });
    userId = user.id;

    const story = [
      "# 测试团本：月夜失踪案",
      "背景：幻想乡人类村落连续三晚有人失踪，谜底指向一间废弃茶屋。",
      "场景一：村口告示牌，线索是红色符纸。",
      "场景二：废弃茶屋内室，遭遇一只发狂的妖精。",
      "场景三：地下室祭坛，最终 Boss 是操控影子的妖怪。",
      "关键 NPC：慧音负责调查线索；魔理沙提供火力支援。",
      "魔法：茶屋里残留着符纸法阵，调查员可以学会「退魔符」法术，消耗 2 点 MP、1d3 点 SAN，对妖怪造成 1d6 伤害。",
      "图片 red-clue.png 是一张红色符纸的照片，请写进线索章节并引用。"
    ].join("\n");
    const textFile = new File([toFilePart(Buffer.from(story, "utf8"))], "story.md", { type: "text/markdown" });
    const imageFile = new File([toFilePart(await readOptionalImage())], "red-clue.png", { type: "image/png" });

    const result = await importModuleWithDeepSeek({
      files: [textFile, imageFile],
      roomId: "",
      userId: user.id,
      author: "AI E2E",
      requestedSystem: "COC7",
      requestedEra: "MODERN",
      instructions: "尽量简短，确保结构化 chapters / scenes / encounters 各至少 1 个，并在图片章节引用给定路径；素材包含魔法，structured.magic 至少整理 1 条法术。",
      requestedModel: ""
    });
    moduleId = result.moduleId;

    const moduleRecord = await prisma.module.findUnique({
      where: { id: result.moduleId },
      include: { assets: { include: { asset: true } } }
    });
    if (moduleRecord === null) throw new Error("模块创建后读取失败");
    const content = moduleRecord.content as {
      text?: string;
      structured?: { scenes?: unknown[]; encounters?: unknown[]; chapters?: unknown[]; magic?: unknown[] };
    };
    const text = content.text ?? "";

    ensure(result.attempts >= 1 && result.attempts <= 3, "DeepSeek 尝试次数应在 1-3 之间");
    ensure(result.imagesUsed === 1, "应使用 1 张图片作为视觉素材");
    ensure(DEEPSEEK_MODELS.some((model) => model.id === result.model), "返回模型应在推荐列表中");
    ensure(text.includes("## 元信息") && text.includes("## 真相与背景"), "标准章节应完整");
    ensure(text.includes("## 地点与场景") && text.includes("## 遭遇与战斗"), "关键章节应存在");
    ensure(text.includes("```yaml module-chapter") && text.includes("```yaml module-scene"), "结构化 YAML 块应写入");
    ensure((content.structured?.chapters?.length ?? 0) >= 1, "至少应有 1 个结构化章节");
    ensure((content.structured?.scenes?.length ?? 0) >= 1, "至少应有 1 个结构化场景");
    ensure((content.structured?.encounters?.length ?? 0) >= 1, "至少应有 1 个结构化遭遇");
    ensure((content.structured?.magic?.length ?? 0) >= 1, "素材涉及魔法时至少应有 1 条结构化魔法规则");
    ensure(moduleRecord.assets.length >= 1, "图片素材应保存为模块资源");

    console.log("PASS DeepSeek 智能团本导入");
    console.log("  model=" + result.model + " attempts=" + String(result.attempts) + " images=" + String(result.imagesUsed));
    console.log("  sections=" + String(parseInt(String(text.split("## ").length - 1), 10)) + " structured=" + JSON.stringify({
      chapters: content.structured?.chapters?.length ?? 0,
      scenes: content.structured?.scenes?.length ?? 0,
      encounters: content.structured?.encounters?.length ?? 0,
      magic: content.structured?.magic?.length ?? 0
    }));
  } finally {
    if (moduleId !== null) {
      const assets = await prisma.moduleAsset.findMany({ where: { moduleId }, select: { assetId: true } });
      await prisma.module.deleteMany({ where: { id: moduleId } });
      for (const item of assets) await deleteAssetIfOrphan(item.assetId);
    }
    if (userId !== null) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("AI 导入断言失败：" + message);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
