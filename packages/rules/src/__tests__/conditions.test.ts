import { describe, expect, it } from "vitest";
import {
  findCondition,
  isCoreCondition,
  makeCondition,
  parseConditions,
  possessChargeRemaining,
  tickConditions
} from "../conditions";

describe("局内状态 GameCondition", () => {
  it("宽容解析 JSON 字符串与数组，忽略非法项", () => {
    const json = JSON.stringify([
      { id: "c1", type: "POSSESS", duration: { unit: "CHARGE", remaining: 3 }, data: { controllerId: "npc-1" } },
      { id: "bad" }
    ]);
    const parsed = parseConditions(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.type).toBe("POSSESS");
    expect(parseConditions("not json")).toEqual([]);
    expect(parseConditions(null)).toEqual([]);
  });

  it("区分核心状态与自定义状态", () => {
    expect(isCoreCondition("DEAD")).toBe(true);
    expect(isCoreCondition("POSSESS")).toBe(false);
    expect(isCoreCondition("HOME_BREW")).toBe(false);
  });

  it("按单位推进持续时间并分离到期项", () => {
    const conditions = [
      makeCondition({ type: "POSSESS", id: "p1", unit: "CHARGE", remaining: 2 }),
      makeCondition({ type: "POISON", id: "p2", unit: "HOUR", remaining: 5 }),
      makeCondition({ type: "CURSE", id: "p3", unit: "NARRATIVE", note: "直到解除" })
    ];
    const first = tickConditions(conditions, "CHARGE", 1);
    expect(findCondition(first.conditions, "POSSESS")?.duration.remaining).toBe(1);
    expect(first.expired).toHaveLength(0);

    const second = tickConditions(first.conditions, "CHARGE", 1);
    expect(findCondition(second.conditions, "POSSESS")).toBeNull();
    expect(second.expired.map((item) => item.id)).toEqual(["p1"]);
    // 不同单位的状态不受影响
    expect(findCondition(second.conditions, "POISON")?.duration.remaining).toBe(5);
    expect(findCondition(second.conditions, "CURSE")?.duration.unit).toBe("NARRATIVE");
  });

  it("读取夺舍充能池剩余量", () => {
    const conditions = [makeCondition({ type: "POSSESS", unit: "CHARGE", remaining: 4 })];
    expect(possessChargeRemaining(conditions)).toBe(4);
    expect(possessChargeRemaining(tickConditions(conditions, "CHARGE", 4).conditions)).toBeNull();
    expect(possessChargeRemaining([])).toBeNull();
  });
});
