import { createHash } from "node:crypto";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse as parseYaml } from "yaml";

export const REQUIRED_MODULE_SECTIONS = [
  "元信息",
  "真相与背景",
  "剧情梗概",
  "开场钩子",
  "关键NPC",
  "地点与场景",
  "线索",
  "遭遇与战斗",
  "道具与手书",
  "怪物与神话生物",
  "结局分支",
  "奖励与成长",
  "KP备注",
  "附录"
] as const;

export interface ModuleFrontMatter {
  readonly spec: string;
  readonly id: string;
  readonly title: string;
  readonly system: string;
  readonly era: string;
  readonly author: string;
  readonly version: string;
  readonly summary: string;
  readonly [key: string]: unknown;
}

export interface ModuleAssetInput {
  readonly relativePath: string;
  readonly originalName: string;
  readonly kind: string;
  readonly buffer: Buffer;
}

export interface ParsedModuleMarkdown {
  readonly frontMatter: ModuleFrontMatter;
  readonly markdown: string;
  readonly sections: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface ParsedModulePackage {
  readonly frontMatter: ModuleFrontMatter;
  readonly markdown: string;
  readonly sections: readonly string[];
  readonly assets: readonly ModuleAssetInput[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const ALLOWED_ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "pdf",
  "md",
  "txt",
  "json",
  "yaml",
  "yml",
  "mp3",
  "ogg",
  "wav",
  "mp4",
  "webm"
]);
const EXECUTABLE_EXTENSIONS = new Set(["exe", "dll", "bat", "cmd", "sh", "js", "mjs", "cjs", "php", "py", "rb", "jar", "msi", "com"]);
const KIND_BY_DIRECTORY: Record<string, string> = {
  images: "IMAGE",
  maps: "MAP",
  handouts: "HANDOUT",
  audio: "AUDIO",
  video: "VIDEO"
};

function hashOf(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 8);
}

export function slugifyModuleId(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return base.length > 0 ? base : "module-" + hashOf(input);
}

function safeDirectorySegment(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return (base.length > 0 ? base : "asset") + "-" + hashOf(input);
}

function extensionOf(filename: string): string {
  const match = /[.]([a-z0-9]+)$/i.exec(filename);
  return match?.[1]?.toLowerCase() ?? "";
}

function safeFileName(input: string): string {
  const ext = extensionOf(input);
  if (ext.length === 0 || ALLOWED_ASSET_EXTENSIONS.has(ext) === false) return "";
  const stem = input.slice(0, input.length - ext.length - 1);
  const base = stem
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return (base.length > 0 ? base : "asset") + "-" + hashOf(input) + "." + ext;
}

function cleanRelativePath(originalPath: string, moduleSlug: string): { relativePath: string; kind: string } | null {
  const parts = originalPath.split("/").filter((part) => part.length > 0);
  if (parts.length < 3) return null;
  const folder = parts[0];
  const directory = parts[1];
  if (folder !== "assets" || directory === undefined) return null;
  const kind = KIND_BY_DIRECTORY[directory];
  if (kind === undefined) return null;
  const cleanParts: string[] = ["assets", directory, moduleSlug];
  const fileName = parts[parts.length - 1] ?? "";
  const cleanFileName = safeFileName(fileName);
  if (cleanFileName.length === 0) return null;
  cleanParts.push(cleanFileName);
  return { relativePath: cleanParts.join("/"), kind };
}

