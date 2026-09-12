import { REQUIRED_MODULE_SECTIONS } from "@/server/modules/format";

export const DEFAULT_CHUNK_TARGET = 8000;
export const DEFAULT_CHUNK_MAX = 12000;

export interface TextChunk {
  readonly id: string;
  readonly filename: string;
  readonly fileIndex: number;
  readonly fileTotal: number;
  readonly heading: string;
  readonly text: string;
  readonly charCount: number;
}

export interface ChunkExtraction {
  /** 便于日志 / 排错的来源标识，例如 “story.md 第 2/7 段”。 */
  readonly label: string;
  readonly meta: Record<string, unknown>;
  readonly sections: Record<string, string>;
  readonly structured: Record<string, Record<string, unknown>[]>;
  /** 模型认为本段没有可归类内容时，保留的原文片段，避免素材丢失。 */
  readonly fallbackText?: string;
}

export interface ImageExtraction {
  readonly filename: string;
  readonly relativePath: string;
  readonly kind: string;
  readonly transcription: string;
  readonly description: string;
  readonly section: string;
  readonly sectionText: string;
  readonly scene: Record<string, unknown> | null;
  readonly clue: Record<string, unknown> | null;
  readonly npc: Record<string, unknown> | null;
  readonly item: Record<string, unknown> | null;
}

export interface AiDraftFrontMatter {
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

export interface AiDraft {
  readonly frontMatter: AiDraftFrontMatter;
  readonly sections: Record<string, string>;
  readonly structured: Record<string, Record<string, unknown>[]>;
}

const STRUCTURED_KINDS = [
  "chapter",
  "scene",
  "encounter",
  "npc",
  "clue",
  "item",
  "ending",
  "reward",
  "magic"
] as const;

export type StructuredKind = (typeof STRUCTURED_KINDS)[number];

export const STRUCTURED_PLURALS: Record<StructuredKind, string> = {
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

function cleanText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "")
    .slice(0, 120);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function moduleIdFromTitle(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return base.length > 0 ? base : "module-" + hashString(input);
}

function fallbackId(kind: StructuredKind, name: string): string {
  const ascii = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return kind + "-" + (ascii.length > 0 ? ascii.slice(0, 40) : hashString(name));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false;
}

function asEntryArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => isPlainObject(item));
  }
  if (isPlainObject(value)) return [value];
  return [];
}

function entryName(kind: StructuredKind, entry: Record<string, unknown>): string {
  const primary = kind === "clue" ? cleanText(entry.title) : cleanText(entry.name);
  const secondary = kind === "clue" ? cleanText(entry.name) : cleanText(entry.title);
  return primary || secondary || cleanText(entry.id);
}

