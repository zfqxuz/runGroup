import { createHash, randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { extractImages, extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { prisma } from "@/server/db/prisma";
import { storeImage, publicPath } from "@/server/assets/storage";
import { REQUIRED_MODULE_SECTIONS, parseModuleMarkdown, slugifyModuleId } from "@/server/modules/format";
import { parseStructuredBlocks } from "@/server/modules/structure";
import { syncModuleTemplatesFromModule } from "@/server/modules/templates";
import {
  chatDeepSeek,
  extractJsonObject,
  DeepSeekTruncationError,
  type DeepSeekContentPart,
  type DeepSeekMessage,
  DEEPSEEK_MODELS
} from "@/server/ai/deepseek";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 40;
const MAX_IMAGES = 12;
const PER_FILE_CHARS = 24000;
const TOTAL_CHARS = 120000;

export interface AiImportWarning {
  readonly filename: string;
  readonly message: string;
}

export interface AiImportResult {
  readonly moduleId: string;
  readonly title: string;
  readonly model: string;
  /** 本次导入专属的 AI 会话 id；每次导入都会重新生成，不复用旧上下文。 */
  readonly sessionId: string;
  readonly attempts: number;
  readonly imagesUsed: number;
  readonly warnings: readonly AiImportWarning[];
}

interface ExtractedImage {
  readonly filename: string;
  readonly buffer: Buffer;
  readonly mime: string;
}

interface ExtractedSource {
  readonly filename: string;
  readonly kind: string;
  readonly text: string;
  readonly extension: string;
  readonly buffer: Buffer;
  readonly embeddedImages?: readonly ExtractedImage[];
}

interface PreparedImage {
  readonly filename: string;
  readonly relativePath: string;
  readonly dataUrl: string;
  readonly buffer: Buffer;
  readonly mime: string;
}

interface PreparedSources {
  readonly sources: readonly ExtractedSource[];
  readonly images: readonly PreparedImage[];
  readonly warnings: readonly AiImportWarning[];
}

function warning(filename: string, message: string): AiImportWarning {
  return { filename, message };
}

function extensionOfName(filename: string): string {
  const match = /[.]([a-z0-9]+)$/i.exec(filename);
  return match?.[1]?.toLowerCase() ?? "";
}

function stripXml(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, "\n<w:p ")
    .replace(/<a:p[ >]/g, "\n<a:p ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readDocx(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("word/document.xml");
  if (entry === null) return "";
  return stripXml(entry.getData().toString("utf8"));
}

function readPptx(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const parts: string[] = [];
  for (const entry of zip.getEntries()) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)) {
      const xml = entry.getData().toString("utf8");
      const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((match) => stripXml(match[1] ?? ""));
      if (texts.length > 0) parts.push("【" + entry.entryName + "】\n" + texts.join("\n"));
    }
  }
  return parts.join("\n\n");
}

function readSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (sheet === undefined) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim().length > 0) parts.push("【工作表：" + name + "】\n" + csv);
  }
  return parts.join("\n\n");
}

function safeNameStem(input: string): string {
  const base = input
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return (base.length > 0 ? base : "image") + "-" + createHash("sha1").update(input).digest("hex").slice(0, 6);
}

const TEXT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "json",
  "yaml",
  "yml",
  "csv",
  "tsv",
  "html",
  "htm",
  "xml",
  "log",
  "text"
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "svg"
]);

function imageMime(buffer: Buffer): string {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.length > 12 && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length > 3 && buffer.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (buffer.length > 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "avis"].includes(brand)) return "image/heif";
  }
  if (buffer.length > 3 && buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a) return "image/tiff";
  if (buffer.length > 3 && buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00) return "image/tiff";
  return "";
}

/** 除了常见魔数外，再交给 sharp 兜底识别 HEIC / AVIF / SVG / BMP / TIFF 等。 */
async function detectImageMime(buffer: Buffer, extension: string): Promise<string> {
  const direct = imageMime(buffer);
  if (direct.length > 0) return direct;
  if (IMAGE_EXTENSIONS.has(extension) === false) return "";
  try {
    const metadata = await sharp(buffer, { limitInputPixels: 4096 * 4096 }).metadata();
    if (typeof metadata.format === "string" && metadata.format.length > 0) {
      return metadata.format === "jpeg" ? "image/jpeg" : "image/" + metadata.format;
    }
  } catch {
    // 识别失败按普通二进制文件处理
  }
  return "";
}

