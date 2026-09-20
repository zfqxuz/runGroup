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
  allowedReactionTypesForParticipant,
  attackOptionsForParticipant,
  combatFeatureFlags,
  reactionTypesForAttack,
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
  const touhouParsed = resolveRulePack("touhou-ext", builtinRegistry());
  const touhou = compileRulePack(touhouParsed);
  // 房间启用魔法时会在 pack 上打开 magic.enabled；这里构造同样的包用于战斗法术校验。
  const touhouMagic = compileRulePack({
    ...touhouParsed,
    magic: { ...(touhouParsed.magic ?? {}), enabled: true }
  });
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

  const handgunOptions = attackOptionsForParticipant(coc, cocPlayer, [
    { name: "测试手枪", stats: { range: "NEAR", damage: "1d10" } }
  ]);
  ensure(handgunOptions.length === 1, "手枪应生成一个攻击选项");
  ensure(handgunOptions[0]?.skillId === "FIREARMS_HANDGUN", "手枪攻击选项应映射到手枪技能");
  ensure(handgunOptions[0]?.damage === "1d10", "攻击伤害应取武器卡 damage");
  ensure(handgunOptions[0]?.weaponName === "测试手枪", "攻击选项应保留武器名称");
  ensure(handgunOptions[0]?.source === "WEAPON", "武器攻击来源应为 WEAPON");

  const shotgunOptions = attackOptionsForParticipant(coc, cocPlayer, [
    { name: "猎枪", stats: { range: "FAR", damage: "4D6/2D6/1D6" } }
  ]);
  ensure(shotgunOptions.length === 1, "多档伤害武器应生成一个攻击选项");
  ensure(shotgunOptions[0]?.damage === "4D6", "多档伤害应取第一个可解析档位");

  const unarmedOptions = attackOptionsForParticipant(coc, cocPlayer, []);
  ensure(unarmedOptions.length === 1, "无武器时应有徒手攻击选项");
  ensure(unarmedOptions[0]?.skillId === "FIGHTING_BRAWL", "无武器时攻击技能应为斗殴");
  ensure(unarmedOptions[0]?.damage === "1d3+db", "COC7 徒手伤害应为 1d3+db");
  ensure(unarmedOptions[0]?.weaponName === "徒手", "无武器时应标记为徒手");

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

  const cocCivilian = {
    id: "coc-civilian",
    kind: "PLAYER" as const,
    characterId: null,
    skills: {}
  };
  const civilianAttack = allowedAttackSkills(coc, cocCivilian, []);
  expectIds(civilianAttack, ["FIGHTING_BRAWL"], "COC7 角色即使卡面没写也应拥有斗殴基础值");

  const cocNpcNoSkill = {
    id: "coc-npc-no-skill",
    kind: "NPC" as const,
    characterId: null,
    skills: {}
  };
  expectIds(
    allowedAttackSkills(coc, cocNpcNoSkill, []),
    ["FIGHTING_BRAWL"],
    "COC7 NPC 卡面没写战斗技能时也应有斗殴基础值"
  );

  const counterSkills = new Map<string, readonly string[]>([
    ["coc-civilian", civilianAttack],
    ["coc-no-base", []]
  ]);
  expectIds(
    [...allowedReactionTypesForParticipant(coc, counterSkills, "coc-civilian")],
    ["PASS", "DODGE", "COUNTER"],
    "COC7 有斗殴基础值的单位应下发反击选项"
  );
  expectIds(
    [...allowedReactionTypesForParticipant(coc, counterSkills, "coc-no-base")],
    ["PASS", "DODGE"],
    "COC7 没有实际格斗攻击选项时不应下发反击"
  );
  expectIds(
    [...allowedReactionTypesForParticipant(touhou, new Map([["touhou-no-skill", []]]), "touhou-no-skill")],
    ["PASS", "DEFEND", "DODGE"],
    "东方包没有对应攻击技能时才隐藏消弹对抗"
  );
  expectIds(
    [...allowedReactionTypesForParticipant(coc, counterSkills, "coc-civilian", false, "FIGHTING_BRAWL")],
    ["PASS", "DODGE", "COUNTER"],
    "COC7 近战攻击允许被反击"
  );
  expectIds(
    [...allowedReactionTypesForParticipant(coc, counterSkills, "coc-civilian", false, "FIREARMS_HANDGUN")],
    ["PASS", "SEEK_COVER"],
    "COC7 射击攻击不能闪避/反击，只能寻找掩体"
  );
  expectIds(
    [...reactionTypesForAttack(allowedReactionTypes(coc), "THROW", "COC7")],
    ["PASS", "SEEK_COVER"],
    "COC7 投掷类远程攻击不能闪避/反击，只能寻找掩体"
  );
  expectIds(
    [...reactionTypesForAttack(allowedReactionTypes(coc), "FIGHTING_AXE", "COC7")],
    ["PASS", "DODGE", "COUNTER"],
    "COC7 近战武器仍允许被反击"
  );
  const swordOptions = attackOptionsForParticipant(coc, cocPlayer, [
    { name: "长剑", stats: { range: "MELEE" } }
  ]);
  ensure(swordOptions[0]?.skillId === "格斗（剑）", "COC7 剑应映射到格斗（剑）专精");
  const shotgunBands = attackOptionsForParticipant(coc, cocPlayer, [
    { name: "霰弹枪", stats: { range: "FAR", damage: "4D6/2D6/1D6" } }
  ]);
  ensure((shotgunBands[0]?.damageBands.length ?? 0) === 3, "霰弹枪应拆出三个距离档");
  ensure(shotgunBands[0]?.damageType === "NONE", "霰弹枪伤害类型应为不可贯穿");

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

  // 14.5 遮挡：完整遮挡物中的单位不能攻击他人。
  const touhouDpContext = {
    pack: touhou,
    state: {
      participants: [
        { id: "touhou-pc", defeated: false, faction: "PC", cover: { hp: 10, blocksLineOfSight: true } },
        { id: "touhou-npc", defeated: false, faction: "BOSS" }
      ]
    },
    attackSkills: new Map<string, readonly string[]>([["touhou-pc", ["DANMAKU"]]])
  };
  const coveredError = validateCombatAction(touhouDpContext, {
    actorId: "touhou-pc",
    kind: "DANMAKU",
    dpAction: "RANGED",
    targetId: "touhou-npc",
    skill: "DANMAKU",
    damage: "1d6"
  });
  ensure(coveredError === "在遮挡物中无法攻击他人", "完整遮挡中应禁止攻击他人，实际 " + String(coveredError));

  const freeContext = {
    ...touhouDpContext,
    state: {
      participants: [
        { id: "touhou-pc", defeated: false, faction: "PC", cover: null },
        { id: "touhou-npc", defeated: false, faction: "BOSS" }
      ]
    }
  };
  const freeError = validateCombatAction(freeContext, {
    actorId: "touhou-pc",
    kind: "DANMAKU",
    dpAction: "RANGED",
    targetId: "touhou-npc",
    skill: "DANMAKU",
    damage: "1d6"
  });
  ensure(freeError === null, "无遮挡时应允许射击，实际 " + String(freeError));

  // 魔法战斗系法术：种类匹配、灵力校验。
  const battleSpellContext = {
    ...freeContext,
    pack: touhouMagic,
    state: {
      participants: [
        { id: "touhou-pc", defeated: false, faction: "PC", cover: null, mp: 100 },
        { id: "touhou-npc", defeated: false, faction: "BOSS" }
      ]
    }
  };
  const laserError = validateCombatAction(battleSpellContext, {
    actorId: "touhou-pc",
    kind: "DANMAKU",
    dpAction: "RANGED",
    targetId: "touhou-npc",
    skill: "DANMAKU",
    damage: "1d6",
    attackSpellId: "MAGIC_LASER"
  });
  ensure(laserError === null, "光束应允许用于射击，实际 " + String(laserError));
  const mismatchError = validateCombatAction(battleSpellContext, {
    actorId: "touhou-pc",
    kind: "DANMAKU",
    dpAction: "RANGED",
    targetId: "touhou-npc",
    skill: "DANMAKU",
    damage: "1d6",
    attackSpellId: "MAGIC_NAPALM"
  });
  ensure(mismatchError === "这个战斗法术不能用于当前行动", "燃烧弹不能用于射击，实际 " + String(mismatchError));
  const poorContext = {
    ...battleSpellContext,
    state: {
      participants: [
        { id: "touhou-pc", defeated: false, faction: "PC", cover: null, mp: 1 },
        { id: "touhou-npc", defeated: false, faction: "BOSS" }
      ]
    }
  };
  const poorError = validateCombatAction(poorContext, {
    actorId: "touhou-pc",
    kind: "DANMAKU",
    dpAction: "RANGED",
    targetId: "touhou-npc",
    skill: "DANMAKU",
    damage: "1d6",
    attackSpellId: "MAGIC_LASER"
  });
  ensure(poorError === "灵力不足，无法发动这个战斗法术", "灵力不足应被拦截，实际 " + String(poorError));

  console.log("PASS 战斗选项：COC7 反击=斗殴基础值、闪避与无防御、武器限制、非战斗技能过滤、东方事件开关、服务端行动校验、遮挡禁攻");
}

main();
