/**
 * 战斗选项回归验证：COC7 / TOUHOU 的攻击技能与事件开关。
 * 运行：npx tsx --env-file=.env scripts/verify-combat-options.ts
 */
import {
  builtinRegistry,
  compileRulePack,
  resolveRulePack,
  type CompiledRulePack
} from "@touhou/rules";
import {
  allowedAttackSkills,
  allowedReactionTypes,
  combatFeatureFlags,
  validateCombatAction
} from "../src/server/combat/options";

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("战斗选项断言失败：" + message);
}

function expectIds(actual: readonly string[], expected: readonly string[], message: string): void {
  const left = [...actual].sort().join(",");
  const right = [...expected].sort().join(",");
  if (left === right) return;
  throw new Error("战斗选项断言失败：" + message + "，期望 [" + right + "]，实际 [" + left + "]");
}

function skillMap(pack: CompiledRulePack): Record<string, number> {
  const map: Record<string, number> = {};
  for (const skill of pack.skills) map[skill.id] = 10;
  return map;
}

function main(): void {
  const coc = compileRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));
  const touhou = compileRulePack(resolveRulePack("touhou-ext", builtinRegistry()));
  const cocPlayer = { id: "coc-pc", kind: "PLAYER" as const, characterId: "char-coc", skills: skillMap(coc) };
  const touhouPlayer = { id: "touhou-pc", kind: "PLAYER" as const, characterId: "char-touhou", skills: skillMap(touhou) };

  const unarmed = allowedAttackSkills(coc, cocPlayer, []);
  expectIds(unarmed, ["FIGHTING_BRAWL"], "COC 角色没有装备武器时只能斗殴");
  ensure(unarmed.includes("DANMAKU") === false, "纯 COC 不应出现 DANMAKU");
  ensure(unarmed.includes("LIBRARY_USE") === false, "攻击技能不应包含图书馆使用");

  const handgun = allowedAttackSkills(coc, cocPlayer, [{ name: "测试手枪", stats: { range: "NEAR" } }]);
  expectIds(handgun, ["FIREARMS_HANDGUN"], "COC 中距武器应映射到手枪");
  const axe = allowedAttackSkills(coc, cocPlayer, [{ name: "消防斧", stats: { range: "MELEE" } }]);
  expectIds(axe, ["FIGHTING_AXE"], "COC 近战斧应映射到斧");

  const cocFlags = combatFeatureFlags(coc);
  ensure(cocFlags.canCounter === true, "COC7 应支持反击");
  ensure(cocFlags.canOutOfRule === false, "纯 COC 不应显示规则外施法");
  expectIds([...allowedReactionTypes(coc)], ["PASS", "DODGE", "COUNTER"], "COC 应对选项应为不应对 / 闪避 / 反击");
  ensure(allowedReactionTypes(coc).includes("DEFEND") === false, "COC7 不应出现防御姿态");

  const touhouAttack = allowedAttackSkills(touhou, touhouPlayer, []);
  ensure(touhouAttack.includes("DANMAKU"), "东方无武器应保留弹幕/近战等战斗技能");
  ensure(touhouAttack.includes("LIBRARY_USE") === false, "东方攻击技能也不应包含非战斗技能");
  const touhouFlags = combatFeatureFlags(touhou);
  ensure(touhouFlags.canCounter === true, "东方应显示消弹");
  ensure(touhouFlags.canOutOfRule === true, "东方应显示规则外施法");
  ensure(allowedReactionTypes(touhou).includes("COUNTER"), "东方应对应包含消弹对抗");

  const cocActionContext = {
    pack: coc,
    state: {
      participants: [
        { id: "coc-pc", defeated: false },
        { id: "coc-npc", defeated: false }
      ]
    },
    attackSkills: new Map<string, readonly string[]>([[
      "coc-pc",
      ["FIGHTING_BRAWL"]
    ], [
      "coc-npc",
      ["FIGHTING_BRAWL"]
    ]])
  };

  const danmakuError = validateCombatAction(cocActionContext, {
    actorId: "coc-pc",
    kind: "DANMAKU",
    targetId: "coc-npc",
    skill: "DANMAKU",
    damage: "1d3"
  });
  ensure(typeof danmakuError === "string", "COC 服务端应拒绝 DANMAKU 攻击");

  const nonCombatError = validateCombatAction(cocActionContext, {
    actorId: "coc-pc",
    kind: "DANMAKU",
    targetId: "coc-npc",
    skill: "LIBRARY_USE",
    damage: "1d3"
  });
  ensure(typeof nonCombatError === "string", "COC 服务端应拒绝非战斗技能攻击");

  const counterError = validateCombatAction(cocActionContext, {
    actorId: "coc-pc",
    kind: "COUNTER"
  });
  ensure(counterError === null, "COC 服务端应允许反击姿态");

  const outOfRuleError = validateCombatAction(cocActionContext, {
    actorId: "coc-pc",
    kind: "OUT_OF_RULE",
    name: "测试"
  });
  ensure(typeof outOfRuleError === "string", "COC 服务端应拒绝规则外施法");

  const spellcardError = validateCombatAction(cocActionContext, {
    actorId: "coc-pc",
    kind: "SPELLCARD",
    name: "测试",
    mpCost: 10
  });
  ensure(typeof spellcardError === "string", "COC 服务端应拒绝符卡");

  const brawlError = validateCombatAction(cocActionContext, {
    actorId: "coc-pc",
    kind: "DANMAKU",
    targetId: "coc-npc",
    skill: "FIGHTING_BRAWL",
    damage: "1d3"
  });
  ensure(brawlError === null, "COC 斗殴攻击应被允许");

  console.log("PASS 战斗选项：COC 闪避/反击与无防御、斗殴/武器限制、非战斗技能过滤、东方事件开关、服务端行动校验");
}

main();
