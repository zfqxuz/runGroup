import { deepMerge, MagicEffectSchema, type MagicEffect, type MagicSpell } from "@touhou/rules";
import { compile, parseDice } from "@touhou/formula";
import { prisma } from "@/server/db/prisma";
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
