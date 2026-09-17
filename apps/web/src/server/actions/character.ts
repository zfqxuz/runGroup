"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { compile, evaluate } from "@touhou/formula";
import {
  ATTRIBUTE_KEYS,
  applyCoc7AgeAdjustment,
  builtinRegistry,
  checkCoc7AgeAllocation,
  checkPointBuy,
  compileParsedRulePack,
  computeDerived,
  resolveRulePack,
  type AttributeKey,
  type AttributeSet,
  type Coc7AgeAllocation
} from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { validateCharacterDraft } from "@/server/character/draft";
import {
  isSkillCreationWithinCap,
  occupationChoiceLimits,
  occupationSkillAccess,
  profileOccupationalSkillIds,
  skillPointUsageIssue,
  toOccupationView,
  validateOccupationSlotAssignments,
  type OccupationSkillAccess
} from "@/shared/occupation";

export interface SkillAllocationInput {
  readonly occupation: Record<string, number>;
  readonly interest: Record<string, number>;
  /** COC7 Excel 空位分配：slotId -> 选中的技能 id 列表。 */
  readonly slots?: Record<string, readonly string[]>;
}

export interface SaveCharacterInput {
  roomId: string | null;
  name: string;
  race: string | null;
  system: "COC7" | "TOUHOU";
  attributes: Record<string, number>;
  skills: Record<string, number>;
  chargenMethod: string;
  occupationId?: string | null;
  skillAllocation?: SkillAllocationInput | null;
  era?: string | null;
  /** COC7 年龄；TOUHOU 仅作展示，不套用年龄补正。 */
  age?: number | null;
  /** 玩家对 STR/CON/DEX/SIZ 年龄扣减的一次性分配。 */
  ageAllocation?: Coc7AgeAllocation | null;
  /** COC7 Excel 职业空位分配：slotId -> 技能 id 列表。 */
  slotAssignments?: Record<string, readonly string[]> | null;
  /** 角色管理：基础档案的补充字段（车卡路径不用）。 */
  profile?: {
    readonly playerName?: string | null;
    readonly gender?: string | null;
    readonly residence?: string | null;
  } | null;
  /** 角色管理：当前资源（HP/MP/SAN/DP）。 */
  resources?: {
    readonly hp?: number;
    readonly mp?: number;
    readonly san?: number;
    readonly dp?: number;
  } | null;
  /** 角色管理：背景故事 JSON。 */
  backstory?: unknown;
}

export interface SaveCharacterResult {
  ok: boolean;
  error?: string;
  characterId?: string;
}

const packIdFor = (system: string): string =>
  system === "TOUHOU" ? "touhou-ext" : "coc7-baseline";

function readPointMap(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const number = Math.floor(Number(raw));
    if (Number.isFinite(number) === false || number < 0) return null;
    if (number > 0) out[key] = number;
  }
  return out;
}

export async function saveCharacter(
  input: SaveCharacterInput
): Promise<SaveCharacterResult> {
  const session = await auth();
  if (session === null) return { ok: false, error: "未登录" };

  const room =
    input.roomId === null
      ? null
      : await prisma.room.findUnique({ where: { id: input.roomId } });
  if (input.roomId !== null && room === null) return { ok: false, error: "房间不存在" };
  if (room !== null) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: session.user.id } }
    });
    if (membership === null) return { ok: false, error: "你不在这个房间里" };
  }

  const system = (room?.system ?? input.system) === "TOUHOU" ? "TOUHOU" : "COC7";
  const pack = resolveRulePack(packIdFor(system), builtinRegistry());
  const compiled = compileParsedRulePack(pack);
  const era = room?.era ?? (input.era === "CLASSIC" || input.era === "MODERN" ? input.era : null);

  const occupation = input.occupationId
    ? await prisma.occupation.findUnique({ where: { id: input.occupationId } })
    : null;
  if (input.occupationId && occupation === null) return { ok: false, error: "所选职业不存在" };

  const result = validateCharacterDraft(
    {
      system,
      name: input.name,
      race: input.race,
      attributes: input.attributes,
      chargenMethod: input.chargenMethod,
      occupationId: input.occupationId ?? null,
      skillAllocation: input.skillAllocation ?? null,
      slotAssignments: input.slotAssignments ?? null,
      era,
      age: input.age ?? null,
      ageAllocation: input.ageAllocation ?? null,
      enforceAttributeMethod: true,
      applyAgeAdjustment: true
    },
    { pack, compiled, occupation, era, existing: null, canEditSkills: true }
  );
  if (result.ok === false) return { ok: false, error: result.error };

  const character = await prisma.character.create({
    data: {
      userId: session.user.id,
      roomId: null,
      system,
      reviewStatus: "PENDING_REVIEW",
      name: result.name,
      occupation: result.occupation?.name ?? null,
      occupationId: result.occupation?.id ?? null,
      era: result.era,
      age: result.age,
      race: result.race,
      str: result.attributes.str,
      con: result.attributes.con,
      siz: result.attributes.siz,
      dex: result.attributes.dex,
      app: result.attributes.app,
      int: result.attributes.int,
      pow: result.attributes.pow,
      edu: result.attributes.edu,
      luck: result.attributes.luck,
      raceMods: {
        method: input.chargenMethod,
        flags: [...result.raceFlags],
        ...(system === "COC7" && result.age !== null ? { age: result.age, ageAllocation: result.ageAllocation } : {})
      },
      skills: result.skills,
      skillAllocation: result.skillAllocation as never,
      hp: result.derived.maxHp,
      maxHp: result.derived.maxHp,
      mp: result.derived.maxMp,
      maxMp: result.derived.maxMp,
      san: result.san,
      maxSan: result.derived.maxSan,
      dp: result.derived.maxDp,
      maxDp: result.derived.maxDp
    },
    select: { id: true }
  });

  if (room !== null) {
    await prisma.roomCharacterEntry.create({
      data: { roomId: room.id, characterId: character.id, status: "PENDING_REVIEW" }
    });
    revalidatePath("/rooms/" + room.id);
  }
  revalidatePath("/characters");
  return { ok: true, characterId: character.id };
}

