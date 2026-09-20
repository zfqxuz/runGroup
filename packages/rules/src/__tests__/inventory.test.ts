import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  resolveCarryCapacity,
  resolveEncumbrance,
  resolveLivingCost,
  resolveProperty,
  resolveRulePack,
  resolveStartingProperty,
  type InventoryRules
} from "../index";

const pack = resolveRulePack("touhou-ext", builtinRegistry());

const rules: InventoryRules = {
  enabled: true,
  carryCapacity: "str + siz",
  overloadPenaltyPerUnit: "2",
  currencyName: "円",
  startingProperty: "10",
  livingCostPerDay: "1",
  propertyTradeRate: "1"
};

describe("14.10 重量 / 14.11 财产", () => {
  it("东方包登记 10 円 / 每日 1 円 / 货币单位", () => {
    expect(pack.inventory.enabled).toBe(true);
    expect(pack.inventory.currencyName).toBe("円");
    expect(resolveStartingProperty(pack.inventory)).toBe(10);
    expect(resolveLivingCost(pack.inventory)).toBe(1);
  });

  it("resolveCarryCapacity 求值属性表达式；未配置时为 null", () => {
    expect(resolveCarryCapacity(rules, { str: 50, siz: 60 })).toBe(110);
    expect(resolveCarryCapacity({ ...rules, carryCapacity: undefined }, { str: 50 })).toBeNull();
    expect(resolveCarryCapacity({ ...rules, enabled: false }, { str: 50 })).toBeNull();
  });

  it("超重时按每单位惩罚累加", () => {
    const result = resolveEncumbrance(rules, { capacity: 100, weights: [40, 30, 25, 20] }, {});
    expect(result.totalWeight).toBe(115);
    expect(result.overloadUnits).toBe(15);
    expect(result.penalty).toBe(30);
    expect(result.overloaded).toBe(true);
  });

  it("未超重 / 未启用负重时不惩罚", () => {
    expect(resolveEncumbrance(rules, { capacity: 100, weights: [10, 20] }).overloaded).toBe(false);
    expect(resolveEncumbrance(rules, { capacity: null, weights: [999] }).overloaded).toBe(false);
    expect(resolveEncumbrance({ ...rules, enabled: false }, { capacity: 1, weights: [999] }).overloaded).toBe(false);
  });

  it("财产交易扣款与折算", () => {
    const ok = resolveProperty(rules, { property: 10, spent: 3 });
    expect(ok.propertyAfter).toBe(7);
    expect(ok.affordable).toBe(true);
    expect(ok.tradeableValue).toBe(3);
    expect(ok.currencyName).toBe("円");
    const poor = resolveProperty(rules, { property: 2, spent: 5 });
    expect(poor.affordable).toBe(false);
    expect(poor.propertyAfter).toBe(0);
  });

  it("COC7 基线不启用财产系统", () => {
    const coc7 = resolveRulePack("coc7-baseline", builtinRegistry());
    expect(coc7.inventory.enabled).toBe(false);
  });
});
