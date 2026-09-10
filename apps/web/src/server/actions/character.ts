"use server";

import { revalidatePath } from "next/cache";
import { compile, evaluate } from "@touhou/formula";
import {
  ATTRIBUTE_KEYS,
  builtinRegistry,
  checkPointBuy,
  compileParsedRulePack,
  computeDerived,
  resolveRulePack,
  type AttributeKey,
  type AttributeSet
} from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { hasFreeSkillChoice, isOccupationSkill, toOccupationView } from "@/shared/occupation";

export interface SkillAllocationInput {
  readonly occupation: Record<string, number>;
  readonly interest: Record<string, number>;
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

  const name = input.name.trim();
  if (name.length === 0) return { ok: false, error: "角色名不能为空" };
  if (name.length > 50) return { ok: false, error: "角色名最多 50 个字符" };

  const system = room?.system ?? input.system;
  const pack = resolveRulePack(packIdFor(system), builtinRegistry());
  const compiled = compileParsedRulePack(pack);

  const attributes = {} as AttributeSet;
  for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
    const value = Math.floor(Number(input.attributes[key] ?? 0));
    if (Number.isFinite(value) === false) {
      return { ok: false, error: key + " 不是合法数字" };
    }
    if (value < pack.attributes.min || value > pack.attributes.max) {
      return {
        ok: false,
        error: key + " 必须在 " + pack.attributes.min + "~" + pack.attributes.max + " 之间"
      };
    }
    attributes[key] = value;
  }

  const method = pack.attributes.methods.find((item) => item.id === input.chargenMethod);
  if (method === undefined) return { ok: false, error: "本房的车卡方式不合法" };

  if (method.kind === "POINT_BUY") {
    const check = checkPointBuy(method, attributes);
    if (check.valid === false) {
      return { ok: false, error: "点数分配不合法：" + check.errors.join("；") };
    }
  }

  if (method.kind === "ROLL_SETS") {
    for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
      if (attributes[key] % method.multiplier !== 0) {
        return { ok: false, error: key + " 不是 " + method.dice + "×" + method.multiplier + " 的合法结果" };
      }
    }
  }

  if (input.race !== null && pack.races[input.race] === undefined) {
    return { ok: false, error: "本规则包没有这个种族" };
  }

  const era =
    room?.era ??
    (input.era === "CLASSIC" || input.era === "MODERN" ? input.era : null);

  const occupation = input.occupationId
    ? await prisma.occupation.findUnique({ where: { id: input.occupationId } })
    : null;
  if (input.occupationId && occupation === null) {
    return { ok: false, error: "所选职业不存在" };
  }
  if (occupation !== null) {
    if (occupation.system !== system) {
      return { ok: false, error: "所选职业不属于当前模组" };
    }
    if (era !== null && occupation.era !== "BOTH" && occupation.era !== era) {
      return { ok: false, error: "所选职业与当前房间年代不匹配" };
    }
  }

  // 服务端重算衍生属性与技能基础值 —— 客户端传来的数值一律只作为分配参考
  const outcome = computeDerived(compiled, { attributes, race: input.race });
  const vars = outcome.attributes as unknown as Record<string, number>;
  const context = { vars, consts: pack.const };

  const skillBases: Record<string, number> = {};
  for (const skill of compiled.skills) {
    skillBases[skill.id] = Math.floor(evaluate(skill.base, context));
  }

  const maxAtCreation = Math.floor(evaluate(compiled.skillPoints.maxAtCreation, context));
  const raceRule = input.race === null ? undefined : pack.races[input.race];
  const interestExpression =
    raceRule?.interestPoints === undefined
      ? compiled.skillPoints.interest
      : compile(raceRule.interestPoints, { vars: [...ATTRIBUTE_KEYS] });
  const interestPool = Math.floor(evaluate(interestExpression, context));
  const occupationPool =
    occupation === null
      ? 0
      : Math.floor(evaluate(compile(occupation.pointsFormula, { vars: [...ATTRIBUTE_KEYS] }), context));

  let skills: Record<string, number>;
  let skillAllocation: SkillAllocationInput | null = null;

  if (input.skillAllocation === undefined || input.skillAllocation === null) {
    skills = {};
    for (const [skillId, raw] of Object.entries(input.skills)) {
      const value = Math.floor(Number(raw));
      if (Number.isFinite(value) === false || value < 0) {
        return { ok: false, error: "技能值不合法" };
      }
      skills[skillId] = value;
    }
  } else {
    if (occupation === null && Object.keys(input.skillAllocation.occupation).length > 0) {
      return { ok: false, error: "尚未选择职业，不能分配职业点" };
    }
    const occupationAdded = readPointMap(input.skillAllocation.occupation);
    const interestAdded = readPointMap(input.skillAllocation.interest);
    if (occupationAdded === null || interestAdded === null) {
      return { ok: false, error: "技能点分配数据不合法" };
    }
    const occupationTotal = Object.values(occupationAdded).reduce((sum, value) => sum + value, 0);
    const interestTotal = Object.values(interestAdded).reduce((sum, value) => sum + value, 0);
    if (occupationTotal > occupationPool) {
      return { ok: false, error: "职业点已超出上限（" + occupationPool + "）" };
    }
    if (interestTotal > interestPool) {
      return { ok: false, error: "兴趣点已超出上限（" + interestPool + "）" };
    }

    const occupationView = occupation === null ? null : toOccupationView(occupation);
    const freeChoice = occupationView === null ? false : hasFreeSkillChoice(occupationView);
    skills = {};
    for (const skill of compiled.skills) {
      const base = skillBases[skill.id] ?? 0;
      const occ = occupationAdded[skill.id] ?? 0;
      if (occ > 0 && occupationView !== null && !freeChoice && !isOccupationSkill(occupationView, skill.name)) {
        return { ok: false, error: skill.name + " 不是本职业的本职或可选技能" };
      }
      const interest = interestAdded[skill.id] ?? 0;
      const total = base + occ + interest;
      if (total > maxAtCreation) {
        return { ok: false, error: skill.name + " 超过车卡上限 " + maxAtCreation };
      }
      if (total > 0) skills[skill.id] = total;
    }
    for (const skillId of [...Object.keys(occupationAdded), ...Object.keys(interestAdded)]) {
      if (skillBases[skillId] === undefined) {
        return { ok: false, error: "存在不属于当前规则包的技能：" + skillId };
      }
    }
    skillAllocation = { occupation: occupationAdded, interest: interestAdded };
  }

  const character = await prisma.character.create({
    data: {
      userId: session.user.id,
      roomId: null,
      system,
      reviewStatus: "PENDING_REVIEW",
      name,
      occupation: occupation?.name ?? null,
      occupationId: occupation?.id ?? null,
      era,
      race: input.race,
      str: attributes.str,
      con: attributes.con,
      siz: attributes.siz,
      dex: attributes.dex,
      app: attributes.app,
      int: attributes.int,
      pow: attributes.pow,
      edu: attributes.edu,
      luck: attributes.luck,
      raceMods: { method: input.chargenMethod, flags: [...outcome.flags] },
      skills,
      skillAllocation: skillAllocation as never,
      hp: outcome.derived.maxHp,
      maxHp: outcome.derived.maxHp,
      mp: outcome.derived.maxMp,
      maxMp: outcome.derived.maxMp,
      san: outcome.derived.maxSan,
      maxSan: outcome.derived.maxSan,
      dp: outcome.derived.maxDp,
      maxDp: outcome.derived.maxDp
    },
    select: { id: true }
  });

  // 角色卡属于用户库（roomId 为 null）；带进房间是一条待 KP 审核的申请
  if (room !== null) {
    await prisma.roomCharacterEntry.create({
      data: { roomId: room.id, characterId: character.id, status: "PENDING_REVIEW" }
    });
    revalidatePath("/rooms/" + room.id);
  }
  revalidatePath("/characters");
  return { ok: true, characterId: character.id };
}
