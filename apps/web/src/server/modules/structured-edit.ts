import { stringify as stringifyYaml } from "yaml";
import {
  emptyStructuredData,
  structuredOfContent,
  type StructuredModuleData,
  type StructuredModuleEntry
} from "@/server/modules/structure";

export const STRUCTURED_ENTITY_KINDS = [
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

export type StructuredEntityKind = (typeof STRUCTURED_ENTITY_KINDS)[number];

export const ENTITY_PLURAL: Record<StructuredEntityKind, keyof StructuredModuleData> = {
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

export const ENTITY_LABELS: Record<StructuredEntityKind, string> = {
  chapter: "章节",
  scene: "场景",
  encounter: "遭遇",
  npc: "NPC / 角色",
  clue: "线索",
  item: "物品 / 证物",
  ending: "结局",
  reward: "奖励",
  magic: "法术"
};

const BLOCK_PATTERN = /```[ \t]*yaml[ \t]+module-[a-z0-9-]+[ \t]*\r?\n[\s\S]*?```/g;
const STRUCTURED_HEADING = /\n*###[ \t]*结构化数据[ \t]*\n*/g;

function yamlBlock(kind: string, value: Record<string, unknown>): string {
  const text = stringifyYaml(value).trim();
  return "```yaml module-" + kind + "\n" + text + "\n```";
}

export function serializeStructuredBlocks(structured: StructuredModuleData): string {
  const lines: string[] = [];
  for (const kind of STRUCTURED_ENTITY_KINDS) {
    const plural = ENTITY_PLURAL[kind];
    for (const entry of structured[plural] ?? []) {
      const data: Record<string, unknown> = { id: entry.id, ...entry.data };
      if (data.id === undefined || data.id === null || String(data.id).length === 0) data.id = entry.id;
      lines.push(yamlBlock(kind, data), "");
    }
  }
  return lines.join("\n").trim();
}

export function contentTextOf(content: unknown): string {
  if (content === null || typeof content !== "object" || Array.isArray(content)) return "";
  const text = (content as Record<string, unknown>).text;
  return typeof text === "string" ? text : "";
}

export function replaceStructuredBlocks(text: string, structured: StructuredModuleData): string {
  const withoutBlocks = text.replace(BLOCK_PATTERN, "").replace(STRUCTURED_HEADING, "\n");
  const prose = withoutBlocks.replace(/\n{3,}/g, "\n\n").trimEnd();
  const blocks = serializeStructuredBlocks(structured);
  if (blocks.length === 0) return prose + "\n";
  return prose + "\n\n### 结构化数据\n\n" + blocks + "\n";
}

export interface StructuredEditResult {
  readonly structured: StructuredModuleData;
  readonly text: string;
}

export function upsertStructuredEntity(
  content: unknown,
  kind: StructuredEntityKind,
  entityId: string,
  data: Record<string, unknown>
): StructuredEditResult {
  const structured = structuredOfContent(content) ?? emptyStructuredData();
  const plural = ENTITY_PLURAL[kind];
  const list = [...(structured[plural] ?? [])];
  const index = list.findIndex((entry) => entry.id === entityId || entry.data.sourceKey === entityId || entry.data.id === entityId);
  const title = String(data.title ?? data.name ?? entityId).trim() || entityId;
  const entry: StructuredModuleEntry = {
    kind,
    id: entityId,
    title,
    data: { ...data, id: entityId }
  };
  if (index >= 0) list[index] = entry;
  else list.push(entry);
  const next: StructuredModuleData = { ...structured, [plural]: list };
  return { structured: next, text: replaceStructuredBlocks(contentTextOf(content), next) };
}

export function removeStructuredEntity(
  content: unknown,
  kind: StructuredEntityKind,
  entityId: string
): StructuredEditResult {
  const structured = structuredOfContent(content) ?? emptyStructuredData();
  const plural = ENTITY_PLURAL[kind];
  const list = (structured[plural] ?? []).filter(
    (entry) => entry.id !== entityId && entry.data.sourceKey !== entityId && entry.data.id !== entityId
  );
  const next: StructuredModuleData = { ...structured, [plural]: [...list] };
  return { structured: next, text: replaceStructuredBlocks(contentTextOf(content), next) };
}

export function slugifyEntityId(kind: StructuredEntityKind, label: string): string {
  const base = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 7);
  return (base.length > 0 ? base : kind + "-") + "-" + suffix;
}
