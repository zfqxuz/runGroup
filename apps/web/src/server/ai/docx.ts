import { posix } from "node:path";
import AdmZip from "adm-zip";

export interface ExtractedEmbeddedImage {
  readonly filename: string;
  readonly buffer: Buffer;
  readonly mime: string;
  readonly pageText?: string;
  readonly origin: "EMBEDDED";
}

export interface DecodedText {
  readonly text: string;
  readonly encoding: string;
  readonly replacementCount: number;
}

export interface ReadDocxResult {
  readonly text: string;
  readonly images: readonly ExtractedEmbeddedImage[];
  readonly warnings: readonly string[];
}

function replacementCount(value: string): number {
  const matches = value.match(/\uFFFD/g);
  return matches === null ? 0 : matches.length;
}

function decodeWith(label: string, buffer: Buffer, fatal: boolean): string {
  const decoder = new TextDecoder(label, { fatal });
  return decoder.decode(new Uint8Array(buffer));
}

/**
 * 文本素材编码探测：
 * 先严格按 UTF-8；失败后再用 GB18030（覆盖 GBK / GB2312 中文文档），
 * 最后以替换字符更少的一方为准，避免把整篇中文变成 �。
 */
export function decodeTextBuffer(buffer: Buffer): DecodedText {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8-bom", replacementCount: 0 };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    const text = decodeWith("utf-16le", buffer.subarray(2), false);
    return { text, encoding: "utf-16le", replacementCount: replacementCount(text) };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const text = decodeWith("utf-16be", buffer.subarray(2), false);
    return { text, encoding: "utf-16be", replacementCount: replacementCount(text) };
  }
  try {
    const text = decodeWith("utf-8", buffer, true);
    return { text, encoding: "utf-8", replacementCount: 0 };
  } catch {
    // 继续尝试中文编码
  }
  const gb = decodeWith("gb18030", buffer, false);
  const utf8Fallback = decodeWith("utf-8", buffer, false);
  const gbBad = replacementCount(gb);
  const utf8Bad = replacementCount(utf8Fallback);
  if (gbBad < utf8Bad) {
    return { text: gb, encoding: "gb18030", replacementCount: gbBad };
  }
  return { text: utf8Fallback, encoding: "utf-8", replacementCount: utf8Bad };
}

function decodeXmlBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return decodeWith("utf-16le", buffer.subarray(2), false);
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decodeWith("utf-16be", buffer.subarray(2), false);
  }
  const head = buffer.subarray(0, 200).toString("latin1");
  const match = /encoding\s*=\s*["']([^"']+)["']/i.exec(head);
  const label = match === null ? "utf-8" : (match[1] ?? "utf-8").toLowerCase();
  const normalized = label === "gb2312" || label === "gbk" || label === "gb-2312" ? "gb18030" : label;
  try {
    return decodeWith(normalized, buffer, false);
  } catch {
    return buffer.toString("utf8");
  }
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return "\"";
    if (lower === "apos") return "'";
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function xmlAttr(tag: string, name: string): string {
  const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '\\s*=\\s*"([^"]*)"', "i");
  const match = pattern.exec(tag);
  return match === null ? "" : decodeEntities(match[1] ?? "");
}

function extractParagraphText(paragraphXml: string): string {
  const cleaned = paragraphXml.replace(/<w:del\b[\s\S]*?<\/w:del>/gi, "");
  const tokenPattern = /<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>/gi;
  let value = "";
  for (const match of cleaned.matchAll(tokenPattern)) {
    const whole = match[0];
    if (/^<w:t/i.test(whole)) {
      value += decodeEntities(match[1] ?? "");
    } else if (/^<w:tab/i.test(whole)) {
      value += "\t";
    } else {
      value += "\n";
    }
  }
  return value.replace(/[ \t]+\n/g, "\n").trim();
}

function maxRunFontSize(paragraphXml: string): number {
  let size = 0;
  for (const match of paragraphXml.matchAll(/<w:sz w:val="(\d+)"/g)) {
    const value = Number(match[1] ?? "0");
    if (Number.isFinite(value) && value > size) size = value;
  }
  return size;
}