/** 按段落切块；保留标题上下文，长段落在句子边界二次切分。 */
export function chunkSourceText(input: {
  readonly filename: string;
  readonly text: string;
  readonly targetChars?: number;
  readonly maxChars?: number;
}): TextChunk[] {
  const target = Math.max(1000, input.targetChars ?? DEFAULT_CHUNK_TARGET);
  const max = Math.max(target, input.maxChars ?? DEFAULT_CHUNK_MAX);
  const normalized = input.text.replace(/\r\n?/g, "\n").trim();
  if (normalized.length === 0) return [];

  const paragraphs: { readonly text: string; readonly heading: string }[] = [];
  let heading = "";
  for (const block of normalized.split(/\n{2,}/)) {
    const text = block.trim();
    if (text.length === 0) continue;
    const firstLine = text.split("\n")[0]?.trim() ?? "";
    if (/^(#{1,6}\s+|【[^】]{1,40}】\s*$)/.test(firstLine)) {
      heading = firstLine.replace(/^#{1,6}\s+/, "").replace(/^【|】$/g, "").trim() || heading;
    }
    paragraphs.push({ text, heading });
  }
  if (paragraphs.length === 0) paragraphs.push({ text: normalized, heading });

  const expanded: { readonly text: string; readonly heading: string }[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.text.length <= max) {
      expanded.push(paragraph);
      continue;
    }
    const pieces = paragraph.text.split(/(?<=[。！？!?；;])\s*/).filter((piece) => piece.trim().length > 0);
    let buffer = "";
    const flush = (): void => {
      if (buffer.trim().length > 0) expanded.push({ text: buffer.trim(), heading: paragraph.heading });
      buffer = "";
    };
    for (const piece of pieces) {
      if (piece.length > max) {
        flush();
        for (let offset = 0; offset < piece.length; offset += target) {
          expanded.push({ text: piece.slice(offset, offset + target), heading: paragraph.heading });
        }
        continue;
      }
      if (buffer.length + piece.length > target) flush();
      buffer += piece;
    }
    flush();
  }

  const chunks: TextChunk[] = [];
  let buffer = "";
  let bufferHeading = expanded[0]?.heading ?? "";
  let forceHeading = "";
  const pushChunk = (): void => {
    const text = buffer.trim();
    if (text.length === 0) return;
    chunks.push({
      id: input.filename + "#" + String(chunks.length + 1),
      filename: input.filename,
      fileIndex: 0,
      fileTotal: 0,
      heading: forceHeading || bufferHeading,
      text,
      charCount: text.length
    });
    buffer = "";
  };

  for (const paragraph of expanded) {
    if (buffer.length === 0) {
      bufferHeading = paragraph.heading;
      forceHeading = paragraph.heading;
    } else if (paragraph.heading.length > 0 && paragraph.heading !== bufferHeading) {
      forceHeading = paragraph.heading;
    }
    if (buffer.length > 0 && buffer.length + paragraph.text.length + 2 > target) pushChunk();
    if (buffer.length > 0) buffer += "\n\n";
    buffer += paragraph.text;
    if (buffer.length >= target) pushChunk();
  }
  pushChunk();

  return chunks.map((chunk, index) => ({
    ...chunk,
    fileIndex: index + 1,
    fileTotal: chunks.length
  }));
}

function mergeSectionFragments(fragments: readonly string[]): string {
  const paragraphs: string[] = [];
  const seen = new Set<string>();
  for (const fragment of fragments) {
    for (const raw of fragment.split(/\n{2,}/)) {
      const text = raw.trim();
      if (text.length === 0) continue;
      const key = normalizeName(text);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      paragraphs.push(text);
    }
  }
  return paragraphs.join("\n\n");
}

function mergeObjects(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const current = output[key];
    if (value === null || value === undefined || value === "") continue;
    if (current === null || current === undefined || current === "") {
      output[key] = value;
      continue;
    }
    if (typeof current === "string" && typeof value === "string") {
      if (value.length > current.length) output[key] = value;
      continue;
    }
    if (Array.isArray(current) && Array.isArray(value)) {
      const seen = new Set(current.map((item) => normalizeName(JSON.stringify(item))));
      output[key] = [...current, ...value.filter((item) => seen.has(normalizeName(JSON.stringify(item))) === false)];
      continue;
    }
    if (isPlainObject(current) && isPlainObject(value)) {
      output[key] = mergeObjects(current, value);
      continue;
    }
    if (current === 0 && typeof value === "number") output[key] = value;
  }
  return output;
}

interface KindMergeState {
  readonly kind: StructuredKind;
  readonly entries: Record<string, unknown>[];
  readonly idIndex: Map<string, number>;
  readonly nameIndex: Map<string, number>;
  readonly idAlias: Map<string, string>;
}

function createKindState(kind: StructuredKind): KindMergeState {
  return { kind, entries: [], idIndex: new Map(), nameIndex: new Map(), idAlias: new Map() };
}

function mergeKindEntries(
  state: KindMergeState,
  partial: Record<string, unknown>[]
): void {
  for (const raw of partial) {
    const name = entryName(state.kind, raw) || cleanText(raw.id) || "未命名";
    const originalId = cleanText(raw.id) || fallbackId(state.kind, name);
    const normalizedName = normalizeName(name);
    let index = state.idIndex.get(originalId);
    if (index === undefined && normalizedName.length > 0) index = state.nameIndex.get(normalizedName);
    if (index === undefined) {
      let finalId = originalId;
      let suffix = 2;
      while (state.idIndex.has(finalId)) {
        finalId = originalId + "-" + String(suffix);
        suffix += 1;
      }
      index = state.entries.length;
      state.entries.push({ ...raw, id: finalId });
      state.idIndex.set(finalId, index);
      if (normalizedName.length > 0) state.nameIndex.set(normalizedName, index);
      if (originalId !== finalId) state.idAlias.set(originalId, finalId);
      continue;
    }
    const existingIdBefore = cleanText(state.entries[index]?.id);
    state.entries[index] = mergeObjects(state.entries[index] ?? {}, raw);
    const existingIdAfter = cleanText(state.entries[index]?.id);
    if (existingIdBefore.length > 0 && originalId !== existingIdBefore) {
      state.idAlias.set(originalId, existingIdBefore);
    } else if (existingIdAfter.length > 0 && originalId !== existingIdAfter) {
      state.idAlias.set(originalId, existingIdAfter);
    }
  }
}

