import { createHash, randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { extractImages, extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
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
  type DeepSeekChatOptions,
  DEEPSEEK_MODELS
} from "@/server/ai/deepseek";
import {
  chunkSourceText,
  mergeDraft,
  STRUCTURED_PLURALS,
  type AiDraft,
  type ChunkExtraction,
  type ImageExtraction,
  type TextChunk
} from "@/server/ai/chunking";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 40;
const MAX_IMAGES = 12;
/** 分块提取时单段的目标 / 硬上限；每段单独调用模型，杜绝整本输出被截断。 */
const CHUNK_TARGET_CHARS = 8000;
const CHUNK_MAX_CHARS = 12000;
/** 单次导入最多切成的段数；超过则明确报错，不做静默截断。 */
const MAX_TEXT_CHUNKS = 80;
/** 全文安全上限；超过同样明确报错，要求拆分素材。 */
const MAX_TOTAL_SOURCE_CHARS = 900000;
/** PDF 图片候选上限：先收集，再按信息量排序选中 MAX_IMAGES 张。 */
const MAX_IMAGE_CANDIDATES = 80;
const MAX_RENDERED_PAGES = 24;
const MAX_CHUNK_OUTPUT_TOKENS = 12288;
const MAX_IMAGE_OUTPUT_TOKENS = 12288;

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
  /** 单次调用允许的最大重试轮次（>=1）；不再是整本只用一次。 */
  readonly attempts: number;
  /** 本次导入实际调用 DeepSeek 的总次数（文本分段 + 图片分析）。 */
  readonly aiCalls: number;
  /** 素材被切成的文本段数。 */
  readonly chunks: number;
  /** 成功完成提取的文本段数。 */
  readonly chunksCompleted: number;
  /** 成功分析并合并进团本的图片数。 */
  readonly imagesAnalyzed: number;
  readonly imagesUsed: number;
  readonly warnings: readonly AiImportWarning[];
}

export interface ImportModuleDependencies {
  /** 测试用注入；默认调用真实 DeepSeek。 */
  readonly chat?: AiChatClient;
}

type ImageOrigin = "EMBEDDED" | "PAGE_RENDER" | "UPLOAD";

