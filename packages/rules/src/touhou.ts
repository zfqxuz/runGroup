/**
 * 东方千幻抄专属的恢复 / 移动 / 资源规则。
 *
 * 这些公式在千幻抄里用的是「特性值 + 技能等级」的小数值体系；
 * 本项目底座是 COC7 百分制，因此这里只实现明确的千幻抄公式，
 * 调用方负责把百分制技能换算成千幻抄等级后再传入。
 */

export interface TouhouMovementInput {
  readonly str: number;
  readonly int: number;
  /** 〈运动〉技能等级。 */
  readonly athletics: number;
  /** 〈飞行〉技能等级。 */
  readonly flight: number;
  readonly mode: "GROUND" | "FLIGHT";
  /** 飞行时选择 {知性} 或 {身体}；缺省用 {身体}。 */
  readonly flightAttribute?: "str" | "int";
}

function finiteInt(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

/** 千幻抄移动速度（m/s）：地面 = {身体}+〈运动〉；飞行 = ({知性}或{身体}+〈飞行〉)×2。 */
export function touhouMovement(input: TouhouMovementInput): number {
  const str = finiteInt(input.str);
  const int = finiteInt(input.int);
  if (input.mode === "GROUND") {
    return Math.max(0, str + finiteInt(input.athletics));
  }
  const attribute = input.flightAttribute === "int" ? int : str;
  return Math.max(0, (attribute + finiteInt(input.flight)) * 2);
}

export interface TouhouNaturalHealingInput {
  readonly hp: number;
  readonly maxHp: number;
  /** 经过的小时数。 */
  readonly hours: number;
  /** 〈应急处置〉或〈医学〉的千幻抄技能等级；0 表示没有。 */
  readonly careSkillLevel?: number;
}

export interface TouhouNaturalHealingOutcome {
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly hpRestored: number;
  /** 每小时恢复量 = 1 + 照护技能等级。 */
  readonly perHour: number;
  readonly hours: number;
}

/** 千幻抄自然治愈：每小时 1 HP；有〈应急处置〉/〈医学〉每小时额外 + 技能等级。 */
export function resolveTouhouNaturalHealing(
  input: TouhouNaturalHealingInput
): TouhouNaturalHealingOutcome {
  const maxHp = Math.max(0, finiteInt(input.maxHp));
  const hpBefore = Math.min(maxHp, finiteInt(input.hp));
  const hours = Math.max(0, finiteInt(input.hours));
  const careSkillLevel = Math.max(0, finiteInt(input.careSkillLevel ?? 0));
  const perHour = 1 + careSkillLevel;
  const hpAfter = Math.min(maxHp, hpBefore + perHour * hours);
  return { hpBefore, hpAfter, hpRestored: hpAfter - hpBefore, perHour, hours };
}

export interface TouhouEmergencyCareInput {
  readonly hp: number;
  readonly maxHp: number;
  readonly intelligence: number;
  /** 〈应急处置〉或〈医学〉的千幻抄技能等级。 */
  readonly skillLevel: number;
  /** 3D6 的掷骰结果（3~18）。 */
  readonly roll: number;
}

export interface TouhouEmergencyCareOutcome {
  readonly success: boolean;
  readonly dc: number;
  readonly achievement: number;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly hpRestored: number;
  /** 千幻抄固定耗时：30 分钟。 */
  readonly minutes: number;
}

/**
 * 应急治疗：{知性}+〈应急处置/医学〉+3D6，DC18。
 * 成功恢复「达成值半数」HP，耗时 30 分钟。
 */
export function resolveTouhouEmergencyCare(
  input: TouhouEmergencyCareInput
): TouhouEmergencyCareOutcome {
  const dc = 18;
  const maxHp = Math.max(0, finiteInt(input.maxHp));
  const hpBefore = Math.min(maxHp, finiteInt(input.hp));
  const intelligence = Number.isFinite(input.intelligence) ? Math.floor(input.intelligence) : 0;
  const skillLevel = finiteInt(input.skillLevel);
  const roll = Number.isFinite(input.roll) ? Math.floor(input.roll) : 0;
  const achievement = intelligence + skillLevel + roll;
  const success = achievement >= dc;
  const restored = success ? Math.floor(achievement / 2) : 0;
  const hpAfter = Math.min(maxHp, hpBefore + restored);
  return {
    success,
    dc,
    achievement,
    hpBefore,
    hpAfter,
    hpRestored: hpAfter - hpBefore,
    minutes: 30
  };
}

export interface TouhouMpRecoveryInput {
  readonly mp: number;
  readonly maxMp: number;
  /** 清醒状态下经过的分钟数。 */
  readonly awakeMinutes: number;
  /** 连续睡眠小时数；≥3 视为睡满。 */
  readonly asleepHours?: number;
}

export interface TouhouMpRecoveryOutcome {
  readonly mpBefore: number;
  readonly mpAfter: number;
  readonly mpRestored: number;
  readonly full: boolean;
}

/** 千幻抄灵力恢复：清醒每 10 分钟 +1；连续睡 3 小时回满。 */
export function resolveTouhouMpRecovery(input: TouhouMpRecoveryInput): TouhouMpRecoveryOutcome {
  const maxMp = Math.max(0, finiteInt(input.maxMp));
  const mpBefore = Math.min(maxMp, finiteInt(input.mp));
  const asleepHours = Math.max(0, Number.isFinite(input.asleepHours ?? 0) ? Math.floor(input.asleepHours ?? 0) : 0);
  if (asleepHours >= 3) {
    return { mpBefore, mpAfter: maxMp, mpRestored: maxMp - mpBefore, full: true };
  }
  const minutes = Math.max(0, finiteInt(input.awakeMinutes));
  const gained = Math.floor(minutes / 10);
  const mpAfter = Math.min(maxMp, mpBefore + gained);
  return { mpBefore, mpAfter, mpRestored: mpAfter - mpBefore, full: false };
}

/** HP 回复后约 30 分钟苏醒；供 KP / 时间推进流程使用。 */
export const TOUHOU_WAKE_MINUTES = 30;