function parseFrontMatter(source: string): { frontMatter: ModuleFrontMatter; body: string; errors: string[] } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (match === null) {
    return {
      frontMatter: {
        spec: "",
        id: "",
        title: "",
        system: "",
        era: "",
        author: "",
        version: "",
        summary: ""
      },
      body: source,
      errors: ["module.md 缺少 YAML Front Matter"]
    };
  }
  const raw = match[1] ?? "";
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return {
      frontMatter: { spec: "", id: "", title: "", system: "", era: "", author: "", version: "", summary: "" },
      body: source.slice(match[0].length),
      errors: ["Front Matter 不是合法 YAML"]
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      frontMatter: { spec: "", id: "", title: "", system: "", era: "", author: "", version: "", summary: "" },
      body: source.slice(match[0].length),
      errors: ["Front Matter 必须是对象"]
    };
  }
  const record = parsed as Record<string, unknown>;
  const frontMatter: ModuleFrontMatter = {
    ...record,
    spec: String(record.spec ?? ""),
    id: String(record.id ?? ""),
    title: String(record.title ?? ""),
    system: String(record.system ?? ""),
    era: String(record.era ?? ""),
    author: String(record.author ?? ""),
    version: String(record.version ?? ""),
    summary: String(record.summary ?? "")
  };
  return { frontMatter, body: source.slice(match[0].length), errors: [] };
}

function collectSections(markdown: string): string[] {
  const out: string[] = [];
  const regex = /^##\s+(.+?)\s*$/gm;
  for (const match of markdown.matchAll(regex)) {
    const title = match[1]?.trim();
    if (title !== undefined && title.length > 0) out.push(title);
  }
  return out;
}

export function parseModuleMarkdown(source: string): ParsedModuleMarkdown {
  const parsedFrontMatter = parseFrontMatter(source);
  const errors: string[] = [...parsedFrontMatter.errors];
  const warnings: string[] = [];
  const fm = parsedFrontMatter.frontMatter;
  if (fm.spec !== "touhou-module/v1") errors.push("Front Matter spec 必须是 touhou-module/v1");
  if (fm.id.length === 0) errors.push("Front Matter 缺少 id");
  if (fm.title.length === 0) errors.push("Front Matter 缺少 title");
  if (fm.system !== "COC7" && fm.system !== "TOUHOU") errors.push("Front Matter system 必须是 COC7 或 TOUHOU");
  if (fm.era.length === 0) errors.push("Front Matter 缺少 era");
  if (fm.author.length === 0) errors.push("Front Matter 缺少 author");
  if (fm.version.length === 0) errors.push("Front Matter 缺少 version");
  if (fm.summary.length === 0) errors.push("Front Matter 缺少 summary");
  const sections = collectSections(parsedFrontMatter.body);
  for (const required of REQUIRED_MODULE_SECTIONS) {
    if (sections.includes(required) === false) errors.push("缺少标准章节：## " + required);
  }
  if (sections.length !== REQUIRED_MODULE_SECTIONS.length) {
    warnings.push("标准章节数量为 " + sections.length + "，预期 " + REQUIRED_MODULE_SECTIONS.length);
  }
  return {
    frontMatter: fm,
    markdown: parsedFrontMatter.body,
    sections,
    warnings,
    errors
  };
}

function isUnsafeEntry(name: string): boolean {
  if (name.startsWith("/") || name.includes("\\")) return true;
  const normalized = name.replace(/\\/g, "/");
  return normalized.split("/").some((segment) => segment === ".." || segment.length === 0);
}

function resolveRootPrefix(moduleEntry: string): string {
  const parent = path.posix.dirname(moduleEntry);
  if (parent === "." || parent.length === 0) return "";
  return parent + "/";
}

