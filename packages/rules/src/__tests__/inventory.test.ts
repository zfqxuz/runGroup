import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  resolveCarryCapacity,
  resolveDragCapacity,
  resolveEncumbrance,
  resolveFoodCostRange,
  resolveLivingCost,
  resolveProperty,
  resolveRulePack,
  resolveStartingProperty,
  type InventoryRules
} from "../index";

const pack = resolveRulePack("touhou-ext", builtinRegistry());

const rules: InventoryRules = {
  enabled: true,
  carryCapacity: "floor(str / ATTR_SCALE) * 10",
  dragMultiplier: "1.5",
  overloadPenaltyPerUnit: "2",
  currencyName: "円",
  currencySubunit: "钱",
  subunitPerUnit: 100,
  startingProperty: "10",
  livingCostPerDay: "0.1",
  foodCostMin: "0.05",
  foodCostMax: "0.1",
  propertyTradeRate: "1"
};

describe("14.3 重量 / 14.4 财产（wiki）", () => {
  it("东方包登记 {身体}×10kg / 10 円 / 1 円=100 钱 / 食品 5~10 钱", () => {
    expect(pack.inventory.enabled).toBe(true);
    expect(pack.inventory.currencyName).toBe("円");
    expect(pack.inventory.currencySubunit).toBe("钱");
    expect(pack.inventory.subunitPerUnit).toBe(100);
    expect(resolveStartingProperty(pack.inventory)).toBe(10);
    expect(resolveLivingCost(pack.inventory)).toBe(0.1);
    const food = resolveFoodCostRange(pack.inventory);
    expect(food.min).toBe(0.05);
    expect(food.max).toBe(0.1);
  });

  it("负重上限 = {身体}×10kg，拖拽 = ×1.5", () => {
    // str=500 / ATTR_SCALE=10 → {身体}=50 → 500kg
    expect(resolveCarryCapacity(pack.inventory, { str: 500 }, { ATTR_SCALE: 10 })).toBe(500);
    expect(resolveDragCapacity(pack.inventory, 500)).toBe(750);
    expect(resolveCarryCapacity({ ...pack.inventory, carryCapacity: undefined })).toBeNull();
    expect(resolveCarryCapacity({ ...pack.inventory, enabled: false })).toBeNull();
  });

  it("超重时按每单位惩罚累加", () => {
    const result = resolveEncumbrance(rules, { capacity: 100, weights: [40, 30, 25, 20] }, { str: 500 }, { ATTR_SCALE: 10 });
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

  it("财产交易支持小数（円 / 钱）", () => {
    const ok = resolveProperty(rules, { property: 10, spent: 3 });
    expect(ok.propertyAfter).toBe(7);
    expect(ok.affordable).toBe(true);
    expect(ok.tradeableValue).toBe(3);
    expect(ok.currencyName).toBe("円");
    const coins = resolveProperty(rules, { property: 10, spent: 0.1 });
    expect(coins.propertyAfter).toBe(9.9);
    const poor = resolveProperty(rules, { property: 0.05, spent: 0.1 });
    expect(poor.affordable).toBe(false);
    expect(poor.propertyAfter).toBe(0);
  });

  it("COC7 基线不启用财产系统", () => {
    const coc7 = resolveRulePack("coc7-baseline", builtinRegistry());
    expect(coc7.inventory.enabled).toBe(false);
  });
});
