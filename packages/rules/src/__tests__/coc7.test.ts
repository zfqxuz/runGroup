import { describe, expect, it } from "vitest";
import { coc7DamageBonus } from "../coc7";

describe("COC7 伤害加值 DB 查表", () => {
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
  });
});
