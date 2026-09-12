import { deepMerge, MagicEffectSchema, type MagicEffect, type MagicSpell } from "@touhou/rules";
import { compile, parseDice } from "@touhou/formula";
import { prisma } from "@/server/db/prisma";
import { loadEffectivePack } from "@/server/rules/loader";
import { structuredOfContent, type StructuredModuleEntry } from "@/server/modules/structure";

export interface ModuleMagicInfo {
  readonly system: "COC7" | "TOUHOU";
  readonly spells: readonly MagicSpell[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function textOf(data: Record<string, unknown>, keys: readonly string[], fallback: string): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim().slice(0, 300);
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function safeExpression(value: unknown, fallback: string): string {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (text.length === 0) return fallback;
  try {
    compile(text);
    return text;
  } catch {
    return fallback;
  }
}

function safeDice(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0) return undefined;
  try {
    parseDice(text);
    return text;
  } catch {
    return undefined;
  }
}

function spellFromEntry(entry: StructuredModuleEntry, system: "COC7" | "TOUHOU"): MagicSpell | null {
  const data = entry.data;
  const name = textOf(data, ["name", "title"], entry.title);
  if (name.length === 0) return null;
  const id = textOf(data, ["id", "spellId"], entry.id).replace(/[^a-zA-Z0-9._:-]+/g, "-").slice(0, 60) || "spell-" + entry.id;
  const skillDefault = system === "COC7" ? "OCCULT" : "MAGIC";
  const targetRaw = textOf(data, ["target", "range"], "ONE").toUpperCase();
  const target = targetRaw === "SELF" || targetRaw === "ALL" ? targetRaw : "ONE";
  const targetingRaw = textOf(data, ["targeting", "targetSide", "side"], "").toUpperCase();
  const targeting =
    targetingRaw === "SELF" || targetingRaw === "ALLY" || targetingRaw === "ENEMY" || targetingRaw === "ANY"
      ? targetingRaw
      : undefined;
  const damage = safeDice(data.damage ?? data.damageExpr);
  const effects: MagicEffect[] = [];
  if (Array.isArray(data.effects)) {
    for (const raw of data.effects) {
      const parsed = MagicEffectSchema.safeParse(raw);
      if (parsed.success) effects.push(parsed.data);
    }
  }
  return {
    id,
    name,
    skill: textOf(data, ["skill", "skillId", "check"], skillDefault).slice(0, 60),
    description: textOf(data, ["description", "effect", "summary"], "") || undefined,
    mpCost: safeExpression(data.mpCost ?? data.cost, "0"),
    sanCost: safeDice(data.sanCost ?? data.sanityCost) ?? "0",
    damage,
    target,
    targeting,
    effects
  };
}

export function magicInfoFromStructured(entries: readonly StructuredModuleEntry[], system: string | null): ModuleMagicInfo {
  const resolvedSystem: "COC7" | "TOUHOU" = system === "TOUHOU" ? "TOUHOU" : "COC7";
  const spells: MagicSpell[] = [];
  for (const entry of entries) {
    const spell = spellFromEntry(entry, resolvedSystem);
    if (spell !== null) spells.push(spell);
  }
  return { system: resolvedSystem, spells };
}

export async function loadModuleMagicInfo(moduleId: string): Promise<ModuleMagicInfo | null> {
  const moduleRecord = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { system: true, content: true }
  });
  if (moduleRecord === null) return null;
  const structured = structuredOfContent(moduleRecord.content);
  if (structured.magic.length === 0) return null;
  return magicInfoFromStructured(structured.magic, moduleRecord.system);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export async function applyMagicRulesToRoom(roomId: string, moduleIdOverride: string | null = null): Promise<number> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, system: true, magicEnabled: true, selectedModuleId: true, ruleOverride: true }
  });
  if (room === null || room.magicEnabled === false) return 0;

  let moduleId = moduleIdOverride ?? room.selectedModuleId;
  if (moduleId === null) {
    const game = await prisma.game.findFirst({
      where: { roomId, moduleId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { moduleId: true }
    });
    moduleId = game?.moduleId ?? null;
  }
  if (moduleId === null) return 0;

  const info = await loadModuleMagicInfo(moduleId);
  if (info === null || info.spells.length === 0) {
    await disableMagicRulesInRoom(room.id);
    return 0;
  }

  const existing = isPlainObject(room.ruleOverride) ? room.ruleOverride : {};
  const overlay = {
    magic: {
      enabled: true,
      system: info.system,
      spells: info.spells
    }
  };
  const merged = deepMerge(existing, overlay as unknown);
  await prisma.room.update({
    where: { id: room.id },
    data: { ruleOverride: merged as never }
  });
  return info.spells.length;
}

export function magicSpellCountOf(ruleOverride: unknown): number {
  if (isPlainObject(ruleOverride) === false) return 0;
  const magic = asRecord(ruleOverride.magic);
  if (magic.enabled !== true) return 0;
  return Array.isArray(magic.spells) ? magic.spells.length : 0;
}

export async function disableMagicRulesInRoom(roomId: string): Promise<void> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, ruleOverride: true }
  });
  if (room === null || isPlainObject(room.ruleOverride) === false) return;
  const magic = asRecord((room.ruleOverride as Record<string, unknown>).magic);
  const merged = { ...(room.ruleOverride as Record<string, unknown>), magic: { ...magic, enabled: false } };
  await prisma.room.update({ where: { id: room.id }, data: { ruleOverride: merged as never } });
}

