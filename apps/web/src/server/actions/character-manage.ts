"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ATTRIBUTE_KEYS, MagicEffectSchema, type AttributeKey, type Coc7AgeAllocation } from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { updateCharacterAction, type SaveCharacterResult } from "@/server/actions/character";
import {
  CARD_TARGETINGS,
  CARD_TARGET_SCOPES,
  CARD_USABLE_IN,
  ItemStatsSchema,
  SpellCardStatsSchema,
  WeaponStatsSchema,
  weaponTypeDefinition
} from "@/shared/card";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullableStr(formData: FormData, key: string): string | null {
  const value = str(formData, key);
  return value.length === 0 ? null : value;
}

function int(formData: FormData, key: string): number {
  const raw = str(formData, key);
  if (raw.length === 0) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

function optionalInt(formData: FormData, key: string): number | undefined {
  const raw = str(formData, key);
  if (raw.length === 0) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : undefined;
}

function safeReturnTo(raw: string, fallback: string): string {
  if (raw.startsWith("/") && raw.startsWith("//") === false) return raw;
  return fallback;
}

function withParam(path: string, key: string, value: string): string {
  return path + (path.includes("?") ? "&" : "?") + key + "=" + encodeURIComponent(value);
}

/** 角色管理页：一次提交基础信息 + 属性 + 年龄补正 + 技能点 + 资源 + 背景故事。 */
export async function updateCharacterFormAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const characterId = str(formData, "characterId");
  if (characterId.length === 0) redirect("/characters");
  const roomId = nullableStr(formData, "roomId");
  const returnTo = safeReturnTo(str(formData, "returnTo"), "/characters/" + characterId);

  const attributes: Record<string, number> = {};
  for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
    attributes[key] = int(formData, "attr_" + key);
  }

  const ageAllocationRaw: Partial<Record<"str" | "con" | "siz" | "dex", number>> = {};
  for (const key of ["str", "con", "siz", "dex"] as const) {
    const value = int(formData, "age_" + key);
    if (value > 0) ageAllocationRaw[key] = value;
  }

  const occupation: Record<string, number> = {};
  const interest: Record<string, number> = {};
  const slotAssignments: Record<string, string[]> = {};
  for (const [key, raw] of formData.entries()) {
    if (typeof raw !== "string") continue;
    if (key.startsWith("occ_")) {
      const skillId = key.slice(4);
      const value = Math.floor(Number(raw));
      if (Number.isFinite(value) && value > 0) occupation[skillId] = value;
      continue;
    }
    if (key.startsWith("int_")) {
      const skillId = key.slice(4);
      const value = Math.floor(Number(raw));
      if (Number.isFinite(value) && value > 0) interest[skillId] = value;
      continue;
    }
    if (key.startsWith("slot_")) {
      const rest = key.slice(5);
      const separator = rest.lastIndexOf("_");
      if (separator <= 0) continue;
      const slotId = rest.slice(0, separator);
      const skillId = raw.trim();
      if (skillId.length === 0) continue;
      const list = slotAssignments[slotId] ?? [];
      list.push(skillId);
      slotAssignments[slotId] = list;
    }
  }

  const backstory = {
    appearance: nullableStr(formData, "bs_appearance"),
    beliefs: nullableStr(formData, "bs_beliefs"),
    significantPeople: nullableStr(formData, "bs_significantPeople"),
    meaningfulPlaces: nullableStr(formData, "bs_meaningfulPlaces"),
    treasuredPossessions: nullableStr(formData, "bs_treasuredPossessions"),
    traits: nullableStr(formData, "bs_traits"),
    secrets: nullableStr(formData, "bs_secrets"),
    scars: nullableStr(formData, "bs_scars"),
    phobias: nullableStr(formData, "bs_phobias"),
    experiences: parseJsonArray(str(formData, "bs_experiences")),
    mythosExperiences: parseJsonArray(str(formData, "bs_mythosExperiences")),
    companions: parseJsonArray(str(formData, "bs_companions")),
    spellDetails: parseJsonArray(str(formData, "bs_spellDetails")),
    spells: parseJsonArray(str(formData, "bs_spells")).filter((item): item is string => typeof item === "string")
  };

  const result: SaveCharacterResult = await updateCharacterAction({
    characterId,
    roomId,
    system: str(formData, "system") === "TOUHOU" ? "TOUHOU" : "COC7",
    name: str(formData, "name"),
    race: nullableStr(formData, "race"),
    attributes,
    skills: {},
    chargenMethod: str(formData, "chargenMethod") || "manual",
    occupationId: nullableStr(formData, "occupationId"),
    skillAllocation: { occupation, interest, slots: slotAssignments },
    slotAssignments,
    era: nullableStr(formData, "era"),
    age: optionalInt(formData, "age") ?? null,
    ageAllocation: Object.keys(ageAllocationRaw).length === 0 ? null : (ageAllocationRaw as Coc7AgeAllocation),
    profile: {
      playerName: nullableStr(formData, "playerName"),
      gender: nullableStr(formData, "gender"),
      residence: nullableStr(formData, "residence")
    },
    resources: {
      hp: optionalInt(formData, "hp"),
      mp: optionalInt(formData, "mp"),
      san: optionalInt(formData, "san"),
      dp: optionalInt(formData, "dp")
    },
    backstory
  });

  if (result.ok === false) {
    redirect(withParam(returnTo, "error", result.error ?? "保存失败"));
  }
  revalidatePath("/characters/" + characterId);
  redirect(withParam(returnTo, "saved", "manage"));
}