/** 发给 vision 模型前先压缩，避免原始大图撑爆请求体与上下文。 */
async function compressForVision(buffer: Buffer): Promise<{ readonly buffer: Buffer; readonly mime: string }> {
  const normalized = await sharp(buffer, { limitInputPixels: 4096 * 4096 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { buffer: normalized, mime: "image/jpeg" };
}

/**
 * 解析 PDF 正文与内嵌图片。
 * 扫描版 PDF 通常没有文字层，此时仍会把内嵌的大图取出来交给 vision 模型。
 */
async function readPdf(
  buffer: Buffer,
  filename: string,
  warnings: AiImportWarning[]
): Promise<{ readonly text: string; readonly images: readonly ExtractedImage[] }> {
  const data = new Uint8Array(buffer);
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(data);
    const extracted = await extractText(pdf, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n\n") : extracted.text;
    const images: ExtractedImage[] = [];
    if (extracted.totalPages > 0) {
      for (let pageNumber = 1; pageNumber <= extracted.totalPages; pageNumber += 1) {
        if (images.length >= MAX_IMAGES) {
          warnings.push(warning(filename, "PDF 内嵌图片超过 " + MAX_IMAGES + " 张，超出部分已跳过"));
          break;
        }
        let pageImages: Awaited<ReturnType<typeof extractImages>> = [];
        try {
          pageImages = await extractImages(pdf, pageNumber);
        } catch {
          continue;
        }
        for (let index = 0; index < pageImages.length; index += 1) {
          const image = pageImages[index];
          if (
            image === undefined ||
            !Number.isFinite(image.width) ||
            !Number.isFinite(image.height) ||
            image.width < 160 ||
            image.height < 160
          ) {
            continue;
          }
          try {
            const png = await sharp(Buffer.from(image.data), {
              raw: {
                width: image.width,
                height: image.height,
                channels: image.channels as 1 | 2 | 3 | 4
              }
            })
              .png()
              .toBuffer();
            images.push({
              filename: filename + "（第 " + pageNumber + " 页图 " + (index + 1) + "）",
              buffer: png,
              mime: "image/png"
            });
          } catch {
            warnings.push(warning(filename, "PDF 第 " + pageNumber + " 页的图片无法转换，已跳过"));
          }
          if (images.length >= MAX_IMAGES) break;
        }
      }
    }
    return { text, images };
  } catch (error) {
    warnings.push(warning(filename, "PDF 解析失败：" + (error instanceof Error ? error.message : "未知错误")));
    return { text: "", images: [] };
  } finally {
    if (pdf !== null) await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

async function extractSource(file: File, warnings: AiImportWarning[]): Promise<ExtractedSource | null> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = extensionOfName(file.name);
  if (buffer.byteLength > MAX_FILE_BYTES) {
    warnings.push(warning(file.name, "文件超过 25MB，已跳过"));
    return null;
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return { filename: file.name, kind: "TEXT", text: buffer.toString("utf8"), extension, buffer };
  }
  if (extension === "docx") {
    return { filename: file.name, kind: "DOCX", text: readDocx(buffer), extension, buffer };
  }
  if (extension === "pptx") {
    return { filename: file.name, kind: "PPTX", text: readPptx(buffer), extension, buffer };
  }
  if (extension === "xlsx" || extension === "xls") {
    return { filename: file.name, kind: "XLSX", text: readSpreadsheet(buffer), extension, buffer };
  }
  if (extension === "pdf") {
    const parsed = await readPdf(buffer, file.name, warnings);
    return { filename: file.name, kind: "PDF", text: parsed.text, extension, buffer, embeddedImages: parsed.images };
  }
  return { filename: file.name, kind: "BINARY", text: "", extension, buffer };
}

export async function prepareSources(files: readonly File[], warnings: AiImportWarning[]): Promise<PreparedSources> {
  const sources: ExtractedSource[] = [];
  const images: PreparedImage[] = [];
  let totalChars = 0;

  for (const file of files) {
    const source = await extractSource(file, warnings);
    if (source === null) continue;

    let embeddedImagesAdded = false;
    if (source.embeddedImages !== undefined && source.embeddedImages.length > 0) {
      for (const embedded of source.embeddedImages) {
        if (images.length >= MAX_IMAGES) {
          warnings.push(warning(file.name, "图片数量超过 " + MAX_IMAGES + " 张，PDF 内嵌图片超出部分已跳过"));
          break;
        }
        try {
          const compressed = await compressForVision(embedded.buffer);
          images.push({
            filename: embedded.filename,
            relativePath: "assets/images/" + safeNameStem(embedded.filename) + ".png",
            dataUrl: "data:" + compressed.mime + ";base64," + compressed.buffer.toString("base64"),
            buffer: embedded.buffer,
            mime: embedded.mime
          });
          embeddedImagesAdded = true;
        } catch {
          warnings.push(warning(embedded.filename, "PDF 内嵌图片压缩失败，已跳过"));
        }
      }
    }

    const mime = await detectImageMime(source.buffer, source.extension);
    if (mime.length > 0) {
      if (images.length >= MAX_IMAGES) {
        warnings.push(warning(file.name, "图片数量超过 " + MAX_IMAGES + " 张，已跳过"));
        continue;
      }
      let visionBuffer = source.buffer;
      let visionMime = mime;
      try {
        const compressed = await compressForVision(source.buffer);
        visionBuffer = compressed.buffer;
        visionMime = compressed.mime;
      } catch {
        const directlySupported = mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" || mime === "image/gif";
        if (directlySupported === false) {
          warnings.push(warning(file.name, "图片格式 " + mime + " 无法转换，已跳过"));
          continue;
        }
        warnings.push(warning(file.name, "图片压缩失败，将按原图发送给视觉模型"));
      }
      const relativePath = "assets/images/" + safeNameStem(file.name) + ".png";
      images.push({
        filename: file.name,
        relativePath,
        dataUrl: "data:" + visionMime + ";base64," + visionBuffer.toString("base64"),
        buffer: source.buffer,
        mime
      });
      continue;
    }

    let text = source.text.trim();
    if (text.length === 0) {
      if (embeddedImagesAdded) {
        warnings.push(warning(file.name, "PDF 未提取到文字，已改用内嵌图片交给视觉模型"));
      } else {
        warnings.push(warning(file.name, kindHint(source.kind) + "没有提取到可用文字，已跳过内容整合"));
      }
      continue;
    }
    if (text.length > PER_FILE_CHARS) {
      text = text.slice(0, PER_FILE_CHARS);
      warnings.push(warning(file.name, "文本过长，已截断到 " + PER_FILE_CHARS + " 字"));
    }
    if (totalChars + text.length > TOTAL_CHARS) {
      text = text.slice(0, Math.max(0, TOTAL_CHARS - totalChars));
      warnings.push(warning(file.name, "素材总量达到上限，部分内容被截断"));
    }
    totalChars += text.length;
    sources.push({ ...source, text });
  }
  return { sources, images, warnings };
}

function kindHint(kind: string): string {
  if (kind === "PDF") return "PDF（未识别出文字，可能是扫描版，且没有可提取的内嵌图片）";
  if (kind === "BINARY") return "二进制文件";
  return kind;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord);
  if (value !== null && typeof value === "object") return [asRecord(value)];
  return [];
}

interface AiDraftFrontMatter {
  readonly spec: string;
  readonly id: string;
  readonly title: string;
  readonly system: string;
  readonly era: string;
  readonly author: string;
  readonly version: string;
  readonly summary: string;
  readonly background: string;
  readonly occupationRecommendation: string;
}

interface AiDraft {
  readonly frontMatter: AiDraftFrontMatter;
  readonly sections: Record<string, string>;
  readonly structured: Record<string, Record<string, unknown>[]>;
}

function normalizeDraft(raw: unknown, input: {
  readonly title: string;
  readonly system: "COC7" | "TOUHOU";
  readonly era: string;
  readonly author: string;
}): AiDraft {
  const root = asRecord(raw);
  const fmRaw = asRecord(root.frontMatter ?? root.frontmatter ?? {});
  const sectionsRaw = asRecord(root.sections ?? root.章节 ?? {});
  const structuredRaw = asRecord(root.structured ?? root.结构化数据 ?? {});

  const sections: Record<string, string> = {};
  for (const section of REQUIRED_MODULE_SECTIONS) {
    const value = sectionsRaw[section] ?? sectionsRaw[section.replace(/与/g, "")] ?? "";
    sections[section] = typeof value === "string" ? value.trim() : JSON.stringify(value, null, 2);
  }

  const structured: Record<string, Record<string, unknown>[]> = {};
  for (const [key, value] of Object.entries(structuredRaw)) {
    const cleanKey = key === "spells" ? "magic" : key.replace(/s$/, "");
    structured[cleanKey] = asObjectArray(value);
  }

  const title = asString(fmRaw.title, input.title) || input.title;
  const system = asString(fmRaw.system, input.system) === "TOUHOU" ? "TOUHOU" : "COC7";
  return {
    frontMatter: {
      spec: "touhou-module/v1",
      id: slugifyModuleId(asString(fmRaw.id, title) || title),
      title,
      system,
      era: asString(fmRaw.era, input.era) || input.era,
      author: asString(fmRaw.author, input.author) || input.author,
      version: asString(fmRaw.version, "1.0.0") || "1.0.0",
      summary: (asString(fmRaw.summary) || (title + "（DeepSeek 根据素材整理）")).slice(0, 1200),
      background: asString(fmRaw.background).slice(0, 4000),
      occupationRecommendation: asString(fmRaw.occupationRecommendation).slice(0, 4000)
    },
    sections,
    structured
  };
}

function yamlBlock(kind: string, value: Record<string, unknown>): string {
  const text = stringifyYaml(value).trim();
  return "```yaml module-" + kind + "\n" + text + "\n```";
}

function sanitizeSectionBody(text: string, section: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("## " + section)) {
    return trimmed.slice(("## " + section).length).trim();
  }
  return trimmed;
}

function assembleMarkdown(draft: AiDraft, imagePaths: readonly string[]): string {
  const frontMatterRaw = parseYaml(stringifyYaml(draft.frontMatter));
  const frontMatter = asRecord(frontMatterRaw);
  const lines: string[] = ["---", stringifyYaml(frontMatter).trim(), "---", ""];

  for (const section of REQUIRED_MODULE_SECTIONS) {
    let body = sanitizeSectionBody(draft.sections[section] ?? "", section);
    if (section === "附录" && imagePaths.length > 0) {
      const missing = imagePaths.filter((path) => body.includes(path) === false);
      if (missing.length > 0) {
        body += "\n\n### 图片素材索引\n" + missing.map((path, index) => {
          const name = path.split("/").pop() ?? ("image-" + String(index + 1));
          return "![素材图片](" + path + ")";
        }).join("\n\n");
      }
    }
    if (body.length === 0) body = "（素材未提供，KP 可自行补充。）";
    lines.push("## " + section, "", body, "");
  }

  lines.push("### 结构化数据", "");
  const kindToPlural: Record<string, string> = {
    chapter: "chapters",
    scene: "scenes",
    encounter: "encounters",
    npc: "npcs",
    clue: "clues",
    item: "items",
    ending: "endings",
    reward: "rewards",
    magic: "magic"
  };
  for (const [kind, plural] of Object.entries(kindToPlural)) {
    for (const item of draft.structured[kind] ?? []) {
      lines.push(yamlBlock(kind, item), "");
    }
  }
  return lines.join("\n");
}

function materialPrompt(input: {
  readonly sources: readonly ExtractedSource[];
  readonly images: readonly PreparedImage[];
  readonly hints: { readonly system: "COC7" | "TOUHOU"; readonly era: string; readonly instructions: string };
}): string {
  const lines: string[] = [];
  lines.push("你是资深 TRPG 团本编辑。请把下列全部素材整合成一个可直接跑团的中文团本。");
  lines.push("这是一次全新的独立导入任务，不要引用、假设或延续任何历史对话、此前生成过的团本或上次导入的设定。");
  lines.push("目标系统：" + input.hints.system + "；年代：" + input.hints.era + "。");
  lines.push("必须严格以本次用户指定的目标系统与年代为准；图片 / PDF 中识别到的国家、城市、年代线索优先于模型默认设定。");
  if (input.hints.instructions.trim().length > 0) {
    lines.push("用户额外要求：" + input.hints.instructions.trim().slice(0, 2000));
  }
  lines.push("");
  lines.push("【素材一：文字/表格文件】");
  if (input.sources.length === 0) {
    lines.push("（没有可读文字素材）");
  }
  for (const source of input.sources) {
    lines.push("===== " + source.filename + " =====");
    lines.push(source.text);
    lines.push("");
  }
  if (input.images.length > 0) {
    lines.push("【素材二：图片】以下图片会以视觉输入提供，请结合图片内容写作。");
    for (const image of input.images) {
      lines.push("- " + image.filename + " -> 引用路径：" + image.relativePath);
    }
  }
  return lines.join("\n");
}

function jsonInstruction(): string {
  return [
    "请只返回一个严格 JSON 对象（不要 markdown 代码围栏，不要解释）。",
    "JSON 结构：",
    "{",
    '  "frontMatter": {',
    '    "id": "英文小写 slug", "title": "团本标题", "system": "COC7 或 TOUHOU", "era": "年代",',
    '    "author": "整理者", "version": "1.0.0", "summary": "一句话简介",',
    '    "background": "背景长文", "occupationRecommendation": "推荐职业/角色方向"',
    "  },",
    '  "sections": { "元信息": "...", "真相与背景": "...", "剧情梗概": "...", "开场钩子": "...", "关键NPC": "...", "地点与场景": "...", "线索": "...", "遭遇与战斗": "...", "道具与手书": "...", "怪物与神话生物": "...", "结局分支": "...", "奖励与成长": "...", "KP备注": "...", "附录": "..." },',
    '  "structured": {',
    '    "chapters": [{ "id": "ch1", "name": "章节名", "summary": "..." }],',
    '    "scenes": [{ "id": "scene1", "name": "场景名", "description": "...", "width": 1600, "height": 1000, "gridType": "SQUARE 或 HEX", "bgColor": "#1a1a2e", "background": "assets/images/xxx.png 或留空" }],',
    '    "encounters": [{ "id": "enc1", "name": "遭遇名", "sceneId": "scene1", "chapterId": "ch1", "trigger": "触发条件", "setup": {} }],',
    '    "npcs": [{ "id": "npc1", "name": "NPC 名", "tier": "MINION 或 STANDARD 或 ELITE 或 BOSS", "rarity": "COMMON", "race": null, "tags": [], "description": "...", "portrait": "assets/images/xxx.png 或留空", "attributes": { "str": 50, "con": 50, "siz": 50, "dex": 50, "app": 50, "int": 50, "pow": 50, "edu": 50, "luck": 50 }, "skills": { "DODGE": 40, "FIGHTING_BRAWL": 50 }, "maxHp": 12, "maxMp": 10, "maxSan": 50, "maxDp": 0 }],',
    '    "clues": [{ "id": "clue1", "title": "线索名", "content": "线索内容", "image": "assets/handouts/xxx.png 或留空", "isPublic": false, "linkedItemId": "item1 或留空" }],',
    '    "items": [{ "id": "item1", "name": "道具名", "itemType": "WEAPON 或 ITEM 或 TOME 或 ARTIFACT 或 EVIDENCE", "description": "...", "rarity": "COMMON", "image": "assets/images/xxx.png 或留空", "quantity": 1, "damage": "1d6 或留空", "range": "MELEE/NEAR/FAR 或留空", "skillId": "FIGHTING_BRAWL 等或留空", "accuracyMod": 0 }],',
    '    "endings": [{ "id": "end1", "name": "结局名", "condition": "...", "description": "..." }],',
    '    "rewards": [{ "id": "reward1", "name": "奖励名", "description": "..." }],',
    '    "magic": [{ "id": "spell1", "name": "法术名", "skill": "MAGIC 或 OCCULT", "mpCost": "3", "sanCost": "1d3", "damage": "1d6", "target": "ONE", "targeting": "ENEMY", "effects": [{ "type": "DAMAGE", "amount": "1d6" }, { "type": "DOT", "amount": "1d3", "durationTicks": "3" }, { "type": "STUN", "durationActions": "1" }], "description": "..." }]',
    "  }",
    "}",
    "写作要求：",
    "- 14 个标准章节必须全部存在，即 JSON 的 sections 必须包含上面列出的全部 key。",
    "- 内容尽量具体，但不要编造与素材冲突的关键事实；缺失处写“素材未提供，KP 可自行补充”。",
    "- structured 至少给出 1 个 chapter、2 个 scene、1 个 encounter，方便后台自动生成战术棋盘。",
    "- 素材中出现的每个重要 NPC / Boss / 怪物都要整理成 npcs，并尽量补全九项属性、技能、HP/MP/SAN/DP；素材没给数值时可用系统默认值。",
    "- 素材中出现的武器、物品、法器、法术书、关键证物都要整理成 items；关键证物 itemType 用 EVIDENCE。",
    "- 素材中出现的线索、手书、照片、文件都要整理成 clues；没有图片则 image 留空，不要编造资源路径。",
    "- clues 数组中每条线索必须包含 content 正文（可以是提炼后的调查信息），禁止只输出标题。",
    "- 如果素材涉及魔法 / 法术 / 咒文 / 仪式 / 超自然能力，必须整理成 structured.magic 数组并尽量给出可结算数值（技能、消耗、伤害、目标）；没有魔法则给空数组 []。",
    "- 法术的 effects 是通用指令数组，可组合使用：DAMAGE / HEAL / MP_RESTORE / MP_DRAIN / SAN_LOSS / SAN_RESTORE / STATUS / DOT（持续伤害）/ STUN（眩晕）/ CONTROL（控制）/ CLEANSE（净化）。target 为 SELF / ONE / ALL；targeting 为 SELF / ALLY / ENEMY / ANY。伤害类法术必须给出 DAMAGE 或 DOT；控制类给出 STUN / CONTROL。",
    "- 若素材提供了图片，请在相关章节使用 markdown 图片语法，路径必须严格使用上面给出的引用路径。",
    "- JSON 必须一次性完整闭合，严禁被截断；若素材很多，请优先保留全部 14 个章节标题和所有结构化字段，压缩描述性文字。",
    "- 总篇幅尽量控制在约 9000 个中文字符以内，单章描述 2-4 段即可。"
  ].join("\n");
}

/**
 * 重试时也不复用上一轮 assistant 上下文。
 * 这里把上次输出当作“错误样本”放进一条全新的 user 消息里，
 * 每次请求都只包含 system + user，等价于一个全新的单轮会话。
 */
function retryUserContent(
  original: readonly DeepSeekContentPart[],
  previous: string,
  errors: readonly string[]
): readonly DeepSeekContentPart[] {
  const lines = [
    "",
    "【这是一次全新的独立会话】",
    "不要延续、引用或假设任何上一轮助手回复；只把下面内容当作错误样本用于定位问题。",
    "请只依据最初提供的素材，重新生成一个完整、全新的 JSON。",
    "硬性要求：所有 14 个章节 key 必须存在，结构化字段必须齐全，JSON 必须完整闭合。",
    "如果内容过长，请压缩每章描述，优先保留章节标题与 structured 字段，总长度控制在约 8000 个中文字符以内。",
    "校验错误：",
    ...errors.slice(0, 20).map((error) => "- " + error)
  ];
  if (previous.length > 0) {
    lines.push(
      "上次输出片段（可能不完整；仅用于定位缺失字段，禁止照抄、复述或续写）：",
      previous.slice(0, 12000)
    );
  }
  lines.push("只返回 JSON，不要解释、不要复述上文。");
  return [...original, { type: "text", text: lines.join("\n") }];
}

interface AiGenerateState {
  readonly draft: AiDraft;
  readonly markdown: string;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

async function generateDraft(input: {
  readonly materialText: string;
  readonly images: readonly PreparedImage[];
  readonly hints: { readonly system: "COC7" | "TOUHOU"; readonly era: string; readonly author: string; readonly model: string };
  readonly title: string;
  readonly sessionId: string;
  readonly onProgress?: (message: string) => void;
}): Promise<{ state: AiGenerateState; attempts: number; rawModels: string[] }> {
  const sessionLabel = "AI 会话 " + input.sessionId.slice(0, 8);
  const userParts: DeepSeekContentPart[] = [{ type: "text", text: input.materialText + "\n\n" + jsonInstruction() }];
  for (const image of input.images) {
    userParts.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  const systemMessage: DeepSeekMessage = {
    role: "system",
    content: "你是严谨的中文 TRPG 团本编辑。每次调用都是完全独立的导入任务，不继承任何历史上下文；输出必须是合法 JSON，且严格遵守用户给定结构。"
  };
  const messages: DeepSeekMessage[] = [
    systemMessage,
    { role: "user", content: userParts }
  ];

  const MAX_OUTPUT_TOKENS = 32768;

  let previousRaw = "";
  let lastErrors: readonly string[] = [];
  let truncated = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    input.onProgress?.(sessionLabel + "：正在调用 DeepSeek（第 " + attempt + "/3 次）…");
    let raw: string;
    try {
      if (attempt === 1) {
        raw = await chatDeepSeek(messages, {
          model: input.hints.model,
          jsonMode: true,
          maxTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2
        });
      } else {
        // 重试也必须是一次全新的单轮会话：只发送 system + user，
        // 不复用上一轮 assistant 消息，避免模型把上一次输出当成持续上下文续写。
        const retryMessages: DeepSeekMessage[] = [
          systemMessage,
          {
            role: "user",
            content: retryUserContent(userParts, previousRaw, lastErrors)
          }
        ];
        raw = await chatDeepSeek(retryMessages, {
          model: input.hints.model,
          jsonMode: true,
          maxTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.1
        });
      }
    } catch (error) {
      if (error instanceof DeepSeekTruncationError) {
        truncated = true;
        lastErrors = [error.message + "；请压缩每章内容，确保 JSON 完整闭合。"];
        input.onProgress?.(sessionLabel + "：输出被截断，正在压缩后重试…");
        continue;
      }
      throw error;
    }

    previousRaw = raw;
    input.onProgress?.("已收到 DeepSeek 回复，正在校验结构…");
    let parsed: unknown;
    try {
      parsed = extractJsonObject(raw);
    } catch (error) {
      lastErrors = [error instanceof Error ? error.message : "JSON 解析失败"];
      continue;
    }
    const draft = normalizeDraft(parsed, {
      title: input.title,
      system: input.hints.system,
      era: input.hints.era,
      author: input.hints.author
    });
    const markdown = assembleMarkdown(draft, input.images.map((image) => image.relativePath));
    const parsedModule = parseModuleMarkdown(markdown);
    lastErrors = parsedModule.errors;
    if (parsedModule.errors.length === 0) {
      return {
        state: {
          draft,
          markdown,
          errors: [],
          warnings: parsedModule.warnings
        },
        attempts: attempt,
        rawModels: [raw]
      };
    }
  }

  const reason = lastErrors.slice(0, 3).join("；");
  throw new Error(
    "DeepSeek 连续 3 次未返回完整、合法的 JSON：" +
      reason +
      (truncated ? "。输出多次触达长度上限，建议减少单次素材量或拆分文件后重试。" : "")
  );
}

async function uniqueSlug(roomId: string | null, base: string): Promise<string> {
  let slug = slugifyModuleId(base);
  let suffix = 2;
  while ((await prisma.module.findFirst({ where: { roomId, slug }, select: { id: true } })) !== null) {
    slug = slugifyModuleId(base) + "-" + String(suffix);
    suffix += 1;
  }
  return slug;
}

export async function importModuleWithDeepSeek(input: {
  readonly files: readonly File[];
  readonly roomId: string;
  readonly userId: string;
  readonly author: string;
  readonly requestedSystem: "COC7" | "TOUHOU" | "AUTO";
  readonly requestedEra: string;
  readonly instructions: string;
  readonly requestedModel: string;
  readonly onProgress?: (message: string) => void;
}): Promise<AiImportResult> {
  if (input.files.length === 0) throw new Error("请至少上传一个素材文件");
  if (input.files.length > MAX_FILES) throw new Error("单次最多上传 " + MAX_FILES + " 个文件");
  const sessionId = randomUUID();
  input.onProgress?.("已创建独立 AI 会话 " + sessionId.slice(0, 8) + "，本次导入不复用任何历史上下文");
  const warnings: AiImportWarning[] = [];
  const prepared = await prepareSources(input.files, warnings);
  if (prepared.sources.length === 0 && prepared.images.length === 0) {
    throw new Error("没有提取到可用素材，请检查文件格式或大小");
  }
  input.onProgress?.("已解析 " + prepared.sources.length + " 个文本素材 / " + prepared.images.length + " 张图片");

  const fallbackModel = DEEPSEEK_MODELS.find((item) => item.recommended)?.id ?? "deepseek-flash";
  const requestedModel = input.requestedModel.length > 0 ? input.requestedModel : fallbackModel;
  const requestedModelInfo = DEEPSEEK_MODELS.find((item) => item.id === requestedModel);
  const visionModel = DEEPSEEK_MODELS.find((item) => item.vision && item.recommended)?.id ?? fallbackModel;
  let model = requestedModel;
  const system: "COC7" | "TOUHOU" =
    input.requestedSystem === "AUTO"
      ? (prepared.sources.some((source) => /东方|touhou|幻想乡/i.test(source.text)) ? "TOUHOU" : "COC7")
      : input.requestedSystem;
  const titleSource = prepared.sources[0]?.filename ?? prepared.images[0]?.filename ?? "AI 团本";
  const title = titleSource.replace(/\.[^.]+$/, "").slice(0, 80) || "AI 团本";

  if (prepared.images.length > 0 && requestedModelInfo?.vision === false) {
    model = visionModel;
    warnings.push({
      filename: "全部图片",
      message: "所选模型 " + requestedModel + " 不支持视觉，已自动改用 " + model + " 解析图片素材"
    });
  }

  const generated = await generateDraft({
    materialText: materialPrompt({
      sources: prepared.sources,
      images: prepared.images,
      hints: { system, era: input.requestedEra, instructions: input.instructions }
    }),
    images: prepared.images,
    hints: { system, era: input.requestedEra, author: input.author, model },
    title,
    sessionId,
    onProgress: input.onProgress
  });

  input.onProgress?.("AI 结构校验通过，正在写入团本…");
  const slug = await uniqueSlug(input.roomId.length === 0 ? null : input.roomId, generated.state.draft.frontMatter.id || title);
  const moduleRecord = await prisma.module.create({
    data: {
      ownerId: input.userId,
      roomId: input.roomId.length === 0 ? null : input.roomId,
      slug,
      title: generated.state.draft.frontMatter.title,
      synopsis: generated.state.draft.frontMatter.summary,
      author: generated.state.draft.frontMatter.author,
      system: generated.state.draft.frontMatter.system,
      era: generated.state.draft.frontMatter.era,
      background: generated.state.draft.frontMatter.background || null,
      occupationRecommendation: generated.state.draft.frontMatter.occupationRecommendation || null,
      version: generated.state.draft.frontMatter.version,
      sourceType: "AI_DEEPSEEK",
      originalFilename: input.files.map((file) => file.name).join(", ").slice(0, 300),
      content: {
        format: "markdown",
        text: generated.state.markdown,
        sections: parseModuleMarkdown(generated.state.markdown).sections,
        structured: parseStructuredBlocks(generated.state.markdown)
      } as never,
      metadata: {
        aiModel: model,
        aiSessionId: sessionId,
        aiGeneratedAt: new Date().toISOString(),
        sourceFiles: input.files.map((file) => file.name).slice(0, 60),
        instructions: input.instructions
      } as never,
      importReport: {
        warnings: [...warnings, ...generated.state.warnings.map((text) => ({ filename: "AI 校验", message: text }))],
        sourceCount: prepared.sources.length,
        imageCount: prepared.images.length,
        attempts: generated.attempts
      } as never
    },
    select: { id: true }
  });

  try {
    let orderIndex = 0;
    for (const image of prepared.images) {
      input.onProgress?.("正在保存图片 " + (orderIndex + 1) + "/" + prepared.images.length + "…");
      const stored = await storeImage(image.buffer, { category: "modules", maxBytes: MAX_FILE_BYTES });
      const asset = await prisma.asset.create({
        data: {
          ownerId: input.userId,
          type: "OTHER",
          filename: stored.filename,
          originalName: image.filename.slice(0, 200),
          mimeType: stored.mime,
          size: stored.size,
          width: stored.width,
          height: stored.height,
          url: publicPath("modules", stored.filename),
          thumbnailUrl: publicPath("modules", stored.thumbnailName),
          checksum: stored.checksum,
          metadata: { moduleId: moduleRecord.id, aiImport: true, relativePath: image.relativePath }
        },
        select: { id: true }
      });
      await prisma.moduleAsset.create({
        data: {
          moduleId: moduleRecord.id,
          assetId: asset.id,
          relativePath: image.relativePath,
          originalName: image.filename.slice(0, 200),
          kind: "IMAGE",
          orderIndex
        }
      });
      orderIndex += 1;
    }
  } catch (error) {
    await prisma.module.delete({ where: { id: moduleRecord.id } }).catch(() => undefined);
    throw new Error("团本资源保存失败：" + (error instanceof Error ? error.message : "未知错误"));
  }

  try {
    input.onProgress?.("正在同步团本只读模板…");
    const templateCounts = await syncModuleTemplatesFromModule(moduleRecord.id);
    for (const warning of templateCounts.warnings) {
      warnings.push({ filename: "模板解析", message: warning });
    }
  } catch (error) {
    warnings.push({ filename: "模板解析", message: error instanceof Error ? error.message : "模板解析失败" });
  }

  return {
    moduleId: moduleRecord.id,
    title: generated.state.draft.frontMatter.title,
    model,
    sessionId,
    attempts: generated.attempts,
    imagesUsed: prepared.images.length,
    warnings
  };
}