/**
 * 角色管理（编辑已有角色）路径。
 *
 * 与 saveCharacter 共用 validateCharacterDraft：属性和技能点走完全相同的 COC7 规则。
 * 本人可编辑全部；KP 只能编辑非技能熟练度部分（技能点沿用旧值，换职业时按规则重置）。
 */
export async function updateCharacterAction(
  input: SaveCharacterInput & { characterId: string }
): Promise<SaveCharacterResult> {
  const session = await auth();
  if (session === null) return { ok: false, error: "未登录" };

  const existing = await prisma.character.findUnique({ where: { id: input.characterId } });
  if (existing === null) return { ok: false, error: "角色不存在" };

  const isOwner = existing.userId === session.user.id;
  let canEditSkills = isOwner;

  if (isOwner === false) {
    if (input.roomId === null) return { ok: false, error: "只能编辑自己的角色" };
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: input.roomId, userId: session.user.id } }
    });
    if (membership === null || membership.role !== "KP") return { ok: false, error: "只能编辑自己的角色" };
    const entry = await prisma.roomCharacterEntry.findUnique({
      where: { roomId_characterId: { roomId: input.roomId, characterId: existing.id } }
    });
    if (entry === null || entry.status !== "APPROVED") return { ok: false, error: "该角色不在这个房间" };
    canEditSkills = false;
  }

  const room =
    input.roomId === null
      ? null
      : await prisma.room.findUnique({ where: { id: input.roomId } });
  if (input.roomId !== null && room === null) return { ok: false, error: "房间不存在" };

  const system = ((room?.system ?? existing.system) === "TOUHOU" ? "TOUHOU" : "COC7");
  const pack = resolveRulePack(packIdFor(system), builtinRegistry());
  const compiled = compileParsedRulePack(pack);
  const era = room?.era ?? existing.era ?? null;

  const occupation = input.occupationId
    ? await prisma.occupation.findUnique({ where: { id: input.occupationId } })
    : null;
  if (input.occupationId && occupation === null) return { ok: false, error: "所选职业不存在" };

  const existingAttributes: AttributeSet = {
    str: existing.str,
    con: existing.con,
    siz: existing.siz,
    dex: existing.dex,
    app: existing.app,
    int: existing.int,
    pow: existing.pow,
    edu: existing.edu,
    luck: existing.luck
  };

  const existingMods = existing.raceMods !== null && typeof existing.raceMods === "object" && Array.isArray(existing.raceMods) === false
    ? (existing.raceMods as Record<string, unknown>)
    : {};
  const existingAgeAdjusted = existingMods.ageAdjusted === false ? false : true;
  const existingMethod = typeof existingMods.method === "string" ? existingMods.method : null;
  const targetAge = input.age ?? existing.age ?? 30;
  const ageChanged = Math.floor(Number(targetAge)) !== Math.floor(Number(existing.age ?? 30));
  const applyAgeAdjustment = system === "COC7" && (existingAgeAdjusted || ageChanged);
  const ageAllocationInput =
    input.ageAllocation ?? (existingMods.ageAllocation as Coc7AgeAllocation | undefined) ?? null;

  const result = validateCharacterDraft(
    {
      system,
      name: input.name,
      race: input.race ?? existing.race,
      attributes: input.attributes,
      chargenMethod: input.chargenMethod.length > 0 ? input.chargenMethod : existingMethod ?? "manual",
      occupationId: input.occupationId ?? null,
      skillAllocation: input.skillAllocation ?? null,
      slotAssignments: input.slotAssignments ?? null,
      era,
      age: targetAge,
      ageAllocation: ageAllocationInput,
      enforceAttributeMethod: false,
      applyAgeAdjustment
    },
    {
      pack,
      compiled,
      occupation,
      era,
      existing: {
        occupationId: existing.occupationId,
        attributes: existingAttributes,
        skills: (existing.skills ?? {}) as Record<string, number>,
        skillAllocation: existing.skillAllocation
      },
      canEditSkills
    }
  );
  if (result.ok === false) return { ok: false, error: result.error };

  const raceMods = existing.raceMods !== null && typeof existing.raceMods === "object" && Array.isArray(existing.raceMods) === false
    ? { ...(existing.raceMods as Record<string, unknown>) }
    : {};
  if (system === "COC7" && result.age !== null) {
    raceMods.age = result.age;
    raceMods.ageAllocation = result.ageAllocation;
    raceMods.ageAdjusted = applyAgeAdjustment;
  }

  const clampResource = (value: number | undefined, fallback: number, max: number): number => {
    if (value === undefined || Number.isFinite(value) === false) {
      return Math.min(max, Math.max(0, fallback));
    }
    return Math.min(max, Math.max(0, Math.floor(value)));
  };
  const resources = input.resources ?? null;
  const profile = input.profile ?? null;

  await prisma.character.update({
    where: { id: existing.id },
    data: {
      system,
      name: result.name,
      playerName: profile?.playerName !== undefined ? profile.playerName : existing.playerName,
      gender: profile?.gender !== undefined ? profile.gender : existing.gender,
      residence: profile?.residence !== undefined ? profile.residence : existing.residence,
      backstory: input.backstory !== undefined ? (input.backstory as never) : undefined,
      occupation: result.occupation?.name ?? null,
      occupationId: result.occupation?.id ?? null,
      era: result.era,
      age: result.age,
      race: result.race,
      str: result.attributes.str,
      con: result.attributes.con,
      siz: result.attributes.siz,
      dex: result.attributes.dex,
      app: result.attributes.app,
      int: result.attributes.int,
      pow: result.attributes.pow,
      edu: result.attributes.edu,
      luck: result.attributes.luck,
      raceMods: raceMods as never,
      skills: result.skills,
      skillAllocation: result.skillAllocation as never,
      hp: clampResource(resources?.hp, existing.hp <= 0 ? result.derived.maxHp : existing.hp, result.derived.maxHp),
      maxHp: result.derived.maxHp,
      mp: clampResource(resources?.mp, existing.mp <= 0 ? result.derived.maxMp : existing.mp, result.derived.maxMp),
      maxMp: result.derived.maxMp,
      san: clampResource(resources?.san, existing.san <= 0 ? result.derived.maxSan : existing.san, result.derived.maxSan),
      maxSan: result.derived.maxSan,
      dp: clampResource(resources?.dp, existing.dp, result.derived.maxDp),
      maxDp: result.derived.maxDp
    }
  });

  revalidatePath("/characters");
  revalidatePath("/characters/" + existing.id);
  if (room !== null) {
    revalidatePath("/rooms/" + room.id);
    revalidatePath("/rooms/" + room.id + "/characters/" + existing.id);
  }
  return { ok: true, characterId: existing.id };
}

