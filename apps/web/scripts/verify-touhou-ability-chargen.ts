/**
 * 东方能力点车卡回归：验证 CharacterBuilder 依赖的规则包字段与消费表计算。
 * 运行：npx tsx --env-file=.env scripts/verify-touhou-ability-chargen.ts
 */
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import {
  abilityCostForLevel,
  abilityPointBudget,
  abilitySpendTotal,
  abilityTotalCost,
  validateAbilitySpend
} from "@touhou/rules";

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("能力车卡断言失败：" + message);
}

function main(): void {
  const pack = resolveRulePack("touhou-ext", builtinRegistry());
  const abilities = pack.abilities;
  ensure(abilities.enabled === true, "东方包应启用能力");
  const categories = Object.values(abilities.categories);
  ensure(categories.length === 5, "东方包应有 5 类能力，实际 " + categories.length);
  ensure(Object.keys(abilities.pointBudgets).sort().join(",") === "A,B,C,D", "能力等级应为 A-D");
  ensure(abilityPointBudget(abilities, "C") === 20, "C 级预算应为 20");
  ensure(abilityPointBudget(abilities, "Z") === null, "未知等级应返回 null");

  const spirit = abilities.categories.SPIRIT_ARTS;
  ensure(spirit !== undefined, "缺少神术·阴阳术类别");
  if (spirit === undefined) return;
  ensure(spirit.costTable.join("/") === "5/10/15/20/25/25", "神术消费表不符");
  ensure(abilityCostForLevel(spirit, 1) === 5, "神术 Lv1 应花 5 点");
  ensure(abilityCostForLevel(spirit, 6) === 25, "神术 Lv6 应花 25 点");
  ensure(abilityCostForLevel(spirit, 9) === 25, "超出表长后固定最后一档");
  ensure(abilityTotalCost(spirit, 3) === 30, "神术 Lv3 累计应为 30");

  // 模拟车卡 UI：C 级 20 点，神术 Lv2(15) + 妖术 Lv3(1+2+4=7) = 22 超支。
  const over = { SPIRIT_ARTS: 2, YOUJUTSU: 3 };
  ensure(abilitySpendTotal(abilities, over) === 22, "累计应为 22");
  const overCheck = validateAbilitySpend(abilities, "C", over);
  ensure(overCheck.ok === false && overCheck.error !== undefined, "超支应被拦截");

  const ok = { SPIRIT_ARTS: 2, YOUJUTSU: 2 };
  ensure(abilitySpendTotal(abilities, ok) === 18, "累计应为 18");
  ensure(validateAbilitySpend(abilities, "C", ok).ok === true, "18 点应通过 C 级预算");

  // 属性使每种属性独立：ELEMENTALIST:FIRE / ELEMENTALIST:WATER 按实例累计。
  const elemental = { "ELEMENTALIST:FIRE": 2, "ELEMENTALIST:WATER": 1 };
  ensure(abilitySpendTotal(abilities, elemental) === 16, "属性使实例累计应为 16");
  ensure(validateAbilitySpend(abilities, "C", elemental).ok === true, "属性使 16 点应通过 C 级预算");

  console.log("PASS 东方能力点车卡：5 类能力 / A-D 预算 / 逐级消费表 / 属性使实例 / 超支校验");
}

main();
