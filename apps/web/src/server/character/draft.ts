import { compile, evaluate } from "@touhou/formula";
import {
  ATTRIBUTE_KEYS,
  applyCoc7AgeAdjustment,
  checkCoc7AgeAllocation,
  checkPointBuy,
  computeDerived,
  type AttributeKey,
  type AttributeSet,
  type Coc7AgeAllocation,
  type CompiledRulePack,
  type RulePack
} from "@touhou/rules";
import type { Occupation } from "@prisma/client";
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

export interface CharacterDraftInput {
  readonly system: "COC7" | "TOUHOU";
  readonly name: string;
  readonly race: string | null;
  readonly attributes: Record<string, number>;
  readonly chargenMethod: string;
  readonly occupationId: string | null;
  readonly skillAllocation: SkillAllocationInput | null;
  readonly slotAssignments: Record<string, readonly string[]> | null;
  readonly era: string | null;
  readonly age: number | null;
  readonly ageAllocation: Coc7AgeAllocation | null;
  /** 新建（车卡）时为 true，走原车卡点数法校验；角色管理直接改属性时为 false。 */
  readonly enforceAttributeMethod: boolean;
  /** 是否套用 COC7 年龄补正。导入卡（ageAdjusted=false）在年龄不变时跳过，避免重复扣减。 */
  readonly applyAgeAdjustment: boolean;
}

/** 已有角色在编辑时要保留的旧数据。 */
export interface CharacterDraftExisting {
  readonly occupationId: string | null;
  readonly attributes: AttributeSet;
  readonly skills: Record<string, number>;
  readonly skillAllocation: unknown;
}

export interface CharacterDraftContext {
  readonly pack: RulePack;
  readonly compiled: CompiledRulePack;
  readonly occupation: Occupation | null;
  readonly era: string | null;
  readonly existing: CharacterDraftExisting | null;
  /** 本人可编辑技能熟练度；KP 为 false（技能点沿用旧值）。 */
  readonly canEditSkills: boolean;
}

export type CharacterDraftResult =
  | {
      readonly ok: true;
      readonly name: string;
      readonly attributes: AttributeSet;
      readonly skills: Record<string, number>;
      readonly skillAllocation: SkillAllocationInput | null;
      readonly occupation: Occupation | null;
      readonly era: string | null;
      readonly age: number | null;
      readonly ageAllocation: Coc7AgeAllocation;
      readonly race: string | null;
      readonly raceFlags: readonly string[];
      readonly derived: ReturnType<typeof computeDerived>["derived"];
      readonly san: number;
    }
  | { readonly ok: false; readonly error: string };

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

function readAllocation(value: unknown): { occupation: Record<string, number>; interest: Record<string, number>; slots: Record<string, string[]> } {
  const record = value !== null && typeof value === "object" && Array.isArray(value) === false
    ? (value as Record<string, unknown>)
    : {};
  const occupation = readPointMap(record.occupation) ?? {};
  const interest = readPointMap(record.interest) ?? {};
  const slots: Record<string, string[]> = {};
  const rawSlots = record.slots;
  if (rawSlots !== null && typeof rawSlots === "object" && Array.isArray(rawSlots) === false) {
    for (const [key, raw] of Object.entries(rawSlots as Record<string, unknown>)) {
      slots[key] = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
    }
  }
  return { occupation, interest, slots };
}

function skillBasesOf(compiled: CompiledRulePack, pack: RulePack, attributes: AttributeSet): Record<string, number> {
  const outcome = computeDerived(compiled, { attributes, race: null });
  const context = { vars: outcome.attributes as unknown as Record<string, number>, consts: pack.const };
  const bases: Record<string, number> = {};
  for (const skill of compiled.skills) bases[skill.id] = Math.floor(evaluate(skill.base, context));
  return bases;
}

/**
 * 角色草稿的统一校验：车卡（新建）与角色管理（编辑）共用同一份 COC7 规则。
 *
 * - 属性范围 / 点购 / 年龄补正 / 职业匹配 / 空位 / 职业点池 / 兴趣点池 /
 *   单技能上限 / 信用评级 / 技能归属，全部只在这里实现一次。
 * - 编辑时保留「成长点」（旧总值 - 旧基础值 - 旧加点），不会被重算抹掉。
 * - `canEditSkills=false`（KP）时忽略传入的加点，只沿用旧加点；若属性/职业变化
 *   导致旧加点不合法，返回明确错误而不是悄悄改数值。
 */