function headingLevel(paragraphXml: string, text: string): number {
  const styleMatch = /<w:pStyle[^>]*w:val="([^"]+)"/i.exec(paragraphXml);
  const style = styleMatch === null ? "" : (styleMatch[1] ?? "").toLowerCase();
  const heading = /(?:heading|标题|h)\s*([1-6])/.exec(style);
  if (heading !== null) return Number(heading[1] ?? "1");
  if (style.includes("title")) return 1;
  const outline = /<w:outlineLvl[^>]*w:val="([0-9])"/i.exec(paragraphXml);
  if (outline !== null) return Math.min(6, Number(outline[1] ?? "0") + 1);
  // 中文 Word 文档常用直接字号而非 Heading 样式；用字号兜底推断标题层级。
  if (text.length > 120) return 0;
  const size = maxRunFontSize(paragraphXml);
  if (size >= 96) return 1;
  if (size >= 44) return 2;
  if (size >= 32) return 3;
  return 0;
}

function isListParagraph(paragraphXml: string): boolean {
  return /<w:numPr\b/i.test(paragraphXml);
}

function paragraphLines(xml: string, prefix = ""): string[] {
  const lines: string[] = [];
  for (const paragraphXml of xml.split(/<w:p[ >]/)) {
    const text = extractParagraphText(paragraphXml);
    if (text.length === 0) continue;
    const level = headingLevel(paragraphXml, text);
    if (level > 0) {
      lines.push("#".repeat(level) + " " + text);
    } else if (isListParagraph(paragraphXml)) {
      lines.push("- " + text);
    } else {
      lines.push(prefix + text);
    }
  }
  return lines;
}

function imageMime(buffer: Buffer): string {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.length > 12 && buffer.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (buffer.length > 12 && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length > 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return "image/avif";
  if (buffer.length > 3 && buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a) return "image/tiff";
  if (buffer.length > 3 && buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00) return "image/tiff";
  return "application/octet-stream";
}

function imageExtFromTarget(target: string): string {
  const match = /[.]([a-z0-9]+)$/i.exec(target);
  const extension = match === null ? "" : (match[1] ?? "").toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "bmp") return "image/bmp";
  if (extension === "tif" || extension === "tiff") return "image/tiff";
  if (extension === "svg") return "image/svg+xml";
  return "";
}

function buildImageRelationships(zip: AdmZip): Map<string, string> {
  const map = new Map<string, string>();
  const rels = zip.getEntry("word/_rels/document.xml.rels");
  if (rels === null) return map;
  const xml = decodeXmlBuffer(rels.getData());
  const pattern = /<Relationship\b[^>]*\/?>/gi;
  for (const match of xml.matchAll(pattern)) {
    const tag = match[0];
    const type = xmlAttr(tag, "Type");
    if (type.includes("/image") === false) continue;
    const id = xmlAttr(tag, "Id");
    const target = xmlAttr(tag, "Target");
    const mode = xmlAttr(tag, "TargetMode").toLowerCase();
    if (id.length === 0 || target.length === 0 || mode === "external") continue;
    let decodedTarget = target;
    try {
      decodedTarget = decodeURIComponent(target);
    } catch {
      decodedTarget = target;
    }
    map.set(id, decodedTarget);
  }
  return map;
}

function resolveMediaPath(target: string): string {
  const value = target.replace(/\\/g, "/");
  if (value.startsWith("/")) return value.slice(1);
  return posix.normalize(posix.join("word", value));
}