export interface RoomMagicDiagnostics {
  readonly room: {
    readonly id: string;
    readonly name: string;
    readonly system: "COC7" | "TOUHOU";
    readonly status: string;
    readonly magicEnabled: boolean;
    readonly selectedModuleId: string | null;
    readonly selectedModuleTitle: string | null;
    readonly rulePackVersionId: string | null;
    readonly rulePackName: string | null;
    readonly rulePackVersion: string | null;
  };
  readonly moduleMagic: {
    readonly moduleId: string | null;
    readonly title: string | null;
    readonly loaded: boolean;
    readonly spellCount: number;
    readonly spells: readonly MagicSpell[];
  };
  readonly roomOverrideMagic: {
    readonly enabled: boolean;
    readonly spellCount: number;
  };
  readonly effectiveMagic: {
    readonly enabled: boolean;
    readonly spellCount: number;
    readonly spells: readonly MagicSpell[];
    readonly source: "builtin" | "database" | "unknown";
    readonly hasRoomOverride: boolean;
    readonly error: string | null;
  };
  readonly issues: readonly string[];
  readonly warnings: readonly string[];
}

function magicStateOf(ruleOverride: unknown): { enabled: boolean; spellCount: number } {
  if (isPlainObject(ruleOverride) === false) return { enabled: false, spellCount: 0 };
  const magic = asRecord(ruleOverride.magic);
  const enabled = magic.enabled === true;
  const spells = Array.isArray(magic.spells) ? magic.spells.length : 0;
  return { enabled, spellCount: spells };
}

/**
 * 房间魔法自检：把「房间开关 / 团本魔法 / Room.ruleOverride / 最终生效规则包」拆开看，
 * 用于在管理后台快速定位“魔法为什么不生效”。
 */
export async function loadRoomMagicDiagnostics(roomId: string): Promise<RoomMagicDiagnostics | null> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      selectedModule: { select: { id: true, title: true } },
      rulePack: { select: { id: true, version: true, pack: { select: { name: true } } } }
    }
  });
  if (room === null) return null;

  const activeGame = await prisma.game.findFirst({
    where: { roomId, moduleId: { not: null }, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { moduleId: true, module: { select: { id: true, title: true } } }
  });
  const moduleId = room.selectedModuleId ?? activeGame?.moduleId ?? null;
  const moduleTitle = room.selectedModule?.title ?? activeGame?.module?.title ?? null;
  const moduleInfo = moduleId === null ? null : await loadModuleMagicInfo(moduleId);
  const moduleMagic = {
    moduleId,
    title: moduleTitle,
    loaded: moduleInfo !== null,
    spellCount: moduleInfo?.spells.length ?? 0,
    spells: moduleInfo?.spells ?? []
  };
  const roomOverrideMagic = magicStateOf(room.ruleOverride);

  let effectiveMagic: RoomMagicDiagnostics["effectiveMagic"] = {
    enabled: false,
    spellCount: 0,
    spells: [],
    source: "unknown",
    hasRoomOverride: false,
    error: null
  };
  try {
    const effective = await loadEffectivePack({
      id: room.id,
      system: room.system,
      rulePackVersionId: room.rulePackVersionId,
      ruleOverride: room.ruleOverride
    });
    const magic = effective.compiled.pack.magic;
    effectiveMagic = {
      enabled: magic?.enabled === true,
      spellCount: magic?.spells.length ?? 0,
      spells: magic?.spells ?? [],
      source: effective.source,
      hasRoomOverride: effective.hasRoomOverride,
      error: null
    };
  } catch (error) {
    effectiveMagic = {
      ...effectiveMagic,
      error: error instanceof Error ? error.message : "生效规则包编译失败"
    };
  }

  const issues: string[] = [];
  const warnings: string[] = [];
  if (room.magicEnabled === false) {
    issues.push("房间开关 Room.magicEnabled = false。需要在准备页点击「启用魔法规则」，管理员页也可以直接开启。");
  }
  if (moduleId === null) {
    issues.push("房间没有选择团本，也没有进行中的局，无法从团本结构化数据同步魔法。");
  } else if (moduleMagic.loaded === false || moduleMagic.spellCount === 0) {
    issues.push("所选团本没有可解析的结构化魔法（需要 module structured.magic，通常来自 DeepSeek 导入的团本）。");
  }
  if (roomOverrideMagic.enabled === false && roomOverrideMagic.spellCount > 0) {
    warnings.push("Room.ruleOverride.magic.spells 有数据但 enabled=false，团本魔法被显式关闭。");
  }
  if (effectiveMagic.error !== null) {
    issues.push("最终规则包加载失败：" + effectiveMagic.error);
  } else {
    if (effectiveMagic.enabled === false) {
      issues.push("最终生效规则包 magic.enabled = false，战斗里不会显示「施法」区域。");
    }
    if (effectiveMagic.spellCount === 0) {
      issues.push("最终生效规则包没有任何法术。");
    }
  }
  if (issues.length === 0) {
    warnings.push("魔法已生效：战斗页的施法面板应显示 " + effectiveMagic.spellCount + " 个法术。");
  }

  return {
    room: {
      id: room.id,
      name: room.name,
      system: room.system === "TOUHOU" ? "TOUHOU" : "COC7",
      status: room.status,
      magicEnabled: room.magicEnabled,
      selectedModuleId: room.selectedModuleId,
      selectedModuleTitle: room.selectedModule?.title ?? null,
      rulePackVersionId: room.rulePackVersionId,
      rulePackName: room.rulePack?.pack.name ?? null,
      rulePackVersion: room.rulePack?.version ?? null
    },
    moduleMagic,
    roomOverrideMagic,
    effectiveMagic,
    issues,
    warnings
  };
}