function remapReference(
  value: unknown,
  aliases: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, number>,
  output: readonly Record<string, unknown>[]
): string | undefined {
  const id = cleanText(value);
  if (id.length === 0) return undefined;
  const aliased = aliases.get(id);
  if (aliased !== undefined) return aliased;
  const index = names.get(normalizeName(id));
  if (index !== undefined) return cleanText(output[index]?.id) || undefined;
  return id;
}

export interface MergeDraftInput {
  readonly title: string;
  readonly system: "COC7" | "TOUHOU";
  readonly era: string;
  readonly author: string;
  readonly extractions: readonly ChunkExtraction[];
  readonly images: readonly ImageExtraction[];
  readonly validImagePaths: ReadonlySet<string>;
}

/** 把分块提取结果与图片分析结果合并成一份完整 draft。 */
export function mergeDraft(input: MergeDraftInput): AiDraft {
  const extractions: ChunkExtraction[] = [...input.extractions];

  for (const image of input.images) {
    const section = REQUIRED_MODULE_SECTIONS.includes(image.section as (typeof REQUIRED_MODULE_SECTIONS)[number])
      ? image.section
      : "附录";
    const sectionParts = [image.sectionText.trim()];
    if (image.transcription.trim().length > 0 && image.sectionText.includes(image.transcription.trim()) === false) {
      sectionParts.push(image.transcription.trim());
    }
    if (image.description.trim().length > 0 && image.sectionText.includes(image.description.trim()) === false) {
      sectionParts.push(image.description.trim());
    }
    const structured: Record<string, Record<string, unknown>[]> = {};
    const kind = image.kind.toUpperCase();
    if ((kind === "MAP" || kind === "SCENE") && image.scene !== null) {
      structured.scenes = [{ ...image.scene, id: cleanText(image.scene.id) || fallbackId("scene", cleanText(image.scene.name) || image.filename), background: image.relativePath }];
    } else if ((kind === "HANDOUT" || kind === "CLUE") && image.clue !== null) {
      structured.clues = [{
        ...image.clue,
        id: cleanText(image.clue.id) || fallbackId("clue", cleanText(image.clue.title) || image.filename),
        content: [cleanText(image.clue.content), image.transcription.trim()].filter((item) => item.length > 0).join("\n\n"),
        image: image.relativePath,
        isPublic: image.clue.isPublic === true
      }];
    } else if (kind === "NPC" && image.npc !== null) {
      structured.npcs = [{
        ...image.npc,
        id: cleanText(image.npc.id) || fallbackId("npc", cleanText(image.npc.name) || image.filename),
        portrait: image.relativePath
      }];
    } else if (kind === "ITEM" && image.item !== null) {
      structured.items = [{
        ...image.item,
        id: cleanText(image.item.id) || fallbackId("item", cleanText(image.item.name) || image.filename),
        image: image.relativePath
      }];
    }
    if (image.relativePath.length > 0) {
      sectionParts.push("![" + image.filename + "](" + image.relativePath + ")");
    }
    extractions.push({
      label: "图片 " + image.filename,
      meta: {},
      sections: { [section]: sectionParts.filter((item) => item.length > 0).join("\n\n") },
      structured,
      fallbackText: image.transcription.trim().length > 0 ? undefined : image.description.trim()
    });
  }

  const metaTitle: string[] = [];
  const metaSummary: string[] = [];
  const metaBackground: string[] = [];
  const metaOccupation: string[] = [];
  const sectionFragments = new Map<string, string[]>();
  const fallbacks: string[] = [];
  const kindStates = new Map<StructuredKind, KindMergeState>();
  for (const kind of STRUCTURED_KINDS) kindStates.set(kind, createKindState(kind));

  for (const extraction of extractions) {
    const meta = extraction.meta;
    const title = cleanText(meta.title);
    if (title.length > 0) metaTitle.push(title);
    const summary = cleanText(meta.summary);
    if (summary.length > 0) metaSummary.push(summary);
    const background = cleanText(meta.background);
    if (background.length > 0) metaBackground.push(background);
    const occupation = cleanText(meta.occupationRecommendation);
    if (occupation.length > 0) metaOccupation.push(occupation);
    for (const [section, value] of Object.entries(extraction.sections)) {
      const text = cleanText(value);
      if (text.length === 0) continue;
      const list = sectionFragments.get(section) ?? [];
      list.push(text);
      sectionFragments.set(section, list);
    }
    for (const [rawKind, rawEntries] of Object.entries(extraction.structured)) {
      const plural = rawKind === "spells" ? "magic" : rawKind;
      const kind = STRUCTURED_KINDS.find((item) => STRUCTURED_PLURALS[item] === plural || item === plural || STRUCTURED_PLURALS[item] === plural.replace(/s$/, ""));
      if (kind === undefined) continue;
      const entries = asEntryArray(rawEntries);
      if (entries.length === 0) continue;
      mergeKindEntries(kindStates.get(kind) as KindMergeState, entries);
    }
    if (extraction.fallbackText !== undefined && extraction.fallbackText.trim().length > 0) {
      fallbacks.push(extraction.fallbackText.trim());
    }
  }
  if (fallbacks.length > 0) {
    const list = sectionFragments.get("附录") ?? [];
    list.push(...fallbacks.map((text, index) => "#### 原文片段 " + String(index + 1) + "\n" + text));
    sectionFragments.set("附录", list);
  }

  const chapters = kindStates.get("chapter");
  const scenes = kindStates.get("scene");
  const encounters = kindStates.get("encounter");
  const npcs = kindStates.get("npc");
  const items = kindStates.get("item");
  const clues = kindStates.get("clue");
  const endings = kindStates.get("ending");
  const rewards = kindStates.get("reward");
  const magic = kindStates.get("magic");

  // 重映射引用：sceneId / chapterId / linkedItemId。
  if (scenes !== undefined && encounters !== undefined) {
    for (const encounter of encounters.entries) {
      const sceneId = remapReference(encounter.sceneId, scenes.idAlias, scenes.nameIndex, scenes.entries);
      if (sceneId !== undefined) encounter.sceneId = sceneId;
      const chapterId = remapReference(encounter.chapterId, chapters?.idAlias ?? new Map(), chapters?.nameIndex ?? new Map(), chapters?.entries ?? []);
      if (chapterId !== undefined) encounter.chapterId = chapterId;
    }
  }
  if (clues !== undefined && items !== undefined) {
    for (const clue of clues.entries) {
      const linked = remapReference(clue.linkedItemId, items.idAlias, items.nameIndex, items.entries);
      if (linked !== undefined) clue.linkedItemId = linked;
    }
  }

  const sections: Record<string, string> = {};
  for (const section of REQUIRED_MODULE_SECTIONS) {
    sections[section] = mergeSectionFragments(sectionFragments.get(section) ?? []);
  }
  // 没有归入任何章节的原文片段至少进入附录；避免素材被静默丢弃。
  if ((sections["附录"] ?? "").length === 0 && fallbacks.length > 0) {
    sections["附录"] = mergeSectionFragments(fallbacks);
  }
  if ((sections["真相与背景"] ?? "").length === 0 && metaBackground.length > 0) {
    sections["真相与背景"] = mergeSectionFragments(metaBackground);
  }

  const structured: Record<string, Record<string, unknown>[]> = {};
  for (const kind of STRUCTURED_KINDS) {
    const state = kindStates.get(kind);
    if (state === undefined) continue;
    if (state.entries.length > 0) structured[kind] = state.entries;
  }
  // 清掉模型编造的图片路径：只允许 prepareSources 真正保存过的 relativePath。
  for (const entries of Object.values(structured)) {
    for (const entry of entries) {
      for (const field of ["background", "portrait", "image"]) {
        const value = entry[field];
        if (typeof value === "string" && value.startsWith("assets/") && input.validImagePaths.has(value) === false) {
          entry[field] = "";
        }
      }
    }
  }

  const pickFirst = (values: readonly string[], fallback: string): string => values[0] ?? fallback;
  const pickLongest = (values: readonly string[], fallback: string): string => {
    if (values.length === 0) return fallback;
    return [...values].sort((a, b) => b.length - a.length)[0] ?? fallback;
  };
  const title = pickFirst(metaTitle, input.title) || input.title;
  const summary = pickLongest(metaSummary, title + "（DeepSeek 根据素材整理）").slice(0, 1200);
  const background = (pickLongest(metaBackground, "") || (sections["真相与背景"] ?? "")).slice(0, 4000);
  const occupationRecommendation = pickLongest(metaOccupation, "").slice(0, 4000);

  return {
    frontMatter: {
      spec: "touhou-module/v1",
      id: moduleIdFromTitle(title),
      title,
      system: input.system,
      era: input.era,
      author: input.author,
      version: "1.0.0",
      summary,
      background,
      occupationRecommendation
    },
    sections,
    structured
  };
}