/** 更新角色卡的基础档案（名称 / 玩家 / 职业文本 / 年龄 / 性别 / 住地 / 当前资源）。 */
export async function updateCharacterProfileAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const characterId = String(formData.get("characterId") ?? "");
  const character = await prisma.character.findUnique({ where: { id: characterId }, select: { userId: true } });
  if (character === null || character.userId !== session.user.id) redirect("/characters");

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) {
    redirect("/characters/" + characterId + "/edit?error=" + encodeURIComponent("角色名不能为空"));
  }
  const ageRaw = String(formData.get("age") ?? "").trim();
  const age = ageRaw.length === 0 ? null : Math.max(15, Math.min(90, Math.floor(Number(ageRaw)) || 0));
  const intField = (key: string): number | undefined => {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw.length === 0) return undefined;
    const value = Math.floor(Number(raw));
    return Number.isFinite(value) ? value : undefined;
  };

  await prisma.character.update({
    where: { id: characterId },
    data: {
      name,
      playerName: String(formData.get("playerName") ?? "").trim() || null,
      occupation: String(formData.get("occupation") ?? "").trim() || null,
      age,
      gender: String(formData.get("gender") ?? "").trim() || null,
      residence: String(formData.get("residence") ?? "").trim() || null,
      ...(intField("hp") === undefined ? {} : { hp: intField("hp") }),
      ...(intField("mp") === undefined ? {} : { mp: intField("mp") }),
      ...(intField("san") === undefined ? {} : { san: intField("san") }),
      ...(intField("dp") === undefined ? {} : { dp: intField("dp") })
    }
  });
  revalidatePath("/characters");
  revalidatePath("/characters/" + characterId);
  redirect("/characters/" + characterId + "?saved=profile");
}

/** 删除自己的角色卡。 */
export async function deleteCharacterAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const characterId = String(formData.get("characterId") ?? "");
  const character = await prisma.character.findUnique({ where: { id: characterId }, select: { userId: true } });
  if (character === null || character.userId !== session.user.id) redirect("/characters");
  await prisma.character.delete({ where: { id: characterId } });
  revalidatePath("/characters");
  redirect("/characters?deleted=1");
}
