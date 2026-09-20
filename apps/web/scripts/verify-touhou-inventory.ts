/**
 * 东方 14.3 重量 / 14.4 财产回归：规则包字段、负重与财产计算、角色携带总重。
 * 运行：npx tsx scripts/verify-touhou-inventory.ts
 */
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import {
  resolveCarryCapacity,
  resolveDragCapacity,
  resolveEncumbrance,
  resolveFoodCostRange,
  resolveLivingCost,
  resolveProperty,
  resolveStartingProperty,
  type InventoryRules
} from "@touhou/rules";
import { characterEquipmentOf } from "../src/shared/character-equipment";

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("重量 / 财产断言失败：" + message);
}

function main(): void {
  const pack = resolveRulePack("touhou-ext", builtinRegistry());
  ensure(pack.inventory.enabled === true, "东方包应启用重量 / 财产");
  ensure(pack.inventory.currencyName === "円", "货币单位应为円");
  ensure(pack.inventory.currencySubunit === "钱", "辅币应为钱");
  ensure(pack.inventory.subunitPerUnit === 100, "1 円应等于 100 钱");
  ensure(resolveStartingProperty(pack.inventory) === 10, "开卡财产应约 10 円");
  ensure(resolveLivingCost(pack.inventory) === 0.1, "每日食品费应约 0.1 円（10 钱）");
  const food = resolveFoodCostRange(pack.inventory);
  ensure(food.min === 0.05 && food.max === 0.1, "食品费用应为 5~10 钱");

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
  // {身体}=50（str 500 / ATTR_SCALE 10）→ 负重 500kg，拖拽 750kg
  ensure(resolveCarryCapacity(rules, { str: 500 }, { ATTR_SCALE: 10 }) === 500, "负重应为 {身体}×10=500kg");
  ensure(resolveDragCapacity(rules, 500) === 750, "地面拖拽应为 ×1.5=750kg");
  const enc = resolveEncumbrance(rules, { capacity: 100, weights: [40, 30, 25, 20] }, { str: 500 }, { ATTR_SCALE: 10 });
  ensure(enc.totalWeight === 115, "总重量应为 115kg");
  ensure(enc.overloadUnits === 15 && enc.penalty === 30, "超重 15kg 应产生 30 惩罚");
  const trade = resolveProperty(rules, { property: 10, spent: 3 });
  ensure(trade.propertyAfter === 7 && trade.affordable, "10 円花 3 后应剩 7 円");
  const coins = resolveProperty(rules, { property: 10, spent: 0.1 });
  ensure(coins.propertyAfter === 9.9, "支持钱级小数交易");

  // 角色携带总重：从 sourceData.items[].stats.weight 汇总。
  const equipment = characterEquipmentOf({
    items: [
      { name: "符纸", stats: { weight: 0.5 } },
      { name: "药水", stats: { weight: 1.5 } },
      { name: "无重量道具", stats: {} }
    ],
    weapons: [{ name: "御币", type: "MELEE" }]
  });
  ensure(equipment.totalWeight === 2, "携带总重应为 2，实际 " + equipment.totalWeight);

  const coc7 = resolveRulePack("coc7-baseline", builtinRegistry());
  ensure(coc7.inventory.enabled === false, "COC7 不应启用东方财产系统");

  console.log("PASS 东方重量与财产：{身体}×10kg / 10 円 / 1 円=100 钱 / 负重与交易 / 携带总重");
}

main();