function readReferencedImages(zip: AdmZip, documentXml: string, filename: string): ExtractedEmbeddedImage[] {
  const relationships = buildImageRelationships(zip);
  const images: ExtractedEmbeddedImage[] = [];
  const seen = new Set<string>();
  let index = 0;
  for (const paragraphXml of documentXml.split(/<w:p[ >]/)) {
    const paragraphText = extractParagraphText(paragraphXml);
    for (const match of paragraphXml.matchAll(/(?:r:embed|r:id|r:link)="([^"]+)"/gi)) {
      const relId = match[1] ?? "";
      if (relId.length === 0 || seen.has(relId)) continue;
      const target = relationships.get(relId);
      if (target === undefined) continue;
      const entryPath = resolveMediaPath(target);
      const entry = zip.getEntry(entryPath);
      if (entry === null) continue;
      const data = entry.getData();
      if (data.length === 0) continue;
      seen.add(relId);
      index += 1;
      images.push({
        filename: filename + "（内嵌图 " + index + "）",
        buffer: data,
        mime: imageMime(data) === "application/octet-stream" ? imageExtFromTarget(target) || "application/octet-stream" : imageMime(data),
        pageText: paragraphText.length > 0 ? paragraphText : undefined,
        origin: "EMBEDDED"
      });
    }
  }
  return images;
}

function readSupplementLines(zip: AdmZip): { readonly lines: string[]; readonly warnings: string[] } {
  const lines: string[] = [];
  const warnings: string[] = [];
  const parts: { readonly pattern: RegExp; readonly label: string }[] = [
    { pattern: /^word\/header\d+\.xml$/, label: "【页眉】" },
    { pattern: /^word\/footer\d+\.xml$/, label: "【页脚】" },
    { pattern: /^word\/footnotes\.xml$/, label: "【脚注】" },
    { pattern: /^word\/endnotes\.xml$/, label: "【尾注】" },
    { pattern: /^word\/comments\.xml$/, label: "【批注】" }
  ];
  for (const entry of zip.getEntries()) {
    const part = parts.find((item) => item.pattern.test(entry.entryName));
    if (part === undefined || entry.header.size === 0) continue;
    try {
      const xml = decodeXmlBuffer(entry.getData());
      const text = paragraphLines(xml).join("\n");
      if (text.trim().length > 0) lines.push(part.label + "\n" + text);
    } catch (error) {
      warnings.push(entry.entryName + " 读取失败：" + (error instanceof Error ? error.message : "未知错误"));
    }
  }
  return { lines, warnings };
}

/** 解析 docx：保留段落 / 标题 / 列表结构，并抽取正文内嵌图片（含图注上下文）。 */
export function readDocx(input: { readonly buffer: Buffer; readonly filename: string }): ReadDocxResult {
  const warnings: string[] = [];
  let zip: AdmZip;
  try {
    zip = new AdmZip(input.buffer);
  } catch (error) {
    return { text: "", images: [], warnings: ["docx 压缩包无法读取：" + (error instanceof Error ? error.message : "未知错误")] };
  }
  const documentEntry = zip.getEntry("word/document.xml");
  if (documentEntry === null) {
    return { text: "", images: [], warnings: ["docx 缺少 word/document.xml"] };
  }
  const documentXml = decodeXmlBuffer(documentEntry.getData());
  const lines = paragraphLines(documentXml);
  const supplements = readSupplementLines(zip);
  warnings.push(...supplements.warnings);

  const images = readReferencedImages(zip, documentXml, input.filename);
  if (images.length === 0) {
    const media = zip.getEntries().filter((entry) => entry.entryName.startsWith("word/media/") && entry.header.size > 0);
    let index = 0;
    for (const entry of media) {
      const data = entry.getData();
      if (data.length === 0) continue;
      index += 1;
      images.push({
        filename: input.filename + "（包内图片 " + index + "）",
        buffer: data,
        mime: imageMime(data),
        origin: "EMBEDDED"
      });
    }
    if (media.length > 0) {
      warnings.push("未能从正文定位图片顺序，已按 docx 包内顺序追加 " + String(media.length) + " 张图片");
    }
  }

  const text = [lines.join("\n\n"), ...supplements.lines].filter((part) => part.length > 0).join("\n\n");
  if (images.length === 0) {
    warnings.push("docx 内没有可提取的图片");
  } else {
    warnings.push("docx 已提取 " + String(images.length) + " 张内嵌图片");
  }
  return { text, images, warnings };
}