export function parseModulePackage(buffer: Buffer, filename: string): ParsedModulePackage {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md")) {
    const parsed = parseModuleMarkdown(buffer.toString("utf8"));
    return { ...parsed, assets: [] };
  }
  if (lower.endsWith(".zip") === false) {
    return {
      frontMatter: { spec: "", id: "", title: "", system: "", era: "", author: "", version: "", summary: "" },
      markdown: "",
      sections: [],
      assets: [],
      warnings: [],
      errors: ["只支持 .md 或 .zip"]
    };
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return {
      frontMatter: { spec: "", id: "", title: "", system: "", era: "", author: "", version: "", summary: "" },
      markdown: "",
      sections: [],
      assets: [],
      warnings: [],
      errors: ["无法读取 zip，可能已加密或文件损坏"]
    };
  }

  const rawEntries = zip.getEntries();
  if (rawEntries.length > 500) {
    return {
      frontMatter: { spec: "", id: "", title: "", system: "", era: "", author: "", version: "", summary: "" },
      markdown: "",
      sections: [],
      assets: [],
      warnings: [],
      errors: ["zip 内文件数超过 500"]
    };
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  const fileEntries = rawEntries.filter((entry) => entry.isDirectory === false);
  const names: string[] = [];
  for (const entry of fileEntries) {
    const name = entry.entryName.replace(/\\/g, "/");
    if (isUnsafeEntry(name)) {
      errors.push("非法 zip 路径：" + name);
      continue;
    }
    names.push(name);
  }
  const moduleEntry = names.find((name) => name.toLowerCase().endsWith("module.md"));
  if (moduleEntry === undefined) {
    errors.push("zip 中找不到 module.md");
    return {
      frontMatter: { spec: "", id: "", title: "", system: "", era: "", author: "", version: "", summary: "" },
      markdown: "",
      sections: [],
      assets: [],
      warnings,
      errors
    };
  }
  const rootPrefix = resolveRootPrefix(moduleEntry);
  const moduleFile = fileEntries.find((entry) => entry.entryName.replace(/\\/g, "/") === moduleEntry);
  if (moduleFile === undefined) {
    errors.push("zip 中 module.md 读取失败");
    return {
      frontMatter: { spec: "", id: "", title: "", system: "", era: "", author: "", version: "", summary: "" },
      markdown: "",
      sections: [],
      assets: [],
      warnings,
      errors
    };
  }

  let markdown = moduleFile.getData().toString("utf8");
  const parsed = parseModuleMarkdown(markdown);
  const moduleSlug = slugifyModuleId(parsed.frontMatter.id || parsed.frontMatter.title);

  const assets: ModuleAssetInput[] = [];
  const usedPaths = new Set<string>();
  const replacement = new Map<string, string>();

  for (const entry of fileEntries) {
    const rawName = entry.entryName.replace(/\\/g, "/");
    if (rawName === moduleEntry) continue;
    const relative = rawName.startsWith(rootPrefix) ? rawName.slice(rootPrefix.length) : rawName;
    if (relative.startsWith("assets/") === false) continue;
    const ext = extensionOf(relative);
    if (ext.length === 0 || ALLOWED_ASSET_EXTENSIONS.has(ext) === false) {
      warnings.push("跳过不支持的资源：" + relative);
      continue;
    }
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
      errors.push("禁止导入可执行文件：" + relative);
      continue;
    }
    const clean = cleanRelativePath(relative, moduleSlug);
    if (clean === null) {
      warnings.push("跳过无法规范化的资源路径：" + relative);
      continue;
    }
    let finalPath = clean.relativePath;
    let suffix = 2;
    while (usedPaths.has(finalPath)) {
      const dot = finalPath.lastIndexOf(".");
      finalPath = dot < 0 ? finalPath + "-" + suffix : finalPath.slice(0, dot) + "-" + suffix + finalPath.slice(dot);
      suffix += 1;
    }
    usedPaths.add(finalPath);
    replacement.set(relative, finalPath);
    assets.push({
      relativePath: finalPath,
      originalName: relative,
      kind: clean.kind,
      buffer: entry.getData()
    });
  }

  for (const [from, to] of replacement) {
    markdown = markdown.split(from).join(to);
  }
  const reparsed = parseModuleMarkdown(markdown);
  return {
    frontMatter: reparsed.frontMatter,
    markdown: reparsed.markdown,
    sections: reparsed.sections,
    assets,
    warnings: [...warnings, ...reparsed.warnings],
    errors: [...errors, ...reparsed.errors]
  };
}

export { IMAGE_EXTENSIONS };
