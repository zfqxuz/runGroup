/**
 * 千幻抄成长回归：成长点池读取 + 特性值 / 技能 / 能力成长校验（含 60% 限制）。
 * 运行：npx tsx --env-file=.env scripts/verify-touhou-growth.ts
 */
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import {
  checkAbilityGrowth,
  checkAttributeGrowth,
  checkSkillGrowth,
  growthRemaining,
  readTouhouGrowth,
  withTouhouGrowth
} from "../src/server/game/touhou-growth";

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("成长断言失败：" + message);
}

function main(): void {
  const pack = resolveRulePack("touhou-ext", builtinRegistry());
  const rules = pack.abilities;

  const defaults = readTouhouGrowth(null);
  ensure(defaults.hpCoefficient === 4, "默认 HP 系数应为 4");
  ensure(defaults.spellcardPool === 3, "默认 SC 池应为 3");
  ensure(growthRemaining(defaults, "ability") === 0, "默认没有成长点");

  const pools = {
    granted: { attribute: 10, skill: 18, ability: 12, hpCoefficient: 0.8, spellcard: 0.7 },
    spent: { attribute: 0, skill: 0, ability: 0 },
    spentByAbility: {},
    hpCoefficient: 4,
    spellcardPool: 3
  };

  // 特性值：n→n+1 花 n+1。
  const strCheck = checkAttributeGrowth(pools, 9);
  ensure(strCheck.ok === true && strCheck.cost === 10, "力量 9→10 应花 10 点");
  ensure(checkAttributeGrowth(pools, 100).ok === false, "超出剩余点数应失败");

  // 技能：一次最多 1 级、5 级后固定 5 点。
  const skillCheck = checkSkillGrowth(pools, 2);
  ensure(skillCheck.ok === true && skillCheck.cost === 3, "技能 Lv2→3 应花 3 点");

  // 能力：神术 Lv2→3 花 15 点，但能力只剩 12 点 → 失败。
  const spirit = checkAbilityGrowth(rules, pools, "SPIRIT_ARTS", 2);
  ensure(spirit.ok === false, "能力点不足应失败");
  ensure(growthRemaining(pools, "ability") === 12, "剩余能力点应为 12");

  // 能力：妖术 Lv0→1 花 1 点；60% 限制基于 granted.ability=12 → 上限 8。
  const youjutsu = checkAbilityGrowth(rules, pools, "YOUJUTSU", 0);
  ensure(youjutsu.ok === true && youjutsu.cost === 1, "妖术 Lv0→1 应花 1 点");
  const restrictedPools = { ...pools, spentByAbility: { YOUJUTSU: 8 } };
  const restricted = checkAbilityGrowth(rules, restrictedPools, "YOUJUTSU", 4);
  ensure(restricted.ok === false, "妖术超过 60% 上限应失败");

  // 写回 sourceData 后可再次读出。
  const source = withTouhouGrowth({ other: 1 }, { ...pools, hpCoefficient: 4.8 });
  const reread = readTouhouGrowth(source);
  ensure(reread.hpCoefficient === 4.8, "写回后 HP 系数应保持");
  ensure(reread.granted.attribute === 10, "写回后成长点应保持");

  console.log("PASS 千幻抄成长：成长点池 / 特性值 / 技能 / 能力与 60% 限制");
}

main();