interface ExtractedImage {
  readonly filename: string;
  readonly buffer: Buffer;
  readonly mime: string;
  readonly pageNumber?: number;
  readonly pageText?: string;
  readonly origin?: ImageOrigin;
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
  readonly origin: ImageOrigin;
  readonly pageNumber?: number;
  readonly pageText?: string;
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

/** 发给 vision 模型前先压缩；地图 / 手书上的小字需要更高分辨率才能读准。 */
async function compressForVision(buffer: Buffer): Promise<{ readonly buffer: Buffer; readonly mime: string }> {
  const normalized = await sharp(buffer, { limitInputPixels: 4096 * 4096 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { buffer: normalized, mime: "image/jpeg" };
}

/**
 * 解析 PDF 正文与候选图片。
 *
 * - 每页文字单独保留，便于跟该页图片一起交给 vision 模型（图片 + 同页上下文）。
 * - 除提取内嵌位图外，对“文字很少且没有大图”的页面做整页渲染，
 *   这样矢量地图 / 排版型页面不会被漏掉。
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
    const extracted = await extractText(pdf, { mergePages: false });
    const pageTexts = Array.isArray(extracted.text)
      ? extracted.text.map((item) => (typeof item === "string" ? item : ""))
      : [typeof extracted.text === "string" ? extracted.text : ""];
    const text = pageTexts.join("\n\n");
    const totalPages = Math.max(extracted.totalPages, pageTexts.length);
    const candidates: ExtractedImage[] = [];
    let renderedPages = 0;

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      if (candidates.length >= MAX_IMAGE_CANDIDATES) {
        warnings.push(warning(filename, "PDF 图片候选超过 " + MAX_IMAGE_CANDIDATES + " 张，后续页面已跳过"));
        break;
      }
      const pageText = pageTexts[pageNumber - 1] ?? "";
      let pageImages: Awaited<ReturnType<typeof extractImages>> = [];
      try {
        pageImages = await extractImages(pdf, pageNumber);
      } catch {
        pageImages = [];
      }

      let hasLargeEmbedded = false;
      for (let index = 0; index < pageImages.length; index += 1) {
        if (candidates.length >= MAX_IMAGE_CANDIDATES) break;
        const image = pageImages[index];
        if (
          image === undefined ||
          Number.isFinite(image.width) === false ||
          Number.isFinite(image.height) === false ||
          image.width < 160 ||
          image.height < 160
        ) {
          continue;
        }
        if (Math.max(image.width, image.height) >= 320) hasLargeEmbedded = true;
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
          candidates.push({
            filename: filename + "（第 " + pageNumber + " 页内嵌图 " + (index + 1) + "）",
            buffer: png,
            mime: "image/png",
            pageNumber,
            pageText,
            origin: "EMBEDDED"
          });
        } catch {
          warnings.push(warning(filename, "PDF 第 " + pageNumber + " 页的内嵌图片无法转换，已跳过"));
        }
      }

      // 文字很少、也没有大位图的页面：渲染整页（覆盖扫描件、矢量地图、排版页）。
      if (
        renderedPages < MAX_RENDERED_PAGES &&
        pageText.trim().length < 160 &&
        hasLargeEmbedded === false
      ) {
        try {
          const rendered = await renderPageAsImage(pdf, pageNumber, {
            canvasImport: () => import("@napi-rs/canvas"),
            width: 1600
          });
          candidates.push({
            filename: filename + "（第 " + pageNumber + " 页整页渲染）",
            buffer: Buffer.from(rendered),
            mime: "image/png",
            pageNumber,
            pageText,
            origin: "PAGE_RENDER"
          });
          renderedPages += 1;
        } catch {
          warnings.push(warning(filename, "PDF 第 " + pageNumber + " 页无法渲染为图片，已跳过"));
        }
      }
    }

    if (candidates.length === 0) {
      warnings.push(warning(filename, "PDF 没有可用的内嵌图片或可渲染页面，视觉素材为空"));
    }
    return { text, images: candidates };
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

interface ImageCandidate {
  readonly filename: string;
  readonly buffer: Buffer;
  readonly mime: string;
  readonly origin: ImageOrigin;
  readonly pageNumber?: number;
  readonly pageText?: string;
  readonly order: number;
}

function averageHash(data: Buffer): string {
  if (data.length === 0) return "empty";
  let sum = 0;
  for (const value of data) sum += value;
  const mean = sum / data.length;
  let bits = "";
  for (const value of data) bits += value >= mean ? "1" : "0";
  return bits;
}

/** 图片信息量评分：尺寸 + 熵 + 对比度；只用于 PDF 候选排序，不评价画质艺术性。 */
async function imageCandidateInfo(
  buffer: Buffer
): Promise<{ readonly score: number; readonly hash: string }> {
  try {
    const stats = await sharp(buffer, { limitInputPixels: 4096 * 4096 })
      .resize(72, 72, { fit: "inside" })
      .greyscale()
      .stats();
    const channel = stats.channels[0];
    const entropy = Number.isFinite(stats.entropy) ? stats.entropy : 0;
    const stdev = channel !== undefined && Number.isFinite(channel.stdev) ? channel.stdev : 0;
    const metadata = await sharp(buffer, { limitInputPixels: 4096 * 4096 }).metadata();
    const width = Number.isFinite(metadata.width) ? metadata.width ?? 0 : 0;
    const height = Number.isFinite(metadata.height) ? metadata.height ?? 0 : 0;
    const pixelScore = Math.log2(Math.max(1, width * height)) * 4;
    const hashBuffer = await sharp(buffer, { limitInputPixels: 4096 * 4096 })
      .resize(8, 8, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
    return { score: pixelScore + entropy * 10 + Math.min(stdev, 64) / 4, hash: averageHash(hashBuffer) };
  } catch {
    return { score: 0, hash: "unreadable-" + String(buffer.length) };
  }
}

export async function prepareSources(files: readonly File[], warnings: AiImportWarning[]): Promise<PreparedSources> {
  const sources: ExtractedSource[] = [];
  const candidates: ImageCandidate[] = [];
  let totalChars = 0;
  let imageOrder = 0;

  for (const file of files) {
    const source = await extractSource(file, warnings);
    if (source === null) continue;

    if (source.embeddedImages !== undefined && source.embeddedImages.length > 0) {
      for (const embedded of source.embeddedImages) {
        candidates.push({
          filename: embedded.filename,
          buffer: embedded.buffer,
          mime: embedded.mime,
          origin: embedded.origin ?? "EMBEDDED",
          pageNumber: embedded.pageNumber,
          pageText: embedded.pageText,
          order: imageOrder
        });
        imageOrder += 1;
      }
    }

    const mime = await detectImageMime(source.buffer, source.extension);
    if (mime.length > 0) {
      candidates.push({
        filename: file.name,
        buffer: source.buffer,
        mime,
        origin: "UPLOAD",
        order: imageOrder
      });
      imageOrder += 1;
      continue;
    }

    const text = source.text.trim();
    if (text.length === 0) {
      if (source.embeddedImages !== undefined && source.embeddedImages.length > 0) {
        warnings.push(warning(file.name, "PDF 未提取到文字，已改用页面图片 / 内嵌图片交给视觉模型"));
      } else {
        warnings.push(warning(file.name, kindHint(source.kind) + "没有提取到可用文字，已跳过内容整合"));
      }
      continue;
    }
    totalChars += text.length;
    if (totalChars > MAX_TOTAL_SOURCE_CHARS) {
      throw new Error(
        "素材文字总量超过 " + MAX_TOTAL_SOURCE_CHARS + " 字（当前已到 " + totalChars + "），" +
        "系统会拒绝生成不完整团本；请拆分素材后分批导入。"
      );
    }
    sources.push({ ...source, text });
  }

  const enriched = await Promise.all(
    candidates.map(async (candidate) => {
      const info = await imageCandidateInfo(candidate.buffer);
      return { candidate, score: info.score, hash: info.hash };
    })
  );
  const deduped: typeof enriched = [];
  const seenHash = new Map<string, number>();
  for (const item of enriched) {
    const existingIndex = seenHash.get(item.hash);
    if (existingIndex === undefined) {
      seenHash.set(item.hash, deduped.length);
      deduped.push(item);
      continue;
    }
    const existing = deduped[existingIndex];
    if (existing !== undefined && item.score > existing.score) deduped[existingIndex] = item;
    warnings.push(warning(item.candidate.filename, "与已有图片重复，已跳过"));
  }

  const ranked = [...deduped].sort((a, b) => {
    const aUpload = a.candidate.origin === "UPLOAD" ? 1_000_000 : 0;
    const bUpload = b.candidate.origin === "UPLOAD" ? 1_000_000 : 0;
    return bUpload + b.score - (aUpload + a.score) || a.candidate.order - b.candidate.order;
  });
  const selected = ranked.slice(0, MAX_IMAGES).sort((a, b) => a.candidate.order - b.candidate.order);
  if (ranked.length > MAX_IMAGES) {
    warnings.push({
      filename: "全部图片",
      message:
        "共 " + ranked.length + " 张图片候选，已按信息量选出 " + MAX_IMAGES +
        " 张；如需保留更多请压缩素材后分次导入。"
    });
  }

  const images: PreparedImage[] = [];
  for (const item of selected) {
    const candidate = item.candidate;
    let visionBuffer = candidate.buffer;
    let visionMime = candidate.mime;
    try {
      const compressed = await compressForVision(candidate.buffer);
      visionBuffer = compressed.buffer;
      visionMime = compressed.mime;
    } catch {
      const directlySupported =
        candidate.mime === "image/png" ||
        candidate.mime === "image/jpeg" ||
        candidate.mime === "image/webp" ||
        candidate.mime === "image/gif";
      if (directlySupported === false) {
        warnings.push(warning(candidate.filename, "图片格式 " + candidate.mime + " 无法转换，已跳过"));
        continue;
      }
      warnings.push(warning(candidate.filename, "图片压缩失败，将按原图发送给视觉模型"));
    }
    images.push({
      filename: candidate.filename,
      relativePath: "assets/images/" + safeNameStem(candidate.filename) + ".png",
      dataUrl: "data:" + visionMime + ";base64," + visionBuffer.toString("base64"),
      buffer: candidate.buffer,
      mime: candidate.mime,
      origin: candidate.origin,
      pageNumber: candidate.pageNumber,
      pageText: candidate.pageText
    });
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

type AiChatClient = (
  messages: readonly DeepSeekMessage[],
  options?: DeepSeekChatOptions
) => Promise<string>;

interface GenerationStats {
  calls: number;
  maxAttempts: number;
}

const SECTION_SET = new Set<string>(REQUIRED_MODULE_SECTIONS);

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
  for (const [kind, plural] of Object.entries(STRUCTURED_PLURALS)) {
    for (const item of draft.structured[kind] ?? []) {
      lines.push(yamlBlock(kind, item), "");
    }
  }
  return lines.join("\n");
}

const CHUNK_SYSTEM_MESSAGE: DeepSeekMessage = {
  role: "system",
  content:
    "你是严谨的中文 TRPG 团本编辑。当前任务是分块提取素材，每次调用都是完全独立的导入任务，" +
    "不继承任何历史上下文；只依据本次用户消息中的素材片段输出严格 JSON，不要续写、不要解释。"
};

const IMAGE_SYSTEM_MESSAGE: DeepSeekMessage = {
  role: "system",
  content:
    "你是 TRPG 素材视觉分析助手。每次调用都是独立任务，只依据当前图片与随图文字输出严格 JSON；" +
    "看不清或不确定的内容必须如实说明，不得脑补。"
};

function structuredSchemaHint(): string {
  return [
    "structured 可用字段（只输出本段中出现的，没有就省略）：",
    '{"chapters":[{"id":"ch1","name":"章节名","summary":"..."}],',
    '"scenes":[{"id":"scene1","name":"场景名","description":"...","width":1600,"height":1000,"gridType":"SQUARE 或 HEX","bgColor":"#1a1a2e","background":"assets/images/xxx.png 或留空"}],',
    '"encounters":[{"id":"enc1","name":"遭遇名","sceneId":"scene1","sceneName":"场景名","chapterId":"ch1","chapterName":"章节名","trigger":"...","setup":{}}],',
    '"npcs":[{"id":"npc1","name":"NPC 名","tier":"MINION 或 STANDARD 或 ELITE 或 BOSS","rarity":"COMMON","race":null,"tags":[],"description":"...","portrait":"assets/images/xxx.png 或留空","attributes":{"str":50,"con":50,"siz":50,"dex":50,"app":50,"int":50,"pow":50,"edu":50,"luck":50},"skills":{"DODGE":40},"maxHp":12,"maxMp":10,"maxSan":50,"maxDp":0}],',
    '"clues":[{"id":"clue1","title":"线索名","content":"线索正文","image":"assets/clues/xxx.png 或留空","isPublic":false,"linkedItemId":"item1 或留空"}],',
    '"items":[{"id":"item1","name":"道具名","itemType":"WEAPON 或 ITEM 或 TOME 或 ARTIFACT 或 EVIDENCE","description":"...","rarity":"COMMON","image":"assets/images/xxx.png 或留空","quantity":1,"damage":"1d6 或留空","range":"MELEE 或 NEAR 或 FAR 或留空","skillId":"FIGHTING_BRAWL 等或留空","accuracyMod":0}],',
    '"endings":[{"id":"end1","name":"结局名","condition":"...","description":"..."}],',
    '"rewards":[{"id":"reward1","name":"奖励名","description":"..."}],',
    '"magic":[{"id":"spell1","name":"法术名","skill":"MAGIC 或 OCCULT","mpCost":"3","sanCost":"1d3","damage":"1d6","target":"ONE","targeting":"ENEMY","effects":[{"type":"DAMAGE","amount":"1d6"}],"description":"..."}]}'
  ].join("\n");
}

function chunkExtractionPrompt(chunk: TextChunk, hints: {
  readonly system: "COC7" | "TOUHOU";
  readonly era: string;
  readonly instructions: string;
}): string {
  const lines: string[] = [];
  lines.push("请从下面这一小段团本素材中做“分块提取”。只处理这一段，不要参考其他段落或历史任务。");
  lines.push("目标系统：" + hints.system + "；年代：" + hints.era + "。");
  if (hints.instructions.trim().length > 0) {
    lines.push("用户额外要求：" + hints.instructions.trim().slice(0, 2000));
  }
  lines.push(
    "来源：" + chunk.filename +
    "，本文件第 " + String(chunk.fileIndex) + "/" + String(chunk.fileTotal) + " 段" +
    (chunk.heading.length === 0 ? "" : "，最近标题：" + chunk.heading)
  );
  lines.push("要求：");
  lines.push("- 只提取本段明确出现的事实、剧情、NPC、场景、线索、道具、法术；没有的字段直接省略，不要编造，也不要输出其他段落的内容。");
  lines.push("- 原文中的标题、编号 / 标记、专有名词、NPC / 场景 / 道具 / 技能 / 法术名、数字与判定值必须原样保留；压缩时只能压缩形容词，不能删除任何条目。");
  lines.push("- 叙事 / 设定按语义归入 sections 中最贴切的标准章节；实在无法归类就放入 附录。只要本段有正文，就至少输出一个 sections 字段，并尽量保留所有小节标题。");
  lines.push("- 结构化实体放入 structured；字段 id 用 slug，同一实体在不同段落请用同名 / 同 id，方便合并。");
  lines.push("- 输出必须是单个合法 JSON 对象，不要 markdown 代码围栏，不要解释。");
  lines.push("- 总长度控制在 4000 个中文字符以内，JSON 必须完整闭合。");
  lines.push("JSON 结构：");
  lines.push('{"meta":{"title":"...","summary":"...","background":"...","occupationRecommendation":"..."},');
  lines.push('"sections":{"元信息":"...","真相与背景":"...","剧情梗概":"...","开场钩子":"...","关键NPC":"...","地点与场景":"...","线索":"...","遭遇与战斗":"...","道具与手书":"...","怪物与神话生物":"...","结局分支":"...","奖励与成长":"...","KP备注":"...","附录":"..."},');
  lines.push('"structured":{...}}');
  lines.push(structuredSchemaHint());
  lines.push("");
  lines.push("本段原文：");
  lines.push(chunk.text);
  return lines.join("\n");
}

function imageAnalysisPrompt(
  images: readonly PreparedImage[],
  hints: { readonly system: "COC7" | "TOUHOU"; readonly era: string },
  compact = false
): string {
  const lines: string[] = [];
  lines.push("请逐张分析下面的图片素材，并把结果整理成 JSON。");
  lines.push("目标系统：" + hints.system + "；年代：" + hints.era + "。");
  lines.push("要求：");
  lines.push("- 每张图片必须返回一条 images 记录，filename 与输入完全一致。");
  lines.push("- kind 只能是 MAP / SCENE / HANDOUT / CLUE / NPC / ITEM / TEXT / OTHER 之一。");
  lines.push("- transcription：逐字抄录图中可见文字（保留原文，可附中文翻译）；" + (compact ? "最多 800 字。" : "最多 2000 字。"));
  lines.push("- description：客观描述画面内容、人物、地图结构、房间 / 地点标记，不要脑补素材中不存在的设定。");
  lines.push("- section：选一个最贴切的标准章节；sectionText：可直接写进该章节的中文正文（" + (compact ? "最多 500 字" : "最多 1200 字") + "）。");
  lines.push("- 如果图片是地图，尽量给出 scene（name / description / width / height / gridType）；是手书 / 文件就给 clue；是人物立绘就给 npc；是物品就给 item；否则对应字段返回 null。");
  lines.push("- 只返回单个合法 JSON 对象，不要解释、不要 markdown 代码围栏。");
  lines.push('JSON 结构：{"images":[{"filename":"...","kind":"MAP","transcription":"...","description":"...","section":"地点与场景","sectionText":"...","scene":{"id":"scene1","name":"...","description":"...","width":1600,"height":1000,"gridType":"SQUARE"},"clue":null,"npc":null,"item":null}]}');
  lines.push("");
  lines.push("图片清单：");
  for (const image of images) {
    lines.push("- filename：" + image.filename + "；引用路径：" + image.relativePath);
    if (image.pageNumber !== undefined) {
      lines.push("  来源：PDF 第 " + String(image.pageNumber) + " 页" + (image.origin === "PAGE_RENDER" ? "（整页渲染）" : "（内嵌图）"));
    }
    if (image.pageText !== undefined && image.pageText.trim().length > 0) {
      lines.push("  同页文字（可能不完整）：" + image.pageText.trim().slice(0, 1200));
    }
  }
  return lines.join("\n");
}

function combineChunkExtractions(
  left: ChunkExtraction,
  right: ChunkExtraction,
  label: string
): ChunkExtraction {
  const sections: Record<string, string> = { ...left.sections };
  for (const [section, value] of Object.entries(right.sections)) {
    const current = sections[section];
    sections[section] = current === undefined || current.length === 0 ? value : current + "\n\n" + value;
  }
  const structured: Record<string, Record<string, unknown>[]> = {};
  const meta: Record<string, unknown> = { ...left.meta };
  for (const [key, value] of Object.entries(right.meta)) {
    const current = meta[key];
    if (typeof current === "string" && typeof value === "string") {
      meta[key] = value.length > current.length ? value : current;
    } else if (current === undefined) {
      meta[key] = value;
    }
  }
  for (const key of new Set([...Object.keys(left.structured), ...Object.keys(right.structured)])) {
    structured[key] = [...(left.structured[key] ?? []), ...(right.structured[key] ?? [])];
  }
  return { label, meta, sections, structured };
}

function splitTextAtMiddle(text: string): { readonly left: string; readonly right: string } | null {
  if (text.length < 400) return null;
  const middle = Math.floor(text.length / 2);
  const before = text.lastIndexOf("\n\n", middle);
  const after = text.indexOf("\n\n", middle);
  let split = middle;
  if (before > text.length * 0.25) split = before;
  else if (after > 0 && after < text.length * 0.75) split = after;
  if (split <= 0 || split >= text.length - 1) return null;
  const left = text.slice(0, split).trim();
  const right = text.slice(split).trim();
  if (left.length < 100 || right.length < 100) return null;
  return { left, right };
}

async function callJsonModel(input: {
  readonly chat: AiChatClient;
  readonly messages: readonly DeepSeekMessage[];
  readonly label: string;
  readonly maxTokens: number;
  readonly model?: string;
  readonly stats: GenerationStats;
  readonly onProgress?: (message: string) => void;
}): Promise<unknown> {
  let messages = [...input.messages];
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    input.stats.calls += 1;
    input.stats.maxAttempts = Math.max(input.stats.maxAttempts, attempt);
    input.onProgress?.(input.label + "：DeepSeek 第 " + attempt + "/3 次…");
    let raw: string;
    try {
      raw = await input.chat(messages, {
        model: input.model,
        jsonMode: true,
        temperature: attempt === 1 ? 0.15 : 0.05,
        maxTokens: input.maxTokens
      });
    } catch (error) {
      if (error instanceof DeepSeekTruncationError) throw error;
      lastError = error instanceof Error ? error.message : "调用失败";
      continue;
    }
    try {
      return extractJsonObject(raw);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "JSON 解析失败";
      messages = [
        ...input.messages,
        {
          role: "user",
          content:
            "上次输出不是合法 JSON（" + lastError + "）。请重新只返回一个完整、合法、闭合的 JSON 对象，" +
            "不要解释、不要 markdown 代码围栏，并适当压缩内容长度。"
        }
      ];
    }
  }
  throw new Error(input.label + " 连续 3 次未返回合法 JSON：" + lastError);
}

function normalizeChunkExtraction(raw: unknown, label: string): ChunkExtraction {
  const root = asRecord(raw);
  const metaRaw = asRecord(root.meta ?? root.frontMatter ?? {});
  const meta: Record<string, unknown> = {};
  for (const key of ["title", "summary", "background", "occupationRecommendation"]) {
    const value = asString(metaRaw[key]);
    if (value.length > 0) meta[key] = value;
  }
  const sectionsRaw = asRecord(root.sections ?? root["章节"] ?? {});
  const sections: Record<string, string> = {};
  for (const section of REQUIRED_MODULE_SECTIONS) {
    const value = asString(sectionsRaw[section] ?? sectionsRaw[section.replace(/与/g, "")] ?? "");
    if (value.length > 0) sections[section] = value;
  }
  const structuredRaw = asRecord(root.structured ?? root["结构化数据"] ?? {});
  const structured: Record<string, Record<string, unknown>[]> = {};
  for (const [rawKind, value] of Object.entries(structuredRaw)) {
    const plural = rawKind === "spells" ? "magic" : rawKind;
    const kind = (Object.keys(STRUCTURED_PLURALS) as Array<keyof typeof STRUCTURED_PLURALS>).find(
      (item) => STRUCTURED_PLURALS[item] === plural || item === plural || STRUCTURED_PLURALS[item] === plural.replace(/s$/, "")
    );
    if (kind === undefined) continue;
    const entries = asObjectArray(value);
    if (entries.length > 0) structured[kind] = entries;
  }
  return { label, meta, sections, structured };
}

async function extractChunkWithSplit(input: {
  readonly chunk: TextChunk;
  readonly hints: { readonly system: "COC7" | "TOUHOU"; readonly era: string; readonly instructions: string };
  readonly chat: AiChatClient;
  readonly model: string;
  readonly stats: GenerationStats;
  readonly onProgress?: (message: string) => void;
}): Promise<ChunkExtraction> {
  const label = "文本段 " + input.chunk.filename + " " + String(input.chunk.fileIndex) + "/" + String(input.chunk.fileTotal);
  const messages: DeepSeekMessage[] = [
    CHUNK_SYSTEM_MESSAGE,
    { role: "user", content: [{ type: "text", text: chunkExtractionPrompt(input.chunk, input.hints) }] }
  ];
  try {
    const raw = await callJsonModel({
      chat: input.chat,
      messages,
      label,
      model: input.model,
      maxTokens: MAX_CHUNK_OUTPUT_TOKENS,
      stats: input.stats,
      onProgress: input.onProgress
    });
    return normalizeChunkExtraction(raw, label);
  } catch (error) {
    if (error instanceof DeepSeekTruncationError) {
      const halves = splitTextAtMiddle(input.chunk.text);
      if (halves !== null) {
        input.onProgress?.(label + " 输出被截断，已自动拆成两段继续解析…");
        const left = await extractChunkWithSplit({
          ...input,
          chunk: { ...input.chunk, text: halves.left, fileIndex: input.chunk.fileIndex, fileTotal: input.chunk.fileTotal }
        });
        const right = await extractChunkWithSplit({
          ...input,
          chunk: { ...input.chunk, text: halves.right, fileIndex: input.chunk.fileIndex, fileTotal: input.chunk.fileTotal }
        });
        return combineChunkExtractions(left, right, label);
      }
      throw new Error(label + " 在最小拆分下仍触达输出上限；请拆分该文件后重试，系统不会生成不完整团本。");
    }
    throw error;
  }
}

function normalizeImageExtractions(raw: unknown, batch: readonly PreparedImage[]): ImageExtraction[] {
  const records = asObjectArray(asRecord(asRecord(raw).images));
  const results: ImageExtraction[] = [];
  for (let index = 0; index < batch.length; index += 1) {
    const image = batch[index];
    if (image === undefined) continue;
    const record = records.find((item) => asString(item.filename) === image.filename) ?? records[index] ?? {};
    const kindRaw = asString(record.kind).toUpperCase();
    const kinds = ["MAP", "SCENE", "HANDOUT", "CLUE", "NPC", "ITEM", "TEXT", "OTHER"];
    const kind = kinds.includes(kindRaw) ? kindRaw : "OTHER";
    const rawSection = asString(record.section);
    const section = SECTION_SET.has(rawSection) ? rawSection : "附录";
    results.push({
      filename: image.filename,
      relativePath: image.relativePath,
      kind,
      transcription: asString(record.transcription).slice(0, 4000),
      description: asString(record.description).slice(0, 3000),
      section,
      sectionText: asString(record.sectionText).slice(0, 3000),
      scene: isPlainRecord(record.scene) ? record.scene : null,
      clue: isPlainRecord(record.clue) ? record.clue : null,
      npc: isPlainRecord(record.npc) ? record.npc : null,
      item: isPlainRecord(record.item) ? record.item : null
    });
  }
  return results;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false;
}

async function analyzeImageBatch(input: {
  readonly images: readonly PreparedImage[];
  readonly hints: { readonly system: "COC7" | "TOUHOU"; readonly era: string };
  readonly chat: AiChatClient;
  readonly model: string;
  readonly stats: GenerationStats;
  readonly onProgress?: (message: string) => void;
  readonly compact?: boolean;
}): Promise<ImageExtraction[]> {
  const label = "图片分析 " + input.images.map((image) => image.filename).join("、").slice(0, 80);
  const parts: DeepSeekContentPart[] = [
    { type: "text", text: imageAnalysisPrompt(input.images, input.hints, input.compact === true) }
  ];
  for (const image of input.images) {
    parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  try {
    const raw = await callJsonModel({
      chat: input.chat,
      messages: [IMAGE_SYSTEM_MESSAGE, { role: "user", content: parts }],
      label,
      model: input.model,
      maxTokens: MAX_IMAGE_OUTPUT_TOKENS,
      stats: input.stats,
      onProgress: input.onProgress
    });
    return normalizeImageExtractions(raw, input.images);
  } catch (error) {
    if (error instanceof DeepSeekTruncationError) {
      if (input.images.length > 1 && input.compact !== true) {
        input.onProgress?.(label + " 输出被截断，已自动拆分为单张图片继续解析…");
        const middle = Math.floor(input.images.length / 2);
        const left = await analyzeImageBatch({ ...input, images: input.images.slice(0, middle) });
        const right = await analyzeImageBatch({ ...input, images: input.images.slice(middle) });
        return [...left, ...right];
      }
      if (input.compact !== true) {
        input.onProgress?.(label + " 输出被截断，正在用精简模式重试…");
        return analyzeImageBatch({ ...input, compact: true });
      }
      throw new Error(label + " 在精简模式下仍被截断；请压缩该图片后重试，系统不会生成不完整团本。");
    }
    throw error;
  }
}

async function analyzeImages(input: {
  readonly images: readonly PreparedImage[];
  readonly hints: { readonly system: "COC7" | "TOUHOU"; readonly era: string };
  readonly chat: AiChatClient;
  readonly model: string;
  readonly stats: GenerationStats;
  readonly onProgress?: (message: string) => void;
}): Promise<ImageExtraction[]> {
  const results: ImageExtraction[] = [];
  const batchSize = 2;
  for (let offset = 0; offset < input.images.length; offset += batchSize) {
    const batch = input.images.slice(offset, offset + batchSize);
    input.onProgress?.("正在分析图片 " + String(Math.min(offset + batch.length, input.images.length)) + "/" + String(input.images.length) + "…");
    results.push(...(await analyzeImageBatch({ ...input, images: batch })));
  }
  return results;
}

/**
 * 从原文中抽取“不能丢”的关键片段（标题、编号、大写标记、清单项等）。
 * 模型可以概括形容词，但这些结构性 token 必须能在提取结果里找到；
 * 找不到就把原句自动补录到附录，避免整条内容被概括掉。
 */
function salientSourceSnippets(text: string): { readonly key: string; readonly snippet: string }[] {
  const snippets: { key: string; snippet: string }[] = [];
  const seen = new Set<string>();
  const push = (snippet: string, key: string): void => {
    const cleanSnippet = snippet.trim().replace(/\s+/g, " ").slice(0, 800);
    const cleanKey = key.trim().replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "").toLowerCase();
    if (cleanSnippet.length < 2 || cleanKey.length < 2 || seen.has(cleanKey)) return;
    seen.add(cleanKey);
    snippets.push({ key: cleanKey, snippet: cleanSnippet });
  };
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (/^#{1,6}\s+/.test(trimmed) || /^【[^】]{1,60}】/.test(trimmed)) {
      push(trimmed, trimmed.replace(/^#{1,6}\s+/, ""));
    }
    for (const match of trimmed.matchAll(/[A-Z][A-Z0-9_\-]{3,}/g)) {
      const token = match[0];
      if (token === undefined) continue;
      push(trimmed, token);
    }
    for (const match of trimmed.matchAll(/第\s*[一二三四五六七八九十百0-9]+\s*[章节条项幕]/g)) {
      const token = match[0];
      if (token === undefined) continue;
      push(trimmed, token);
    }
    if (/^([-*·]|\d+[.、)])\s+/.test(trimmed)) push(trimmed, trimmed);
  }
  return snippets;
}

function coverageSearchText(extraction: ChunkExtraction): string {
  const parts: string[] = [];
  for (const value of Object.values(extraction.sections)) parts.push(value);
  for (const [key, value] of Object.entries(extraction.meta)) parts.push(String(key), String(value));
  parts.push(JSON.stringify(extraction.structured));
  return parts.join("\n").replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "").toLowerCase();
}

function missingCoverageSnippets(chunkText: string, extraction: ChunkExtraction): string[] {
  const search = coverageSearchText(extraction);
  const missing: string[] = [];
  for (const item of salientSourceSnippets(chunkText)) {
    if (search.includes(item.key)) continue;
    missing.push(item.snippet);
    if (missing.length >= 20) break;
  }
  return missing;
}

async function generateDraftFromChunks(input: {
  readonly chunks: readonly TextChunk[];
  readonly images: readonly PreparedImage[];
  readonly hints: { readonly system: "COC7" | "TOUHOU"; readonly era: string; readonly author: string; readonly instructions: string };
  readonly title: string;
  readonly chat: AiChatClient;
  readonly model: string;
  readonly onProgress?: (message: string) => void;
}): Promise<{
  readonly draft: AiDraft;
  readonly markdown: string;
  readonly warnings: readonly string[];
  readonly chunksCompleted: number;
  readonly imagesAnalyzed: number;
  readonly aiCalls: number;
  readonly attempts: number;
}> {
  const stats: GenerationStats = { calls: 0, maxAttempts: 1 };
  const extractions: ChunkExtraction[] = [];
  for (let index = 0; index < input.chunks.length; index += 1) {
    const chunk = input.chunks[index];
    if (chunk === undefined) continue;
    input.onProgress?.("正在解析文本段 " + String(index + 1) + "/" + String(input.chunks.length) + "（" + chunk.filename + "）…");
    const extraction = await extractChunkWithSplit({
      chunk,
      hints: input.hints,
      chat: input.chat,
      model: input.model,
      stats,
      onProgress: input.onProgress
    });
    const hasContent =
      Object.values(extraction.sections).some((value) => value.trim().length > 0) ||
      Object.values(extraction.structured).some((entries) => entries.length > 0);
    const missingSnippets = missingCoverageSnippets(chunk.text, extraction);
    const fallbackParts: string[] = [];
    if (hasContent === false) {
      fallbackParts.push("（本段未提取出明确章节信息，原文保留如下）\n" + chunk.text.slice(0, 2000));
    }
    if (missingSnippets.length > 0) {
      fallbackParts.push(
        "【以下原文条目在分块提取中未被模型保留，系统已自动补录，避免内容丢失】\n" +
        missingSnippets.join("\n")
      );
    }
    extractions.push(
      fallbackParts.length === 0
        ? extraction
        : { ...extraction, fallbackText: fallbackParts.join("\n\n") }
    );
  }

  const imagesAnalyzed = input.images.length;
  const imageExtractions = input.images.length === 0
    ? []
    : await analyzeImages({
        images: input.images,
        hints: input.hints,
        chat: input.chat,
        model: input.model,
        stats,
        onProgress: input.onProgress
      });

  input.onProgress?.("正在合并 " + String(input.chunks.length) + " 段文本与 " + String(imagesAnalyzed) + " 张图片的解析结果…");
  const draft = mergeDraft({
    title: input.title,
    system: input.hints.system,
    era: input.hints.era,
    author: input.hints.author,
    extractions,
    images: imageExtractions,
    validImagePaths: new Set(input.images.map((image) => image.relativePath))
  });
  const markdown = assembleMarkdown(draft, input.images.map((image) => image.relativePath));
  const parsed = parseModuleMarkdown(markdown);
  if (parsed.errors.length > 0) {
    throw new Error("分块结果合并后结构校验失败：" + parsed.errors.slice(0, 6).join("；"));
  }
  return {
    draft,
    markdown,
    warnings: parsed.warnings,
    chunksCompleted: input.chunks.length,
    imagesAnalyzed,
    aiCalls: stats.calls,
    attempts: stats.maxAttempts
  };
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
}, deps: ImportModuleDependencies = {}): Promise<AiImportResult> {
  const chat = deps.chat ?? chatDeepSeek;
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

  const chunks = prepared.sources.flatMap((source) =>
    chunkSourceText({
      filename: source.filename,
      text: source.text,
      targetChars: CHUNK_TARGET_CHARS,
      maxChars: CHUNK_MAX_CHARS
    })
  );
  if (chunks.length > MAX_TEXT_CHUNKS) {
    throw new Error(
      "素材共切成 " + chunks.length + " 段，超过单次导入上限 " + MAX_TEXT_CHUNKS +
      " 段；系统会拒绝生成不完整团本，请拆分素材后分批导入。"
    );
  }
  if (prepared.sources.length > 0) {
    input.onProgress?.(
      "文字素材共 " + String(chunks.length) + " 段（单段上限 " + String(CHUNK_MAX_CHARS) +
      " 字），将逐段解析并合并；不会再把整本一次性交给模型。"
    );
  }

  const generated = await generateDraftFromChunks({
    chunks,
    images: prepared.images,
    hints: {
      system,
      era: input.requestedEra,
      author: input.author,
      instructions: input.instructions
    },
    title,
    chat,
    model,
    onProgress: input.onProgress
  });

  input.onProgress?.("分块结果合并、结构校验通过，正在写入团本…");
  const slug = await uniqueSlug(input.roomId.length === 0 ? null : input.roomId, generated.draft.frontMatter.id || title);
  const moduleRecord = await prisma.module.create({
    data: {
      ownerId: input.userId,
      roomId: input.roomId.length === 0 ? null : input.roomId,
      slug,
      title: generated.draft.frontMatter.title,
      synopsis: generated.draft.frontMatter.summary,
      author: generated.draft.frontMatter.author,
      system: generated.draft.frontMatter.system,
      era: generated.draft.frontMatter.era,
      background: generated.draft.frontMatter.background || null,
      occupationRecommendation: generated.draft.frontMatter.occupationRecommendation || null,
      version: generated.draft.frontMatter.version,
      sourceType: "AI_DEEPSEEK",
      originalFilename: input.files.map((file) => file.name).join(", ").slice(0, 300),
      content: {
        format: "markdown",
        text: generated.markdown,
        sections: parseModuleMarkdown(generated.markdown).sections,
        structured: parseStructuredBlocks(generated.markdown)
      } as never,
      metadata: {
        aiModel: model,
        aiSessionId: sessionId,
        aiGeneratedAt: new Date().toISOString(),
        sourceFiles: input.files.map((file) => file.name).slice(0, 60),
        instructions: input.instructions
      } as never,
      importReport: {
        warnings: [...warnings, ...generated.warnings.map((text) => ({ filename: "AI 校验", message: text }))],
        sourceCount: prepared.sources.length,
        imageCount: prepared.images.length,
        textChunks: chunks.length,
        textChunksCompleted: generated.chunksCompleted,
        imagesAnalyzed: generated.imagesAnalyzed,
        aiCalls: generated.aiCalls,
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
    title: generated.draft.frontMatter.title,
    model,
    sessionId,
    attempts: generated.attempts,
    aiCalls: generated.aiCalls,
    chunks: chunks.length,
    chunksCompleted: generated.chunksCompleted,
    imagesAnalyzed: generated.imagesAnalyzed,
    imagesUsed: prepared.images.length,
    warnings
  };
}
