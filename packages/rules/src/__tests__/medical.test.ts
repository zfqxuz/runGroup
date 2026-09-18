import { describe, expect, it } from "vitest";
import type { Rng } from "@touhou/formula";
import {
  resolveFirstAid,
  resolveMedicine,
  resolveNaturalHealing,
  resolveWeeklyMajorWoundRecovery
} from "../medical";

function queueRng(values: number[]): Rng {
  return { nextUint32: () => values.shift() ?? 0 };
}

describe("COC7 医疗与恢复", () => {
  it("急救：一小时内成功恢复 1 HP，并稳定濒死；超时不可用", () => {
    const success = resolveFirstAid({
      hp: 3,
      maxHp: 10,
      hoursSinceInjury: 0.5,
      result: "REGULAR"
    });
    expect(success.allowed).toBe(true);
    expect(success.hpAfter).toBe(4);
    expect(success.hpRestored).toBe(1);
    expect(success.stabilizesDying).toBe(true);

    const tooLate = resolveFirstAid({
      hp: 3,
      maxHp: 10,
      hoursSinceInjury: 2,
      result: "EXTREME"
    });
    expect(tooLate.allowed).toBe(false);
    expect(tooLate.hpAfter).toBe(3);
  });

  it("医学：超过一天必须困难成功；未达到困难要求不恢复", () => {
    const hard = resolveMedicine({
      hp: 5,
      maxHp: 10,
      hoursSinceInjury: 25,
      result: "HARD",
      rng: queueRng([2])
    });
    expect(hard.allowed).toBe(true);
    expect(hard.difficulty).toBe("HARD");
    expect(hard.hpAfter).toBe(8);

    const notHardEnough = resolveMedicine({
      hp: 5,
      maxHp: 10,
      hoursSinceInjury: 25,
      result: "REGULAR",
      rng: queueRng([2])
    });
    expect(notHardEnough.hpAfter).toBe(5);
  });

  it("医学：濒死必须先由急救稳定", () => {
    const blocked = resolveMedicine({
      hp: 0,
      maxHp: 10,
      hoursSinceInjury: 2,
      result: "EXTREME",
      dying: true,
      stabilizedDying: false,
      rng: queueRng([0])
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.error).toContain("急救");

    const allowed = resolveMedicine({
      hp: 0,
      maxHp: 10,
      hoursSinceInjury: 2,
      result: "REGULAR",
      dying: true,
      stabilizedDying: true,
      rng: queueRng([2])
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.hpAfter).toBe(3);
  });

  it("自然恢复：未重伤每天 1 HP，重伤不走日恢复", () => {
    const normal = resolveNaturalHealing({ hp: 2, maxHp: 10, majorWound: false, days: 3 });
    expect(normal.hpAfter).toBe(5);
    const major = resolveNaturalHealing({ hp: 2, maxHp: 10, majorWound: true, days: 3 });
    expect(major.hpAfter).toBe(2);
  });

  it("重伤周检：成功 1D3、极难 2D3；回到半血以上移除重伤", () => {
    const regular = resolveWeeklyMajorWoundRecovery({
      hp: 2,
      maxHp: 10,
      majorWound: true,
      result: "REGULAR",
      rng: queueRng([0])
    });
    expect(regular.hpAfter).toBe(3);
    expect(regular.clearsMajorWound).toBe(false);

    const half = resolveWeeklyMajorWoundRecovery({
      hp: 4,
      maxHp: 10,
      majorWound: true,
      result: "REGULAR",
      rng: queueRng([0])
    });
    expect(half.hpAfter).toBe(5);
    expect(half.clearsMajorWound).toBe(true);

    const extreme = resolveWeeklyMajorWoundRecovery({
      hp: 2,
      maxHp: 10,
      majorWound: true,
      result: "EXTREME",
      rng: queueRng([2, 2])
    });
    expect(extreme.hpAfter).toBe(8);
    expect(extreme.clearsMajorWound).toBe(true);
  });
});
