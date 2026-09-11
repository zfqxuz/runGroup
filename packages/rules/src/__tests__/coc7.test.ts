import { describe, expect, it } from "vitest";
import {
  applyCoc7AgeAdjustment,
  checkCoc7AgeAllocation,
  coc7AgeAdjustment,
  coc7Build,
  coc7DamageBonus,
  coc7DamageBonusFromBuild,
  coc7MajorWound,
  coc7Movement
} from "../coc7";
import type { AttributeSet } from "../types";

describe("COC7 伤害加值 DB / 体格 Build 查表", () => {
  it("按 STR+SIZ 区间返回正确表达式", () => {
    expect(coc7DamageBonus(2)).toBe("-2");
    expect(coc7DamageBonus(64)).toBe("-2");
    expect(coc7DamageBonus(65)).toBe("-1");
    expect(coc7DamageBonus(84)).toBe("-1");
    expect(coc7DamageBonus(85)).toBe("0");
    expect(coc7DamageBonus(124)).toBe("0");
    expect(coc7DamageBonus(125)).toBe("1d4");
    expect(coc7DamageBonus(164)).toBe("1d4");
    expect(coc7DamageBonus(165)).toBe("1d6");
    expect(coc7DamageBonus(204)).toBe("1d6");
    expect(coc7DamageBonus(205)).toBe("2d6");
    expect(coc7DamageBonus(284)).toBe("2d6");
    expect(coc7DamageBonus(285)).toBe("3d6");
    expect(coc7DamageBonus(364)).toBe("3d6");
    expect(coc7DamageBonus(365)).toBe("4d6");
    expect(coc7DamageBonus(444)).toBe("4d6");
    expect(coc7DamageBonus(445)).toBe("5d6");
    expect(coc7DamageBonus(525)).toBe("6d6");
    expect(coc7DamageBonus(605)).toBe("7d6");
  });

  it("体格在各区间边界正确", () => {
    expect(coc7Build(64)).toBe(-2);
    expect(coc7Build(65)).toBe(-1);
    expect(coc7Build(85)).toBe(0);
    expect(coc7Build(125)).toBe(1);
    expect(coc7Build(165)).toBe(2);
    expect(coc7Build(205)).toBe(3);
    expect(coc7Build(284)).toBe(3);
    expect(coc7Build(285)).toBe(4);
    expect(coc7Build(365)).toBe(5);
    expect(coc7Build(445)).toBe(6);
  });

  it("由体格换算 DB", () => {
    expect(coc7DamageBonusFromBuild(-2)).toBe("-2");
    expect(coc7DamageBonusFromBuild(-1)).toBe("-1");
    expect(coc7DamageBonusFromBuild(0)).toBe("0");
    expect(coc7DamageBonusFromBuild(1)).toBe("1d4");
    expect(coc7DamageBonusFromBuild(2)).toBe("1d6");
    expect(coc7DamageBonusFromBuild(3)).toBe("2d6");
    expect(coc7DamageBonusFromBuild(6)).toBe("5d6");
  });
});

describe("COC7 MOV 与重伤值", () => {
  it("STR / DEX 与 SIZ 的比较决定体型修正", () => {
    expect(coc7Movement({ str: 60, siz: 50, dex: 60 })).toBe(9);
    expect(coc7Movement({ str: 40, siz: 50, dex: 40 })).toBe(7);
    expect(coc7Movement({ str: 60, siz: 50, dex: 40 })).toBe(8);
    expect(coc7Movement({ str: 50, siz: 50, dex: 50 })).toBe(8);
  });

  it("年龄 40 起扣 MOV，护甲额外扣减且不会低于 0", () => {
    expect(coc7Movement({ str: 50, siz: 50, dex: 50, age: 35 })).toBe(8);
    expect(coc7Movement({ str: 50, siz: 50, dex: 50, age: 45 })).toBe(7);
    expect(coc7Movement({ str: 50, siz: 50, dex: 50, age: 55 })).toBe(6);
    expect(coc7Movement({ str: 50, siz: 50, dex: 50, age: 65 })).toBe(5);
    expect(coc7Movement({ str: 50, siz: 50, dex: 50, age: 75 })).toBe(4);
    expect(coc7Movement({ str: 50, siz: 50, dex: 50, age: 85 })).toBe(3);
    expect(coc7Movement({ str: 40, siz: 50, dex: 40, age: 85, armorPenalty: 1 })).toBe(1);
    expect(coc7Movement({ str: 40, siz: 50, dex: 40, age: 85, armorPenalty: 99 })).toBe(0);
  });

  it("重伤值向上取整", () => {
    expect(coc7MajorWound(0)).toBe(0);
    expect(coc7MajorWound(9)).toBe(5);
    expect(coc7MajorWound(10)).toBe(5);
    expect(coc7MajorWound(11)).toBe(6);
  });
});

describe("COC7 年龄补正", () => {
  it("按年龄段返回扣减总额、属性、APP / EDU / MOV / 幸运", () => {
    const teen = coc7AgeAdjustment(17);
    expect(teen.deductionTotal).toBe(5);
    expect(teen.deductionAttributes).toEqual(["str", "siz"]);
    expect(teen.eduPenalty).toBe(5);
    expect(teen.luckRolls).toBe(2);

    const adult = coc7AgeAdjustment(28);
    expect(adult.deductionTotal).toBe(0);
    expect(adult.eduChecks).toBe(1);

    const forty = coc7AgeAdjustment(45);
    expect(forty.deductionTotal).toBe(5);
    expect(forty.deductionAttributes).toEqual(["str", "con", "dex"]);
    expect(forty.appPenalty).toBe(5);
    expect(forty.eduChecks).toBe(2);
    expect(forty.movePenalty).toBe(1);

    const eighty = coc7AgeAdjustment(85);
    expect(eighty.deductionTotal).toBe(80);
    expect(eighty.appPenalty).toBe(25);
    expect(eighty.eduChecks).toBe(4);
    expect(eighty.movePenalty).toBe(5);
  });

  it("校验一次性分配的总额与可扣属性", () => {
    expect(checkCoc7AgeAllocation(46, { str: 5 }).ok).toBe(true);
    expect(checkCoc7AgeAllocation(46, { str: 2, con: 3 }).ok).toBe(true);
    expect(checkCoc7AgeAllocation(46, { siz: 5 }).ok).toBe(false);
    expect(checkCoc7AgeAllocation(46, { str: 4 }).ok).toBe(false);
    expect(checkCoc7AgeAllocation(17, { str: 3, siz: 2 }).ok).toBe(true);
    expect(checkCoc7AgeAllocation(17, { dex: 5 }).ok).toBe(false);
  });

  it("应用年龄补正时只减对应属性，APP / EDU 按档位固定扣", () => {
    const base: AttributeSet = {
      str: 60,
      con: 60,
      siz: 60,
      dex: 60,
      app: 60,
      int: 60,
      pow: 60,
      edu: 80,
      luck: 60
    };
    const adjusted = applyCoc7AgeAdjustment(base, 65, { str: 5, con: 8, dex: 7 });
    expect(adjusted.str).toBe(55);
    expect(adjusted.con).toBe(52);
    expect(adjusted.dex).toBe(53);
    expect(adjusted.app).toBe(45);
    expect(adjusted.edu).toBe(80);
    expect(adjusted.luck).toBe(60);
    const teen = applyCoc7AgeAdjustment(base, 17, { str: 3, siz: 2 });
    expect(teen.str).toBe(57);
    expect(teen.siz).toBe(58);
    expect(teen.edu).toBe(75);
  });
});
