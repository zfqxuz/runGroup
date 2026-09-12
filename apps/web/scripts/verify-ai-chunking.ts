/**
 * DeepSeek 分块导入回归（不需要 DEEPSEEK_API_KEY）：
 * 用假模型响应驱动完整 importModuleWithDeepSeek，验证：
 * 1. 长文本被切成多段，逐段调用后合并；
 * 2. 同一 NPC / 引用在不同段落之间正确去重合并；
 * 3. 每段内容都进入最终 markdown，章节不丢；
 * 4. 编造的图片路径会被清掉。
 */
import { PrismaClient } from "@prisma/client";
import { importModuleWithDeepSeek } from "../src/server/ai/module-import";
import { chunkSourceText, mergeDraft } from "../src/server/ai/chunking";
import type { DeepSeekMessage } from "../src/server/ai/deepseek";
import { deleteAssetIfOrphan } from "../src/server/assets/cleanup";

const prisma = new PrismaClient();

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("AI 分块断言失败：" + message);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const output = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(output).set(buffer);
  return output;
}

function userTextOf(messages: readonly DeepSeekMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      parts.push(message.content);
      continue;
    }
    for (const part of message.content) {
      if (part.type === "text") parts.push(part.text);
    }
  }
  return parts.join("\n");
}

function markersOf(text: string): string[] {
  return Array.from(text.matchAll(/内容标记\s*([0-9]{2})/g)).map((match) => match[1] ?? "00");
}

