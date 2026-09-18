import { parseDice, rollDice, type Rng } from "@touhou/formula";
import { CHECK_RANK, type CheckResult } from "./types";

export type MedicalAction = "FIRST_AID" | "MEDICINE" | "WEEKLY_RECOVERY" | "NATURAL_HEALING";
export type MedicalDifficulty = "REGULAR" | "HARD";

export interface MedicalOutcome {
  readonly allowed: boolean;
  readonly action: MedicalAction;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly hpRestored: number;
  readonly clearsUnconscious: boolean;
  /** 成功急救可以稳定濒死，使其不再需要每轮 CON 检定。 */
  readonly stabilizesDying: boolean;
  readonly clearsMajorWound: boolean;
  readonly difficulty: MedicalDifficulty;
  readonly note: string;
  readonly error?: string;
}

function finiteInt(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function hpRange(hp: number, maxHp: number): { readonly before: number; readonly max: number } {
  const max = Math.max(1, finiteInt(maxHp, 1));
  return { before: Math.min(max, finiteInt(hp)), max };
}

function successAt(result: CheckResult, difficulty: MedicalDifficulty): boolean {
  return CHECK_RANK[result] >= CHECK_RANK[difficulty];
}

function medicalResult(
  action: MedicalAction,
  hpBefore: number,
  hpAfter: number,
  extra: Partial<Omit<MedicalOutcome, "action" | "hpBefore" | "hpAfter" | "hpRestored">> = {}
): MedicalOutcome {
  const boundedAfter = Math.max(0, Math.floor(hpAfter));
  return {
    allowed: true,
    action,
    hpBefore,
    hpAfter: boundedAfter,
    hpRestored: Math.max(0, boundedAfter - hpBefore),
    clearsUnconscious: false,
    stabilizesDying: false,
    clearsMajorWound: false,
    difficulty: "REGULAR",
    note: "",
    ...extra
  };
}

/**
 * 急救：必须在受伤后一小时内使用。
 * 成功恢复 1 HP；HP 回到正数时醒来；对濒死者成功即视为稳定。
 */
export function resolveFirstAid(input: {
  readonly hp: number;
  readonly maxHp: number;
  readonly hoursSinceInjury: number;
  readonly result: CheckResult;
}): MedicalOutcome {
  const { before, max } = hpRange(input.hp, input.maxHp);
  if (Number.isFinite(input.hoursSinceInjury) === false || input.hoursSinceInjury > 1) {
    return {
      allowed: false,
      action: "FIRST_AID",
      hpBefore: before,
      hpAfter: before,
      hpRestored: 0,
      clearsUnconscious: false,
      stabilizesDying: false,
      clearsMajorWound: false,
      difficulty: "REGULAR",
      note: "",
      error: "急救只能在受伤后一小时内使用"
    };
  }
  if (successAt(input.result, "REGULAR") === false) {
    return medicalResult("FIRST_AID", before, before, {
      note: "急救失败：没有恢复 HP，也没有稳定濒死"
    });
  }
  const after = Math.min(max, before + 1);
  return medicalResult("FIRST_AID", before, after, {
    clearsUnconscious: after > 0,
    stabilizesDying: true,
    note: "急救成功：恢复 1 HP" + (after > 0 ? "，可唤醒昏迷者" : "") + "；成功稳定濒死"
  });
}

/** 医学：至少一小时；超过一天需要困难成功；濒死必须先被急救稳定。 */
export function resolveMedicine(input: {
  readonly hp: number;
  readonly maxHp: number;
  readonly hoursSinceInjury: number;
  readonly result: CheckResult;
  /** 濒死角色是否已被成功的急救稳定。 */
  readonly stabilizedDying?: boolean;
  readonly dying?: boolean;
  readonly rng: Rng;
}): MedicalOutcome {
  const { before, max } = hpRange(input.hp, input.maxHp);
  const difficulty: MedicalDifficulty =
    Number.isFinite(input.hoursSinceInjury) && input.hoursSinceInjury > 24 ? "HARD" : "REGULAR";
  if (input.dying === true && input.stabilizedDying !== true) {
    return {
      allowed: false,
      action: "MEDICINE",
      hpBefore: before,
      hpAfter: before,
      hpRestored: 0,
      clearsUnconscious: false,
      stabilizesDying: false,
      clearsMajorWound: false,
      difficulty,
      note: "",
      error: "濒死角色必须先被成功的急救稳定，才能使用医学"
    };
  }
  if (successAt(input.result, difficulty) === false) {
    return medicalResult("MEDICINE", before, before, {
      difficulty,
      note:
        difficulty === "HARD"
          ? "医学检定未达到困难要求：没有恢复 HP（超过一天才就医）"
          : "医学检定失败：没有恢复 HP"
    });
  }
  const rolled = rollDice(parseDice("1d3"), input.rng).total;
  const after = Math.min(max, before + rolled);
  return medicalResult("MEDICINE", before, after, {
    difficulty,
    clearsUnconscious: after > 0,
    note: "医学成功：恢复 1D3 = " + rolled + " HP，可与急救叠加"
  });
}

/** 未受重伤时，每天自然恢复 1 HP。 */
export function resolveNaturalHealing(input: {
  readonly hp: number;
  readonly maxHp: number;
  readonly majorWound: boolean;
  readonly days?: number;
}): MedicalOutcome {
  const { before, max } = hpRange(input.hp, input.maxHp);
  const days = Math.max(1, finiteInt(input.days ?? 1, 1));
  if (input.majorWound) {
    return medicalResult("NATURAL_HEALING", before, before, {
      note: "重伤角色不能按每日 1 HP 自然恢复，必须进行每周重伤恢复检定"
    });
  }
  const after = Math.min(max, before + days);
  return medicalResult("NATURAL_HEALING", before, after, {
    clearsUnconscious: after > 0,
    note: "自然恢复：经过 " + days + " 天，恢复 " + (after - before) + " HP"
  });
}

/**
 * 重伤每周恢复检定（目标 CON）：
 * - 成功 1D3；
 * - 极难 / 大成功 2D3，并直接移除重伤；
 * - HP 恢复到最大值一半以上也会移除重伤。
 */
export function resolveWeeklyMajorWoundRecovery(input: {
  readonly hp: number;
  readonly maxHp: number;
  readonly majorWound: boolean;
  readonly result: CheckResult;
  readonly rng: Rng;
}): MedicalOutcome {
  const { before, max } = hpRange(input.hp, input.maxHp);
  if (input.majorWound !== true) {
    return medicalResult("WEEKLY_RECOVERY", before, before, {
      note: "未受重伤，不需要每周恢复检定"
    });
  }
  const success = successAt(input.result, "REGULAR");
  const extreme = CHECK_RANK[input.result] >= CHECK_RANK.EXTREME;
  let restored = 0;
  if (success) {
    const expression = extreme ? "2d3" : "1d3";
    restored = rollDice(parseDice(expression), input.rng).total;
  }
  const after = Math.min(max, before + restored);
  const clearsMajorWound = extreme || after >= Math.ceil(max / 2);
  return medicalResult("WEEKLY_RECOVERY", before, after, {
    clearsMajorWound,
    clearsUnconscious: after > 0,
    note:
      (success
        ? "每周恢复检定成功：" + (extreme ? "极难成功，恢复 2D3 = " : "恢复 1D3 = ") + restored + " HP"
        : "每周恢复检定失败：没有恢复 HP") +
      (clearsMajorWound ? "；移除重伤" : "")
  });
}
