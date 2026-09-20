/**
 * 东方 14.10 重量 / 14.11 财产回归：规则包字段、负重与财产计算、角色携带总重。
 * 运行：npx tsx scripts/verify-touhou-inventory.ts
 */
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import {
  resolveCarryCapacity,
  resolveEncumbrance,
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
  ensure(resolveStartingProperty(pack.inventory) === 10, "开卡财产应约 10 円");
  ensure(resolveLivingCost(pack.inventory) === 1, "每日生活费应为 1 円");

  const rules: InventoryRules = {
    enabled: true,
    carryCapacity: "str + siz",
    overloadPenaltyPerUnit: "2",
    currencyName: "円",
    startingProperty: "10",
    livingCostPerDay: "1",
    propertyTradeRate: "1"
  };
  ensure(resolveCarryCapacity(rules, { str: 50, siz: 60 }) === 110, "负重上限应为 str+siz=110");
  const enc = resolveEncumbrance(rules, { capacity: 100, weights: [40, 30, 25, 20] });
  ensure(enc.totalWeight === 115, "总重量应为 115");
  ensure(enc.overloadUnits === 15 && enc.penalty === 30, "超重 15 应产生 30 惩罚");
  const trade = resolveProperty(rules, { property: 10, spent: 3 });
  ensure(trade.propertyAfter === 7 && trade.affordable, "10 円花 3 后应剩 7 円");

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

  console.log("PASS 东方重量与财产：10 円 / 每日 1 円 / 负重与超重惩罚 / 财产交易 / 携带总重");
}

main();