async function main(): Promise<void> {
  const username = "e2e_ai_chunk_" + Date.now().toString(36);
  let moduleId: string | null = null;
  let userId: string | null = null;
  try {
    const user = await prisma.user.create({
      data: {
        username,
        displayName: "AI 分块验证",
        passwordHash: "not-used-for-login",
        email: username + "@example.test"
      },
      select: { id: true }
    });
    userId = user.id;

    const paragraphs: string[] = [];
    for (let index = 1; index <= 30; index += 1) {
      const marker = String(index).padStart(2, "0");
      const filler = "这是一段用于触发分块的长文本。".repeat(40);
      paragraphs.push(
        "## 第 " + marker + " 节\n\n" +
        "内容标记 " + marker + "：" + filler +
        " 本段包含人物「共享NPC」的补充设定，以及第 " + marker + " 条线索。"
      );
    }
    const story = paragraphs.join("\n\n");

    // 纯切块检查
    const chunks = chunkSourceText({ filename: "long-story.md", text: story });
    ensure(chunks.length >= 2, "长文本应被切成至少 2 段，实际 " + String(chunks.length));
    for (const marker of Array.from({ length: 30 }, (_, index) => String(index + 1).padStart(2, "0"))) {
      ensure(chunks.some((chunk) => chunk.text.includes("内容标记 " + marker)), "切块后不应丢失内容标记 " + marker);
    }

    // 假模型：每段都返回章节 + 同一个 NPC，用来验证去重合并
    let capturedModel = "";
    const fakeChat = async (
      messages: readonly DeepSeekMessage[],
      options?: { readonly model?: string }
    ): Promise<string> => {
      if (typeof options?.model === "string" && options.model.length > 0) capturedModel = options.model;
      const text = userTextOf(messages);
      const markers = markersOf(text);
      const first = markers[0] ?? "00";
      return JSON.stringify({
        sections: {
          "真相与背景": markers.map((marker) => "第 " + marker + " 段真相：分块合并测试内容 " + marker + "。").join("\n\n")
        },
        structured: {
          chapters: markers.map((marker) => ({
            id: "ch-" + marker,
            name: "章节 " + marker,
            summary: "第 " + marker + " 章摘要"
          })),
          npcs: markers.map((marker) => ({
            id: "npc-shared",
            name: "共享NPC",
            description: "共享NPC 在第 " + marker + " 段的补充。"
          })),
          clues: markers.map((marker) => ({ id: "clue-" + marker, title: "线索 " + marker, content: "内容标记 " + marker })),
          scenes: markers.map((marker) => ({
            id: "scene-" + marker,
            name: "场景 " + marker,
            background: "assets/images/fake-" + marker + ".png"
          }))
        }
      });
    };

    const storyFile = new File([toArrayBuffer(Buffer.from(story, "utf8"))], "long-story.md", {
      type: "text/markdown"
    });
    const result = await importModuleWithDeepSeek(
      {
        files: [storyFile],
        roomId: "",
        userId: user.id,
        author: "AI 分块验证",
        requestedSystem: "COC7",
        requestedEra: "MODERN",
        instructions: "分块验证",
        requestedModel: ""
      },
      { chat: fakeChat }
    );
    moduleId = result.moduleId;

    ensure(result.chunks >= 2, "结果应记录多段，实际 " + String(result.chunks));
    ensure(result.chunksCompleted === result.chunks, "所有文本段都应完成：" + String(result.chunksCompleted) + "/" + String(result.chunks));
    ensure(result.aiCalls >= result.chunks, "调用次数应不少于分段数");
    ensure(capturedModel === "deepseek-flash", "用户/默认选择的模型必须透传到每次调用，实际 " + capturedModel);

    const moduleRecord = await prisma.module.findUnique({ where: { id: result.moduleId } });
    if (moduleRecord === null) throw new Error("模块未落库");
    const content = moduleRecord.content as {
      text?: string;
      sections?: Record<string, string>;
      structured?: { chapters?: unknown[]; npcs?: { description?: string }[]; clues?: unknown[]; scenes?: { background?: string }[] };
    };
    const text = content.text ?? "";
    const chapterCount = content.structured?.chapters?.length ?? 0;
    const clueCount = content.structured?.clues?.length ?? 0;
    const npcCount = content.structured?.npcs?.length ?? 0;
    ensure(chapterCount === 30, "30 个章节标记应全部合并，实际 " + String(chapterCount));
    ensure(clueCount === 30, "30 条线索应全部合并，实际 " + String(clueCount));
    ensure(npcCount === 1, "同名同 id NPC 应合并成 1 个，实际 " + String(npcCount));
    ensure((content.structured?.scenes?.length ?? 0) === 30, "30 个场景应全部合并");
    for (const scene of content.structured?.scenes ?? []) {
      ensure(scene.background === undefined || scene.background === "", "编造的图片路径应被清掉");
    }
    ensure(text.includes("## 元信息") && text.includes("## 真相与背景") && text.includes("## 附录"), "14 个标准章节应完整");
    for (let index = 1; index <= 30; index += 1) {
      const marker = String(index).padStart(2, "0");
      ensure(text.includes("内容标记 " + marker), "合并后的正文缺少内容标记 " + marker);
    }
    ensure(text.includes("共享NPC"), "共享 NPC 应进入合并结果");

    // 纯 mergeDraft 的引用去重与假路径清理
    const merged = mergeDraft({
      title: "纯合并测试",
      system: "COC7",
      era: "MODERN",
      author: "test",
      extractions: [
        {
          label: "a",
          meta: {},
          sections: { "真相与背景": "段落 A。" },
          structured: {
            npc: [{ id: "npc-x", name: "同名NPC", description: "A 段" }],
            scene: [{ id: "scene-x", name: "场景", background: "assets/images/fake.png" }],
            encounter: [{ id: "enc-x", name: "遭遇", sceneId: "scene-x", sceneName: "场景" }]
          }
        },
        {
          label: "b",
          meta: {},
          sections: { "真相与背景": "段落 A。" },
          structured: {
            npc: [{ id: "npc-x", name: "同名NPC", description: "B 段更长的补充描述" }]
          }
        }
      ],
      images: [],
      validImagePaths: new Set()
    });
    ensure((merged.structured.npc?.length ?? 0) === 1, "同名同 id NPC 应合并成 1 个");
    ensure(merged.structured.scene?.length === 1, "场景应合并成 1 个");
    ensure((merged.structured.scene?.[0]?.background as string) === "", "假图片路径应被清空");
    ensure(merged.sections["真相与背景"] === "段落 A。", "重复章节段落应去重");

    console.log("PASS AI 分块导入：切段 / 分次调用 / 合并去重 / 引用重映射 / 假路径清理");
    console.log(
      "  chunks=" + String(result.chunks) +
      " aiCalls=" + String(result.aiCalls) +
      " npcs=" + String(npcCount) +
      " chapters=" + String(chapterCount)
    );
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

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