function parseJsonArray(raw: string): unknown[] {
  const text = raw.trim();
  if (text.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 角色管理页：直接编辑该角色已装备卡片的「卡本体」。
 * 卡是唯一的，所以这里改的就是全局那一张。
 */
export async function updateCharacterCardFormAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const cardId = str(formData, "cardId");
  const characterId = str(formData, "characterId");
  if (cardId.length === 0 || characterId.length === 0) redirect("/characters");
  const roomId = nullableStr(formData, "roomId");
  const returnTo = safeReturnTo(str(formData, "returnTo"), "/characters/" + characterId + "/manage");

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (card === null) redirect(returnTo);
  const isOwner = card.ownerId === session.user.id;
  if (isOwner === false) {
    if (roomId === null) redirect(returnTo);
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } }
    });
    if (membership === null || membership.role !== "KP") redirect(returnTo);
  }

  const kind = str(formData, "kind");
  const name = str(formData, "name");
  if (name.length === 0) redirect(withParam(returnTo, "error", "卡名不能为空"));

  const effects = parseJsonArray(str(formData, "effectsJson"));
  const parsedEffects = z.array(MagicEffectSchema).safeParse(effects);
  if (parsedEffects.success === false) {
    redirect(withParam(returnTo, "error", "效果 JSON 不合法：" + (parsedEffects.error.issues[0]?.message ?? "")));
  }
  const targeting = (CARD_TARGETINGS as readonly string[]).includes(str(formData, "targeting"))
    ? str(formData, "targeting")
    : "ENEMY";
  const targetScope = (CARD_TARGET_SCOPES as readonly string[]).includes(str(formData, "targetScope"))
    ? str(formData, "targetScope")
    : "ONE";
  const usableIn = CARD_USABLE_IN.filter((item) => formData.get("usableIn_" + item) !== null);
  const selectableEffects = str(formData, "selectableEffects")
    .split(/[,，\s]+/)
    .map((item) => Math.floor(Number(item)))
    .filter((item) => Number.isInteger(item) && item >= 0);
  const cost = {
    mp: int(formData, "costMp"),
    san: nullableStr(formData, "costSan"),
    uses: optionalInt(formData, "costUses") ?? null,
    cooldownRounds: int(formData, "costCooldown")
  };
  const generic = {
    effects: parsedEffects.data,
    targeting,
    targetScope,
    cost,
    usableIn: usableIn.length === 0 ? ["COMBAT"] : usableIn,
    selectableEffects,
    equippedEffects: cardStatsEquippedEffects(card.stats)
  };

  let stats: unknown;
  if (kind === "WEAPON") {
    const weaponType = str(formData, "weaponType") || "BRAWL";
    const definition = weaponTypeDefinition(weaponType);
    stats = {
      ...generic,
      weaponType,
      damage: str(formData, "damage") || definition.damage,
      range: definition.range,
      skillId: definition.skillId,
      accuracyMod: int(formData, "accuracyMod"),
      mpCost: cost.mp
    };
  } else if (kind === "SPELLCARD") {
    stats = {
      ...generic,
      mode: str(formData, "spellMode") === "CONSUMPTION" ? "CONSUMPTION" : "DECLARATION",
      danmaku: str(formData, "danmaku") || name,
      mpCost: cost.mp,
      hpRatio: null,
      durationTicks: null,
      clearTargets: null,
      enhanceType: "DANMAKU",
      enhanceValue: 1
    };
  } else {
    stats = {
      ...generic,
      effect: str(formData, "itemEffect"),
      uses: cost.uses,
      sanCost: cost.san
    };
  }

  const parsed =
    kind === "WEAPON"
      ? WeaponStatsSchema.safeParse(stats)
      : kind === "SPELLCARD"
        ? SpellCardStatsSchema.safeParse(stats)
        : ItemStatsSchema.safeParse(stats);
  if (parsed.success === false) {
    redirect(withParam(returnTo, "error", "装备数据不合法：" + (parsed.error.issues[0]?.message ?? "")));
  }

  await prisma.card.update({
    where: { id: cardId },
    data: {
      type: kind === "WEAPON" || kind === "SPELLCARD" || kind === "ITEM" ? kind : card.type,
      name,
      subtitle: nullableStr(formData, "subtitle"),
      description: nullableStr(formData, "description"),
      stats: parsed.data as never
    }
  });
  revalidatePath(returnTo);
  revalidatePath("/characters/" + characterId);
  redirect(withParam(returnTo, "saved", "card"));
}

function cardStatsEquippedEffects(stats: unknown): number[] | null {
  if (stats === null || typeof stats !== "object" || Array.isArray(stats)) return null;
  const value = (stats as Record<string, unknown>).equippedEffects;
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) === false) return null;
  const list = value.filter((item): item is number => typeof item === "number" && Number.isInteger(item));
  return list.length === 0 ? null : list;
}
