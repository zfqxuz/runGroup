import { describe, expect, it } from "vitest";
import { expandDamageBonus } from "../combat";

describe("伤害表达式中的 db", () => {
  it("将 1d4+db 展开为单位的伤害加值表达式", () => {
    expect(expandDamageBonus("1d4+db", "1d6")).toBe("1d4+1d6");
    expect(expandDamageBonus("1d10+db", "-1")).toBe("1d10+-1");
    expect(expandDamageBonus("db", "2d6")).toBe("2d6");
  });

  it("大小写不敏感，且不会误伤普通单词", () => {
    expect(expandDamageBonus("1d4+DB", "1d4")).toBe("1d4+1d4");
    expect(expandDamageBonus("1d4+dbx", "1d4")).toBe("1d4+dbx");
  });
});