export function validateCharacterDraft(
  input: CharacterDraftInput,
  context: CharacterDraftContext
): CharacterDraftResult {
  const { pack, compiled, occupation } = context;
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, error: "角色名不能为空" };
  if (name.length > 50) return { ok: false, error: "角色名最多 50 个字符" };

  const attributes = {} as AttributeSet;
  for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
    const value = Math.floor(Number(input.attributes[key] ?? 0));
    if (Number.isFinite(value) === false) return { ok: false, error: key + " 不是合法数字" };
    if (value < pack.attributes.min || value > pack.attributes.max) {
      return { ok: false, error: key + " 必须在 " + pack.attributes.min + "~" + pack.attributes.max + " 之间" };
    }
    attributes[key] = value;
  }

  const method = pack.attributes.methods.find((item) => item.id === input.chargenMethod);
  if (input.enforceAttributeMethod) {
    if (method === undefined) return { ok: false, error: "本房的车卡方式不合法" };
    if (method.kind === "POINT_BUY") {
      const check = checkPointBuy(method, attributes);
      if (check.valid === false) return { ok: false, error: "点数分配不合法：" + check.errors.join("；") };
    }
    if (method.kind === "ROLL_SETS") {
      for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
        if (attributes[key] % method.multiplier !== 0) {
          return { ok: false, error: key + " 不是 " + method.dice + "×" + method.multiplier + " 的合法结果" };
        }
      }
    }
  }

  if (input.race !== null && pack.races[input.race] === undefined) {
    return { ok: false, error: "本规则包没有这个种族" };
  }

  let age: number | null = null;
  let ageAllocation: Coc7AgeAllocation = {};
  if (input.system === "COC7") {
    const normalizedAge = input.age === undefined || input.age === null ? 30 : Math.floor(Number(input.age));
    if (Number.isFinite(normalizedAge) === false || normalizedAge < 15 || normalizedAge > 90) {
      return { ok: false, error: "年龄必须在 15~90 之间" };
    }
    const allocation = input.ageAllocation ?? {};
    if (input.applyAgeAdjustment) {
      const ageCheck = checkCoc7AgeAllocation(normalizedAge, allocation);
      if (ageCheck.ok === false) return { ok: false, error: "年龄补正分配不合法：" + ageCheck.errors.join("；") };
    }
    age = normalizedAge;
    ageAllocation = allocation;
  } else if (input.age !== undefined && input.age !== null) {
    const trimmedAge = Math.floor(Number(input.age));
    age = Number.isFinite(trimmedAge) ? Math.max(0, Math.min(999, trimmedAge)) : null;
  }

  const adjustedAttributes =
    input.system === "COC7" && age !== null && input.applyAgeAdjustment
      ? applyCoc7AgeAdjustment(attributes, age, ageAllocation)
      : attributes;

  if (occupation !== null) {
    if (occupation.system !== input.system) return { ok: false, error: "所选职业不属于当前模组" };
    if (input.era !== null && occupation.era !== "BOTH" && occupation.era !== input.era) {
      return { ok: false, error: "所选职业与当前房间年代不匹配" };
    }
  }

  const outcome = computeDerived(compiled, { attributes: adjustedAttributes, race: input.race });
  const vars = outcome.attributes as unknown as Record<string, number>;
  const skillContext = { vars, consts: pack.const };
  const skillBases: Record<string, number> = {};
  for (const skill of compiled.skills) skillBases[skill.id] = Math.floor(evaluate(skill.base, skillContext));

  const occupationMax = Math.floor(evaluate(compiled.skillPoints.occupationMax, skillContext));
  const interestMax = Math.floor(evaluate(compiled.skillPoints.interestMax, skillContext));
  const raceRule = input.race === null ? undefined : pack.races[input.race];
  const interestExpression =
    raceRule?.interestPoints === undefined
      ? compiled.skillPoints.interest
      : compile(raceRule.interestPoints, { vars: [...ATTRIBUTE_KEYS] });
  const interestPool = Math.floor(evaluate(interestExpression, skillContext));
  const occupationPool =
    occupation === null
      ? 0
      : Math.floor(evaluate(compile(occupation.pointsFormula, { vars: [...ATTRIBUTE_KEYS] }), skillContext));

  // ---- 成长点：编辑时用「旧总值 - 旧基础值 - 旧加点」保住成长，不被重算抹掉 ----
  const old = context.existing;
  const oldBases = old === null ? {} : skillBasesOf(compiled, pack, old.attributes);
  const oldAllocation = old === null ? { occupation: {}, interest: {}, slots: {} } : readAllocation(old.skillAllocation);
  const growth: Record<string, number> = {};
  if (old !== null) {
    for (const skill of compiled.skills) {
      const total = old.skills[skill.id] ?? 0;
      const explained = (oldBases[skill.id] ?? 0) + (oldAllocation.occupation[skill.id] ?? 0) + (oldAllocation.interest[skill.id] ?? 0);
      const extra = total - explained;
      if (extra > 0) growth[skill.id] = extra;
    }
  }

  const occupationChanged = old !== null && (old.occupationId ?? null) !== (input.occupationId ?? null);

  let occupationAdded: Record<string, number>;
  let interestAdded: Record<string, number>;
  let normalizedSlots: Record<string, string[]> = {};
  let skillAllocation: SkillAllocationInput | null = null;

  if (context.canEditSkills === false && old !== null) {
    // KP：不允许直接改加点。职业变化时按规则重置，否则沿用旧加点。
    occupationAdded = occupationChanged ? {} : oldAllocation.occupation;
    interestAdded = occupationChanged ? {} : oldAllocation.interest;
    normalizedSlots = occupationChanged ? {} : oldAllocation.slots;
    // 换职业后旧加点全部失效；系统按规则补上信用评级下限，避免 KP 卡在非法状态。
    if (occupationChanged && occupation !== null) {
      const creditMin = occupation.creditMin ?? 0;
      if (creditMin > 0 && creditMin <= occupationPool) {
        occupationAdded = { CREDIT_RATING: creditMin };
      }
    }
    skillAllocation = { occupation: occupationAdded, interest: interestAdded, slots: normalizedSlots };
  } else if (input.skillAllocation === null || input.skillAllocation === undefined) {
    // 编辑旧角色且没有传加点时，沿用旧加点，避免把已有分配清空。
    occupationAdded = old === null ? {} : oldAllocation.occupation;
    interestAdded = old === null ? {} : oldAllocation.interest;
    normalizedSlots = old === null ? {} : oldAllocation.slots;
    skillAllocation = old === null ? null : { occupation: occupationAdded, interest: interestAdded, slots: normalizedSlots };
  } else {
    if (occupation === null && Object.keys(input.skillAllocation.occupation).length > 0) {
      return { ok: false, error: "尚未选择职业，不能分配职业点" };
    }
    const occupationMap = readPointMap(input.skillAllocation.occupation);
    const interestMap = readPointMap(input.skillAllocation.interest);
    if (occupationMap === null || interestMap === null) return { ok: false, error: "技能点分配数据不合法" };
    const occupationTotal = Object.values(occupationMap).reduce((sum, value) => sum + value, 0);
    const interestTotal = Object.values(interestMap).reduce((sum, value) => sum + value, 0);
    if (occupationTotal > occupationPool) return { ok: false, error: "职业点已超出上限（" + occupationPool + "）" };
    if (interestTotal > interestPool) return { ok: false, error: "兴趣点已超出上限（" + interestPool + "）" };
    occupationAdded = occupationMap;
    interestAdded = interestMap;
    const occupationView = occupation === null ? null : toOccupationView(occupation);
    const skillProfile = occupationView?.skillProfile ?? null;
    if (skillProfile !== null) {
      for (const [slotId, value] of Object.entries(input.slotAssignments ?? {})) {
        normalizedSlots[slotId] = Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [];
      }
      const slotCheck = validateOccupationSlotAssignments(skillProfile, normalizedSlots, compiled.skills.map((skill) => skill.id));
      if (slotCheck.ok === false) return { ok: false, error: "本职空位不合法：" + slotCheck.errors.join("；") };
    }
    skillAllocation = { occupation: occupationAdded, interest: interestAdded, slots: normalizedSlots };
  }

  // ---- 加点合法性（职业 / 兴趣 / 上限 / 信用评级）----
  const occupationView = occupation === null ? null : toOccupationView(occupation);
  const skillProfile = occupationView?.skillProfile ?? null;
  const profileOccupational =
    skillProfile === null ? new Set<string>() : profileOccupationalSkillIds(skillProfile, normalizedSlots);
  const limits =
    occupationView === null || skillProfile !== null
      ? { free: 0, social: 0, categories: {} as Record<string, number> }
      : occupationChoiceLimits(occupationView);
  const accessBySkill = new Map<string, OccupationSkillAccess>();
  for (const skill of compiled.skills) {
    let access: OccupationSkillAccess = { kind: "NONE", group: null };
    if (occupationView !== null) {
      if (skillProfile !== null) {
        access = profileOccupational.has(skill.id) ? { kind: "FIXED", group: null } : { kind: "NONE", group: null };
      } else {
        access = occupationSkillAccess(occupationView, skill.name);
      }
    }
    accessBySkill.set(skill.id, access);
  }
  const choiceCounts = {
    social: new Set<string>(),
    free: new Set<string>(),
    categories: new Map<string, Set<string>>()
  };

  const skills: Record<string, number> = {};
  for (const skill of compiled.skills) {
    const base = skillBases[skill.id] ?? 0;
    const occ = occupationAdded[skill.id] ?? 0;
    const interest = interestAdded[skill.id] ?? 0;
    const growthValue = growth[skill.id] ?? 0;
    const access = accessBySkill.get(skill.id) ?? { kind: "NONE", group: null };

    if (context.canEditSkills || old === null) {
      const pointIssue = skillPointUsageIssue({ access, occupation: occ, interest });
      if (pointIssue !== null) {
        const detail =
          pointIssue === "OCCUPATION_NOT_ALLOWED"
            ? "不是本职业的本职或可选技能，不能用职业点"
            : pointIssue === "INTEREST_NOT_ALLOWED"
              ? "是本职技能，只能用职业点加点"
              : "不能同时使用职业点和兴趣点";
        return { ok: false, error: skill.name + "：" + detail };
      }
      if (occ > 0 && skillProfile === null) {
        if (access.kind === "SOCIAL" && choiceCounts.social.has(skill.id) === false) {
          if (choiceCounts.social.size >= limits.social) {
            return { ok: false, error: "本职业最多只能选择 " + limits.social + " 项社交技能" };
          }
          choiceCounts.social.add(skill.id);
        } else if (access.kind === "FREE" && choiceCounts.free.has(skill.id) === false) {
          if (choiceCounts.free.size >= limits.free) {
            return { ok: false, error: "本职业最多只能自由选择 " + limits.free + " 项技能" };
          }
          choiceCounts.free.add(skill.id);
        } else if (access.kind === "CATEGORY" && access.group !== null) {
          const groupSet = choiceCounts.categories.get(access.group) ?? new Set<string>();
          if (groupSet.has(skill.id) === false) {
            if (groupSet.size >= (limits.categories[access.group] ?? 1)) {
              return { ok: false, error: "本职业的「" + access.group + "」分类只能选择 1 项技能" };
            }
          }
          groupSet.add(skill.id);
          choiceCounts.categories.set(access.group, groupSet);
        }
      }
    }

    const total = base + occ + interest + growthValue;
    if (context.canEditSkills || old === null) {
      const withinCap = isSkillCreationWithinCap({ base, occupation: occ, interest, occupationMax, interestMax });
      if (withinCap === false) {
        return {
          ok: false,
          error: skill.name + " 超过" + (occ > 0 ? "本职" : "兴趣") + "技能上限 " + (occ > 0 ? occupationMax : interestMax)
        };
      }
    }
    if (total > 0) skills[skill.id] = total;
  }

  if (context.canEditSkills || old === null) {
    for (const skillId of [...Object.keys(occupationAdded), ...Object.keys(interestAdded)]) {
      if (skillBases[skillId] === undefined) return { ok: false, error: "存在不属于当前规则包的技能：" + skillId };
    }
  }

  if (occupation !== null && (occupation.creditMin !== null || occupation.creditMax !== null)) {
    const credit = skills.CREDIT_RATING ?? 0;
    const creditMin = occupation.creditMin ?? 0;
    const creditMax = occupation.creditMax ?? 99;
    if (credit < creditMin || credit > creditMax) {
      return { ok: false, error: "信用评级必须在 " + creditMin + "~" + creditMax + " 之间（当前 " + credit + "）" };
    }
  }

  const finalOutcome = computeDerived(compiled, { attributes: adjustedAttributes, race: input.race, skills });
  const maxSan = finalOutcome.derived.maxSan;
  const san = Math.max(0, Math.min(adjustedAttributes.pow, maxSan));

  return {
    ok: true,
    name,
    attributes: adjustedAttributes,
    skills,
    skillAllocation,
    occupation,
    era: input.era,
    age,
    ageAllocation,
    race: input.race,
    raceFlags: outcome.flags,
    derived: finalOutcome.derived,
    san
  };
}
