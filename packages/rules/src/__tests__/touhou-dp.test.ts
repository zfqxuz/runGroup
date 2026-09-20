import { describe, expect, it } from "vitest";
import {
  TOUHOU_LSC_DP_RECOVERY_MINUTES,
  TOUHOU_MAX_DICE_PER_CHECK_FALLBACK,
  TOUHOU_RESIST_MAX_DICE_FALLBACK,
  clampTouhouDpDice,
  touhouAbilityDamage,
  touhouChaseDamage,
  touhouMeleeDamage,
  touhouRangedDamage,
  touhouLscRecoveryDue,
  touhouResistTargetValue
} from "../touhou-dp";

describe("千幻抄 DP 伤害公式", () => {
  it("能力伤害 = 能力 LvD + 特性值", () => {
    const formula = touhouAbilityDamage(55, 3);
    expect(formula.dice).toBe(3);
    expect(formula.flat).toBe(55);
    expect(formula.expression).toBe("3d6+55");
  });

  it("射击伤害 = 能力 LvD + 特性值；用武器技能时 + 武器 Lv", () => {
    const bare = touhouRangedDamage(60, 2);
    expect(bare.expression).toBe("2d6+60");
    const armed = touhouRangedDamage(60, 2, 5);
    expect(armed.dice).toBe(2);
    expect(armed.flat).toBe(65);
    expect(armed.expression).toBe("2d6+65");
  });

  it("追击伤害 = 能力 Lv÷2 D + 特性值（向下取整）", () => {
    expect(touhouChaseDamage(50, 5).expression).toBe("2d6+50");
    expect(touhouChaseDamage(50, 4).expression).toBe("2d6+50");
    expect(touhouChaseDamage(50, 3).expression).toBe("1d6+50");
    expect(touhouChaseDamage(50, 0).expression).toBe("50");
  });

  it("近战伤害 = {身体} + 锻炼 LvD + 武器 Lv", () => {
    const formula = touhouMeleeDamage(45, 4, 5);
    expect(formula.dice).toBe(4);
    expect(formula.flat).toBe(50);
    expect(formula.expression).toBe("4d6+50");
  });

  it("零骰时输出纯固定值，避免 0d6 非法表达式", () => {
    expect(touhouAbilityDamage(0, 0).expression).toBe("0");
    expect(touhouMeleeDamage(0, 0, 0).expression).toBe("0");
  });
});

describe("千幻抄抵抗目标值", () => {
  it("目标值 = 10 + 施术者 Lv + 达成值×2 的十位数", () => {
    // Lv3，达成值 47 -> ×2=94 -> 十位 9 => 10+3+9 = 22
    expect(touhouResistTargetValue(3, 47)).toBe(22);
    expect(touhouResistTargetValue(1, 10)).toBe(13);
  });

  it("集中 3 分钟的 +5 会让目标值更高", () => {
    expect(touhouResistTargetValue(3, 47, 5)).toBe(27);
  });

  it("负数 / 非有限值按 0 处理", () => {
    expect(touhouResistTargetValue(-2, Number.NaN)).toBe(10);
  });
});

describe("DP 骰数夹取", () => {
  it("默认回落到规则上限", () => {
    expect(clampTouhouDpDice(0, 3)).toBe(3);
    expect(clampTouhouDpDice(99, 3)).toBe(3);
    expect(clampTouhouDpDice(2, 3)).toBe(2);
    expect(TOUHOU_MAX_DICE_PER_CHECK_FALLBACK).toBe(3);
    expect(TOUHOU_RESIST_MAX_DICE_FALLBACK).toBe(3);
  });
});

describe("LSC DP 恢复时长", () => {
  it("30 分钟内未到期，超过后到期", () => {
    const now = Date.parse("2026-09-20T00:00:00.000Z");
    const recent = new Date(now - 10 * 60_000).toISOString();
    const old = new Date(now - (TOUHOU_LSC_DP_RECOVERY_MINUTES + 1) * 60_000).toISOString();
    expect(touhouLscRecoveryDue(recent, now)).toBe(false);
    expect(touhouLscRecoveryDue(old, now)).toBe(true);
  });

  it("缺失 / 非法时间视为已到期，避免永久锁死", () => {
    const now = Date.parse("2026-09-20T00:00:00.000Z");
    expect(touhouLscRecoveryDue(null, now)).toBe(true);
    expect(touhouLscRecoveryDue("bad-date", now)).toBe(true);
  });
});
