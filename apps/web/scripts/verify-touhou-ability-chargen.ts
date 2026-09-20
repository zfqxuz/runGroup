/**
 * 东方能力点车卡回归：验证 CharacterBuilder 依赖的规则包字段与消费表计算。
 * 运行：npx tsx --env-file=.env scripts/verify-touhou-ability-chargen.ts
 */
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import {
  abilityCategoryAllowedForRace,
  abilityCategoryLevelFromLevels,
  abilityCostForLevel,
  abilityPointBudget,
  abilitySpellCountIssue,
  abilitySpendTotal,
  abilityTotalCost,
  collectAbilityPassiveMods,
  effectiveAbilityLevels,
  validateAbilitySpend,
  type AbilityRules
} from "@touhou/rules";

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("能力车卡断言失败：" + message);
}

function main(): void {
  const pack = resolveRulePack("touhou-ext", builtinRegistry());
  const abilities = pack.abilities;
  ensure(abilities.enabled === true, "东方包应启用能力");
  const categories = Object.values(abilities.categories);
  ensure(categories.length === 6, "东方包应有 6 类能力（含妖力），实际 " + categories.length);
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

  // 术式版神术变体：消费 3/6/9…，并限制射击 / 追击 / 弹幕。
  ensure(abilityCostForLevel(spirit, 1, "UTSUSHI") === 3, "术式版 Lv1 应花 3 点");
  ensure(abilityTotalCost(spirit, 3, "UTSUSHI") === 18, "术式版 Lv3 累计应为 18");
  ensure(
    (spirit.variants.UTSUSHI?.restrictedAttackKinds ?? []).join(",") === "RANGED,CHASE,DANMAKU",
    "术式版应限制射击 / 追击 / 弹幕"
  );
  ensure(abilitySpendTotal(abilities, { "SPIRIT_ARTS#UTSUSHI": 2 }) === 9, "术式版累计消费应为 9");

  // 每级习得法术数量校验：神术每级 2 个。
  ensure(abilitySpellCountIssue(spirit, 2, 4) === null, "神术 Lv2 学 4 个应合法");
  ensure(abilitySpellCountIssue(spirit, 2, 5) !== null, "神术 Lv2 学 5 个应超限");

  // 种族：妖怪免费 3 级妖术；人类禁止妖力 / 妖术。
  const youkai = pack.races.YOUKAI;
  const human = pack.races.HUMAN;
  ensure(youkai !== undefined && human !== undefined, "缺少妖怪 / 人类种族");
  if (youkai !== undefined && human !== undefined) {
    ensure(effectiveAbilityLevels({}, youkai).YOUJUTSU === 3, "妖怪应免费获得 3 级妖术");
    ensure(abilityCategoryAllowedForRace(human, "YOUJUTSU") === false, "人类不应能学妖术");
    ensure(
      validateAbilitySpend(abilities, "C", { YOUJUTSU: 1 }, { race: human }).ok === false,
      "人类学妖术应被拦截"
    );
    ensure(
      abilityCategoryLevelFromLevels({ "SPIRIT_ARTS#UTSUSHI": 4 }, "SPIRIT_ARTS") === 4,
      "变体等级应计入类别等级"
    );
  }

  // 常时被动层：用合成条目验证属性 / 技能 / 衍生 / 战斗加值求值。
  const passiveRules: AbilityRules = {
    ...abilities,
    definitions: {
      REGEN: {
        id: "REGEN",
        name: "常时再生",
        categoryId: "YOURIKI",
        kind: "PASSIVE",
        minLevel: 1,
        tags: [],
        spellIds: [],
        passives: [
          {
            attributeMods: { con: "abilityLv" },
            skillMods: { DODGE: "2" },
            derivedMods: { maxHp: "abilityLv * 2" },
            damageBonus: "abilityLv",
            reactionBonus: "1",
            accuracyBonus: "0",
            movementBonus: "0",
            grazeBonusPer: 0
          }
        ]
      }
    }
  };
  const mods = collectAbilityPassiveMods(passiveRules, {
    abilityLevels: { YOURIKI: 3 },
    definitionIds: ["REGEN"]
  });
  ensure(mods.attributeMods.con === 3, "被动应给 CON +3");
  ensure(mods.skillMods.DODGE === 2, "被动应给回避 +2");
  ensure(mods.derivedMods.maxHp === 6, "被动应给 maxHp +6");
  ensure(mods.damageBonus === 3, "被动应给伤害 +3");

  // wiki 妖力 / 特技列表：固定消费与逐级消费。
  ensure(Object.keys(abilities.definitions).length === 19, "应登记 19 个妖力 / 特技定义");
  ensure(abilities.definitions.YOURIKI_ANIMAL_TALK?.cost === 4, "动物交谈应消费 4 点");
  ensure(abilities.definitions.FEAT_HIGH_SPEED_FLIGHT?.costPerLevel === "2", "高速飞行应为每级 2 点");
  ensure(
    abilities.definitions.FEAT_WIDE_GRAZE?.passives[0]?.grazeBonusPer === 3,
    "擦弹判定大应每 3 点擦弹额外 +1"
  );

  console.log(
    "PASS 东方能力点车卡：6 类能力 / A-D 预算 / 变体消费表 / 属性使实例 / 法术数量 / 种族免费与限制 / 常时被动 / 妖力特技列表"
  );
}

main();
