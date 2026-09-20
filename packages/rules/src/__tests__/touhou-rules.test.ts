import { describe, expect, it } from "vitest";
import {
  TOUHOU_WAKE_MINUTES,
  compileParsedRulePack,
  computeDerived,
  resolveRulePack,
  resolveTouhouEmergencyCare,
  resolveTouhouMpRecovery,
  resolveTouhouNaturalHealing,
  spellcardBattleDeclarationRules,
  spellcardSideUsableCount,
  touhouMovement,
  type AttributeSet
} from "../index";
import { builtinRegistry } from "../packs";

describe("千幻抄移动速度", () => {
  it("地面 = {身体}+〈运动〉", () => {
    expect(touhouMovement({ str: 4, int: 3, athletics: 2, flight: 0, mode: "GROUND" })).toBe(6);
  });

  it("飞行 = ({知性}或{身体}+〈飞行〉)×2", () => {
    expect(touhouMovement({ str: 4, int: 3, athletics: 0, flight: 2, mode: "FLIGHT" })).toBe(12);
    expect(
      touhouMovement({ str: 4, int: 3, athletics: 0, flight: 2, mode: "FLIGHT", flightAttribute: "int" })
    ).toBe(10);
  });
});

describe("千幻抄自然治愈（14.5）", () => {
  it("每小时 1 HP", () => {
    const outcome = resolveTouhouNaturalHealing({ hp: 5, maxHp: 12, hours: 3 });
    expect(outcome.perHour).toBe(1);
    expect(outcome.hpAfter).toBe(8);
    expect(outcome.hpRestored).toBe(3);
  });

  it("有〈应急处置〉/〈医学〉时每小时额外 + 技能等级", () => {
    const outcome = resolveTouhouNaturalHealing({ hp: 5, maxHp: 20, hours: 2, careSkillLevel: 3 });
    expect(outcome.perHour).toBe(4);
    expect(outcome.hpAfter).toBe(13);
  });

  it("不超过最大 HP", () => {
    const outcome = resolveTouhouNaturalHealing({ hp: 9, maxHp: 10, hours: 100 });
    expect(outcome.hpAfter).toBe(10);
  });
});

describe("千幻抄应急治疗（14.6）", () => {
  it("DC18 成功时恢复达成值半数 HP，耗时 30 分钟", () => {
    const outcome = resolveTouhouEmergencyCare({
      hp: 2,
      maxHp: 20,
      intelligence: 4,
      skillLevel: 3,
      roll: 12
    });
    expect(outcome.dc).toBe(18);
    expect(outcome.achievement).toBe(19);
    expect(outcome.success).toBe(true);
    expect(outcome.hpRestored).toBe(9);
    expect(outcome.minutes).toBe(30);
  });

  it("未达 DC18 不恢复", () => {
    const outcome = resolveTouhouEmergencyCare({
      hp: 2,
      maxHp: 20,
      intelligence: 2,
      skillLevel: 1,
      roll: 5
    });
    expect(outcome.success).toBe(false);
    expect(outcome.hpRestored).toBe(0);
  });
});

describe("千幻抄灵力恢复（14.8）", () => {
  it("清醒每 10 分钟 +1", () => {
    const outcome = resolveTouhouMpRecovery({ mp: 2, maxMp: 20, awakeMinutes: 35 });
    expect(outcome.mpAfter).toBe(5);
    expect(outcome.full).toBe(false);
  });

  it("连续睡满 3 小时回满", () => {
    const outcome = resolveTouhouMpRecovery({ mp: 2, maxMp: 20, awakeMinutes: 0, asleepHours: 3 });
    expect(outcome.mpAfter).toBe(20);
    expect(outcome.full).toBe(true);
  });

  it("清醒时间不足以恢复时不增加", () => {
    const outcome = resolveTouhouMpRecovery({ mp: 2, maxMp: 20, awakeMinutes: 9 });
    expect(outcome.mpAfter).toBe(2);
  });
});

describe("苏醒时间常量", () => {
  it("HP 回复后约 30 分钟苏醒", () => {
    expect(TOUHOU_WAKE_MINUTES).toBe(30);
  });
});

describe("千幻抄 HP 公式与符卡宣言（2.3.1 / 6.1.2）", () => {
  const attrs: AttributeSet = {
    str: 50, con: 50, siz: 60, dex: 55,
    app: 50, int: 60, pow: 40, edu: 70, luck: 45
  };
  const touhouPack = resolveRulePack("touhou-ext", builtinRegistry());
  const touhouCompiled = compileParsedRulePack(touhouPack);

  it("HP = ceil(10 + 耐久 × HP系数)，开卡系数为 4", () => {
    const result = computeDerived(touhouCompiled, { attributes: attrs });
    expect(result.derived.maxHp).toBe(210);
    expect(touhouPack.const.HP_COEFFICIENT).toBe(4);
  });

  it("一方本场可用 SC 数 = 能使用 SC 的人数 × 2.5，向上取整", () => {
    const rules = spellcardBattleDeclarationRules(touhouPack.spellcard);
    expect(rules).toEqual({ perMember: 2.5, rounding: "CEIL", min: 1 });
    expect(spellcardSideUsableCount(4, rules)).toBe(10);
    expect(spellcardSideUsableCount(3, rules)).toBe(8);
    expect(spellcardSideUsableCount(1, rules)).toBe(3);
    // 不能使用 SC 的成员不计入
    expect(spellcardSideUsableCount(0, rules)).toBe(0);
  });
});
