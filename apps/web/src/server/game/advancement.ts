import { ATTRIBUTE_KEYS } from "@touhou/rules";
import type { Prisma } from "@prisma/client";
import type { AdvancementKind } from "@/shared/game";

export const ADVANCEMENT_KINDS: readonly AdvancementKind[] = [
  "ATTRIBUTE",
  "SKILL",
  "SAN",
  "ITEM",
  "RELATIONSHIP",
  "OTHER"
];

export function isAdvancementKind(value: string): value is AdvancementKind {
  return (ADVANCEMENT_KINDS as readonly string[]).includes(value);
}

export interface ValidatedAdvancement {
  readonly kind: AdvancementKind;
  readonly target: string | null;
  readonly delta: number | null;
  readonly note: string | null;
}

export type AdvancementValidation =
  | { readonly ok: true; readonly value: ValidatedAdvancement }
  | { readonly ok: false; readonly error: string };

export function validateAdvancement(
  kindRaw: string,
  targetRaw: string | null,
  deltaRaw: number | null,
  noteRaw: string | null
): AdvancementValidation {
  if (isAdvancementKind(kindRaw) === false) {
    return { ok: false, error: "成长类型不合法" };
  }
  const kind = kindRaw;
  const target = targetRaw;
  const delta = deltaRaw;
  const note = noteRaw;

  if (kind === "ATTRIBUTE") {
    if (target === null || (ATTRIBUTE_KEYS as readonly string[]).includes(target) === false) {
      return { ok: false, error: "属性成长目标不合法" };
    }
    if (delta === null || Number.isInteger(delta) === false || delta === 0) {
      return { ok: false, error: "属性成长值必须是非零整数" };
    }
    return { ok: true, value: { kind, target, delta, note } };
  }

  if (kind === "SKILL") {
    if (target === null || target.length === 0) {
      return { ok: false, error: "技能成长需要填写技能 id" };
    }
    if (delta === null || Number.isInteger(delta) === false || delta === 0) {
      return { ok: false, error: "技能成长值必须是非零整数" };
    }
    return { ok: true, value: { kind, target, delta, note } };
  }

  if (kind === "SAN") {
    if (delta === null || Number.isInteger(delta) === false || delta === 0) {
      return { ok: false, error: "SAN 成长值必须是非零整数" };
    }
    return { ok: true, value: { kind, target: null, delta, note } };
  }

  return {
    ok: true,
    value: {
      kind,
      target: target === null || target.length === 0 ? null : target,
      delta,
      note
    }
  };
}

export interface AdvancementRowInput {
  readonly characterId: string;
  readonly kind: AdvancementKind;
  readonly target: string | null;
  readonly delta: number | null;
  readonly note: string | null;
}

export type AdvancementRowsParse =
  | { readonly ok: true; readonly rows: readonly AdvancementRowInput[] }
  | { readonly ok: false; readonly error: string };

export function parseAdvancementRows(raw: string): AdvancementRowsParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "成长数据不是合法 JSON" };
  }
  if (Array.isArray(parsed) === false) {
    return { ok: false, error: "成长数据必须是数组" };
  }
  if (parsed.length > 50) {
    return { ok: false, error: "单次最多批量记录 50 条成长" };
  }

  const rows: AdvancementRowInput[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "成长记录格式不合法" };
    }
    const record = item as Record<string, unknown>;
    const characterId = typeof record.characterId === "string" ? record.characterId.trim().slice(0, 64) : "";
    if (characterId.length === 0) {
      return { ok: false, error: "成长记录缺少角色" };
    }
    const kind = typeof record.kind === "string" ? record.kind : "";
    const target =
      typeof record.target === "string" && record.target.trim().length > 0
        ? record.target.trim().slice(0, 120)
        : null;
    const delta =
      typeof record.delta === "number" && Number.isFinite(record.delta)
        ? Math.trunc(record.delta)
        : null;
    const note =
      typeof record.note === "string" && record.note.trim().length > 0
        ? record.note.trim().slice(0, 1000)
        : null;

    const validation = validateAdvancement(kind, target, delta, note);
    if (validation.ok === false) {
      return { ok: false, error: validation.error };
    }
    rows.push({ characterId, ...validation.value });
  }
  return { ok: true, rows };
}

export interface AdvancementCharacter {
  readonly skills?: unknown;
  readonly maxSan?: number;
  readonly san?: number;
  readonly [key: string]: unknown;
}

export async function applyAdvancement(
  tx: Prisma.TransactionClient,
  gameId: string,
  characterId: string,
  character: AdvancementCharacter,
  input: ValidatedAdvancement
): Promise<void> {
  const { kind, target, delta, note } = input;

  if (kind === "ATTRIBUTE" && target !== null && delta !== null) {
    const current = Number(character[target] ?? 0);
    const next = Math.max(0, Math.min(999, current + delta));
    await tx.character.update({
      where: { id: characterId },
      data: { [target]: next } as never
    });
  } else if (kind === "SKILL" && target !== null && delta !== null) {
    const skills = (character.skills ?? {}) as Record<string, number>;
    const current = Number(skills[target] ?? 0);
    const next = Math.max(0, Math.min(999, current + delta));
    await tx.character.update({
      where: { id: characterId },
      data: { skills: { ...skills, [target]: next } as never }
    });
  } else if (kind === "SAN" && delta !== null) {
    const maxSan = Number(character.maxSan ?? 0);
    const san = Number(character.san ?? 0);
    const nextMax = Math.max(0, maxSan + delta);
    const nextCurrent = Math.max(0, Math.min(nextMax, san + delta));
    await tx.character.update({
      where: { id: characterId },
      data: { maxSan: nextMax, san: nextCurrent }
    });
  }

  await tx.characterAdvancement.create({
    data: { characterId, gameId, kind, target, delta, note }
  });
}
