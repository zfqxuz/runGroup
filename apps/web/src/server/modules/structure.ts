import { parse as parseYaml } from "yaml";

export interface StructuredModuleEntry {
  readonly kind: string;
  readonly id: string;
  readonly title: string;
  readonly data: Record<string, unknown>;
}

export interface StructuredModuleData {
  readonly chapters: readonly StructuredModuleEntry[];
  readonly scenes: readonly StructuredModuleEntry[];
  readonly encounters: readonly StructuredModuleEntry[];
  readonly npcs: readonly StructuredModuleEntry[];
  readonly clues: readonly StructuredModuleEntry[];
  readonly items: readonly StructuredModuleEntry[];
  readonly endings: readonly StructuredModuleEntry[];
  readonly rewards: readonly StructuredModuleEntry[];
  readonly magic: readonly StructuredModuleEntry[];
}

const BLOCK_PATTERN = /```[ \t]*yaml[ \t]+(module-[a-z0-9-]+)[ \t]*\r?\n([\s\S]*?)```/g;

function emptyData(): StructuredModuleData {
  return {
    chapters: [],
    scenes: [],
    encounters: [],
    npcs: [],
    clues: [],
    items: [],
    endings: [],
    rewards: [],
    magic: []
  };
}

export function emptyStructuredData(): StructuredModuleData {
  return emptyData();
}

function entryOf(kind: string, index: number, data: Record<string, unknown>): StructuredModuleEntry {
  const titleRaw = data.name ?? data.title ?? data.id;
  const title = String(titleRaw ?? kind + "-" + String(index + 1)).trim();
  const idRaw = data.id ?? title;
  const id = String(idRaw ?? kind + "-" + String(index + 1)).trim();
  return {
    kind,
    id: id.length === 0 ? kind + "-" + String(index + 1) : id,
    title: title.length === 0 ? id : title,
    data
  };
}

function normalizeArray(value: unknown, kind: string): StructuredModuleEntry[] {
  if (Array.isArray(value) === false) return [];
  const rows: StructuredModuleEntry[] = [];
  value.forEach((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return;
    const record = item as Record<string, unknown>;
    // content.structured 可能同时存在两种形态：
    // 1. 原始数据：{ title, content, ... }
    // 2. 解析后的 entry：{ id, kind, title, data: { title, content, ... } }
    // 之前统一按原始数据再包一层 data，导致模板内容全部读空，只剩标题。
    const nested = record.data;
    if (nested !== null && typeof nested === "object" && Array.isArray(nested) === false) {
      const data = nested as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...data };
      if (merged.id === undefined && record.id !== undefined) merged.id = record.id;
      if (merged.title === undefined && record.title !== undefined) merged.title = record.title;
      if (merged.name === undefined && record.name !== undefined) merged.name = record.name;
      rows.push(entryOf(kind, index, merged));
      return;
    }
    rows.push(entryOf(kind, index, record));
  });
  return rows;
}

export function parseStructuredBlocks(markdown: string): StructuredModuleData {
  const data = emptyData();
  const chapters: StructuredModuleEntry[] = [];
  const scenes: StructuredModuleEntry[] = [];
  const encounters: StructuredModuleEntry[] = [];
  const npcs: StructuredModuleEntry[] = [];
  const clues: StructuredModuleEntry[] = [];
  const items: StructuredModuleEntry[] = [];
  const endings: StructuredModuleEntry[] = [];
  const rewards: StructuredModuleEntry[] = [];
  const magic: StructuredModuleEntry[] = [];

  for (const match of markdown.matchAll(BLOCK_PATTERN)) {
    const rawKind = match[1] ?? "";
    const kind = rawKind.slice("module-".length);
    const body = match[2] ?? "";
    let parsed: unknown;
    try {
      parsed = parseYaml(body);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    const entry = entryOf(kind, 0, record);
    if (kind === "chapter") chapters.push(entry);
    else if (kind === "scene") scenes.push(entry);
    else if (kind === "encounter") encounters.push(entry);
    else if (kind === "npc") npcs.push(entry);
    else if (kind === "clue") clues.push(entry);
    else if (kind === "item") items.push(entry);
    else if (kind === "ending") endings.push(entry);
    else if (kind === "reward") rewards.push(entry);
    else if (kind === "magic") magic.push(entry);
  }

  return { chapters, scenes, encounters, npcs, clues, items, endings, rewards, magic };
}

export function structuredOfContent(content: unknown): StructuredModuleData {
  if (content === null || typeof content !== "object") return emptyData();
  const record = content as Record<string, unknown>;
  const structured = record.structured;
  if (structured !== null && typeof structured === "object" && Array.isArray(structured) === false) {
    const source = structured as Record<string, unknown>;
    return {
      chapters: normalizeArray(source.chapters, "chapter"),
      scenes: normalizeArray(source.scenes, "scene"),
      encounters: normalizeArray(source.encounters, "encounter"),
      npcs: normalizeArray(source.npcs, "npc"),
      clues: normalizeArray(source.clues, "clue"),
      items: normalizeArray(source.items, "item"),
      endings: normalizeArray(source.endings, "ending"),
      rewards: normalizeArray(source.rewards, "reward"),
      magic: normalizeArray(source.magic, "magic")
    };
  }
  const text = typeof record.text === "string" ? record.text : "";
  return parseStructuredBlocks(text);
}
