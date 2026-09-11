import { ATTRIBUTE_KEYS } from "@touhou/rules";
import type { CharacterAdvancement, Prisma } from "@prisma/client";
import type { AdvancementKind, AdvancementSource } from "@/shared/game";

export const ADVANCEMENT_SOURCE_LABELS: Record<AdvancementSource, string> = {
  MANUAL: "手动记录",
  END_REWARD: "结束奖励",
  GROWTH_CHECK: "成长检定",
  MODULE: "团本奖励",
  IMPORT: "导入",
  OTHER: "其他"
};

export interface AdvancementWriteOptions {
  readonly source?: AdvancementSource;
  readonly createdBy?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly note?: string | null;
}

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

export async function applyAdvancementEffect(
  tx: Prisma.TransactionClient,
  characterId: string,
  character: AdvancementCharacter,
  input: Pick<ValidatedAdvancement, "kind" | "target" | "delta">
): Promise<void> {
  const { kind, target, delta } = input;

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
}

export async function applyAdvancement(
  tx: Prisma.TransactionClient,
  gameId: string | null,
  characterId: string,
  character: AdvancementCharacter,
  input: ValidatedAdvancement,
  options: AdvancementWriteOptions = {}
): Promise<CharacterAdvancement> {
  const note = options.note === undefined ? input.note : options.note;

  await applyAdvancementEffect(tx, characterId, character, input);

  return tx.characterAdvancement.create({
    data: {
      characterId,
      gameId,
      kind: input.kind,
      target: input.target,
      delta: input.delta,
      note,
      source: options.source ?? "MANUAL",
      createdBy: options.createdBy ?? null,
      metadata: (options.metadata ?? {}) as never
    }
  });
}

/**
 * 反向应用一条成长记录的数值效果（不含记录本身的删除 / 标记）。
 * 用于编辑、撤销，以及成长检定的回退。
 */
export async function reverseAdvancementEffect(
  tx: Prisma.TransactionClient,
  characterId: string,
  character: AdvancementCharacter,
  row: Pick<CharacterAdvancement, "kind" | "target" | "delta">
): Promise<void> {
  const delta = row.delta;
  if (delta === null) return;

  if (row.kind === "ATTRIBUTE" && row.target !== null) {
    const current = Number(character[row.target] ?? 0);
    const next = Math.max(0, Math.min(999, current - delta));
    await tx.character.update({
      where: { id: characterId },
      data: { [row.target]: next } as never
    });
    return;
  }

  if (row.kind === "SKILL" && row.target !== null) {
    const skills = (character.skills ?? {}) as Record<string, number>;
    const current = Number(skills[row.target] ?? 0);
    const next = Math.max(0, Math.min(999, current - delta));
    await tx.character.update({
      where: { id: characterId },
      data: { skills: { ...skills, [row.target]: next } as never }
    });
    return;
  }

  if (row.kind === "SAN") {
    const maxSan = Number(character.maxSan ?? 0);
    const san = Number(character.san ?? 0);
    const nextMax = Math.max(0, maxSan - delta);
    const nextCurrent = Math.max(0, Math.min(nextMax, san - delta));
    await tx.character.update({
      where: { id: characterId },
      data: { maxSan: nextMax, san: nextCurrent }
    });
  }
}

export interface AdvancementSummary {
  readonly attribute: Record<string, number>;
  readonly skill: Record<string, number>;
  readonly san: number;
  readonly counts: Record<AdvancementKind, number>;
  readonly total: number;
}

export interface SummarizableAdvancement {
  readonly kind: string;
  readonly target: string | null;
  readonly delta: number | null;
  readonly revertedAt?: string | Date | null;
}

export function summarizeAdvancements(rows: readonly SummarizableAdvancement[]): AdvancementSummary {
  const attribute: Record<string, number> = {};
  const skill: Record<string, number> = {};
  const counts: Record<AdvancementKind, number> = {
    ATTRIBUTE: 0,
    SKILL: 0,
    SAN: 0,
    ITEM: 0,
    RELATIONSHIP: 0,
    OTHER: 0
  };
  let san = 0;

  for (const row of rows) {
    if (row.revertedAt !== null && row.revertedAt !== undefined) continue;
    if (isAdvancementKind(row.kind)) counts[row.kind] += 1;
    if (row.delta === null) continue;
    if (row.kind === "ATTRIBUTE" && row.target !== null) {
      attribute[row.target] = (attribute[row.target] ?? 0) + row.delta;
    } else if (row.kind === "SKILL" && row.target !== null) {
      skill[row.target] = (skill[row.target] ?? 0) + row.delta;
    } else if (row.kind === "SAN") {
      san += row.delta;
    }
  }

  let total = 0;
  for (const row of rows) {
    if (row.revertedAt !== null && row.revertedAt !== undefined) continue;
    total += 1;
  }

  return { attribute, skill, san, counts, total };
}
