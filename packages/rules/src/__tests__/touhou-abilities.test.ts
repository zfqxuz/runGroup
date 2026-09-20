import { describe, expect, it } from "vitest";
import {
  abilityCategoryAllowedForRace,
  abilityCategoryLevelFromLevels,
  abilityCostForLevel,
  abilityDefinitionSpendTotal,
  abilityDefinitionStepCost,
  abilityDefinitionTotalCost,
  abilityLevelForPoints,
  abilityPointBudget,
  abilitySpellCountIssue,
  abilitySpendTotal,
  abilityTotalCost,
  collectAbilityPassiveMods,
  effectiveAbilityLevels,
  resolveAbilityCategory,
  resolveAbilityVariant,
  splitAbilityInstanceId,
  splitAbilityVariantId,
  validateAbilitySpend,
  compileParsedRulePack,
  resolveRulePack
} from "../index";
import type { AbilityRules } from "../index";
import { builtinRegistry } from "../packs";

const registry = builtinRegistry();
const touhouPack = resolveRulePack("touhou-ext", registry);
const coc7Pack = resolveRulePack("coc7-baseline", registry);
const touhou = compileParsedRulePack(touhouPack);

describe("千幻抄能力类别与消费表", () => {
  it("TOUHOU 包启用能力体系并登记六类能力（含妖力）", () => {
    expect(touhouPack.abilities.enabled).toBe(true);
    expect(Object.keys(touhouPack.abilities.categories).sort()).toEqual(
      ["ELEMENTALIST", "FEAT", "MAGIC", "SPIRIT_ARTS", "YOUJUTSU", "YOURIKI"].sort()
    );
  });

  it("神术 / 魔法 / 属性使 / 妖术 / 妖力 / 特技使用各自消费表", () => {
    expect(touhouPack.abilities.categories.SPIRIT_ARTS?.costTable).toEqual([5, 10, 15, 20, 25, 25]);
    expect(touhouPack.abilities.categories.MAGIC?.costTable).toEqual([5, 10, 15, 20, 25, 25]);
    expect(touhouPack.abilities.categories.ELEMENTALIST?.costTable).toEqual([4, 8, 12, 16, 20, 20]);
    expect(touhouPack.abilities.categories.YOUJUTSU?.costTable).toEqual([1, 2, 4, 6, 8, 10, 12, 12]);
    expect(touhouPack.abilities.categories.YOURIKI?.costTable).toEqual([1, 2, 4, 6, 8, 10, 12, 12]);
    expect(touhouPack.abilities.categories.FEAT?.costTable).toEqual([1, 2, 4, 6, 8, 10, 12, 12]);
  });

  it("COC7 基线不启用能力体系", () => {
    expect(coc7Pack.abilities.enabled).toBe(false);
    expect(Object.keys(coc7Pack.abilities.categories)).toHaveLength(0);
  });

  it("车卡能力点为 A/B/C/D = 30/25/20/15", () => {
    expect(abilityPointBudget(touhouPack.abilities, "A")).toBe(30);
    expect(abilityPointBudget(touhouPack.abilities, "B")).toBe(25);
    expect(abilityPointBudget(touhouPack.abilities, "C")).toBe(20);
    expect(abilityPointBudget(touhouPack.abilities, "D")).toBe(15);
    expect(abilityPointBudget(touhouPack.abilities, "X")).toBeNull();
  });

  it("能力点花费校验：超支 / 未知类别 / 通过", () => {
    // 神术 5+10=15，妖术 1+2=3，合计 18
    const levels = { SPIRIT_ARTS: 2, YOUJUTSU: 2 };
    expect(abilitySpendTotal(touhouPack.abilities, levels)).toBe(18);
    // A 级预算 30，18 点通过；D 级预算 15，18 点超支。
    expect(validateAbilitySpend(touhouPack.abilities, "A", levels).ok).toBe(true);
    expect(validateAbilitySpend(touhouPack.abilities, "D", levels).ok).toBe(false);
    // 神术 5+10+15 = 30，D 级 15 点超支。
    expect(validateAbilitySpend(touhouPack.abilities, "D", { SPIRIT_ARTS: 3 }).ok).toBe(false);
    const unknown = validateAbilitySpend(touhouPack.abilities, "A", { NOT_A_CATEGORY: 1 });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain("未知能力类别");
  });

  it("补齐了〈抵抗〉技能，供抵抗判定使用", () => {
    expect(touhouPack.skills.some((skill) => skill.id === "RESIST")).toBe(true);
    expect(touhou.skills.some((skill) => skill.id === "RESIST")).toBe(true);
  });
});

describe("能力消费表计算", () => {
  const spirit = touhouPack.abilities.categories.SPIRIT_ARTS;

  it("逐级消费：第 n 级取 costTable[n-1]，超出表长固定最后一档", () => {
    if (spirit === undefined) throw new Error("缺少 SPIRIT_ARTS");
    expect(abilityCostForLevel(spirit, 1)).toBe(5);
    expect(abilityCostForLevel(spirit, 2)).toBe(10);
    expect(abilityCostForLevel(spirit, 5)).toBe(25);
    expect(abilityCostForLevel(spirit, 6)).toBe(25);
    expect(abilityCostForLevel(spirit, 9)).toBe(25);
    expect(abilityCostForLevel(spirit, 0)).toBe(0);
  });

  it("累计消费与按点数反推等级", () => {
    if (spirit === undefined) throw new Error("缺少 SPIRIT_ARTS");
    expect(abilityTotalCost(spirit, 3)).toBe(30);
    expect(abilityLevelForPoints(spirit, 30)).toBe(3);
    expect(abilityLevelForPoints(spirit, 29)).toBe(2);
    expect(abilityLevelForPoints(spirit, 0)).toBe(0);
  });

  it("按每级习得上限校验法术数量", () => {
    if (spirit === undefined) throw new Error("缺少 SPIRIT_ARTS");
    // 神术每级 2 个：Lv2 最多 4 个
    expect(abilitySpellCountIssue(spirit, 2, 4)).toBeNull();
    expect(abilitySpellCountIssue(spirit, 2, 5)).toContain("最多习得 4 个法术");
    const elementalist = touhouPack.abilities.categories.ELEMENTALIST;
    if (elementalist === undefined) throw new Error("缺少 ELEMENTALIST");
    // 0 表示不限
    expect(abilitySpellCountIssue(elementalist, 3, 999)).toBeNull();
  });
});

describe("能力实例 id（属性使每种属性独立）", () => {
  it("splitAbilityInstanceId 拆分 CATEGORY:SUFFIX", () => {
    expect(splitAbilityInstanceId("ELEMENTALIST:FIRE")).toEqual({ categoryId: "ELEMENTALIST", suffix: "FIRE" });
    expect(splitAbilityInstanceId("SPIRIT_ARTS")).toEqual({ categoryId: "SPIRIT_ARTS", suffix: null });
  });

  it("resolveAbilityCategory 精确匹配优先，再退回前缀类别", () => {
    const rules = touhouPack.abilities;
    expect(resolveAbilityCategory(rules, "SPIRIT_ARTS")?.id).toBe("SPIRIT_ARTS");
    expect(resolveAbilityCategory(rules, "ELEMENTALIST:FIRE")?.id).toBe("ELEMENTALIST");
    expect(resolveAbilityCategory(rules, "NOPE:FIRE")).toBeUndefined();
  });

  it("能力点按实例累计消费", () => {
    const rules = touhouPack.abilities;
    // 属性使 4/8/12：FIRE Lv2 = 12，WATER Lv1 = 4，合计 16
    expect(abilitySpendTotal(rules, { "ELEMENTALIST:FIRE": 2, "ELEMENTALIST:WATER": 1 })).toBe(16);
    expect(validateAbilitySpend(rules, "C", { "ELEMENTALIST:FIRE": 2, "ELEMENTALIST:WATER": 1 }).ok).toBe(true);
  });
});

describe("能力变体（术式版 / 妖弹化）", () => {
  it("splitAbilityVariantId 拆分 CATEGORY#VARIANT", () => {
    expect(splitAbilityVariantId("SPIRIT_ARTS#UTSUSHI")).toEqual({
      baseId: "SPIRIT_ARTS",
      variantId: "UTSUSHI"
    });
    expect(splitAbilityVariantId("ELEMENTALIST:FIRE")).toEqual({
      baseId: "ELEMENTALIST:FIRE",
      variantId: null
    });
  });

  it("神术术式版消费更低（3/6/9/12/15/15）并限制射击 / 追击 / 弹幕", () => {
    const spirit = touhouPack.abilities.categories.SPIRIT_ARTS;
    if (spirit === undefined) throw new Error("缺少 SPIRIT_ARTS");
    expect(abilityCostForLevel(spirit, 1, "UTSUSHI")).toBe(3);
    expect(abilityCostForLevel(spirit, 2, "UTSUSHI")).toBe(6);
    expect(abilityTotalCost(spirit, 3, "UTSUSHI")).toBe(18);
    const variant = touhouPack.abilities.categories.SPIRIT_ARTS?.variants.UTSUSHI;
    expect(variant?.restrictedAttackKinds).toEqual(["RANGED", "CHASE", "DANMAKU"]);
    expect(resolveAbilityVariant(touhouPack.abilities, "SPIRIT_ARTS#UTSUSHI")?.id).toBe("UTSUSHI");
  });

  it("变体消费计入能力点总花费，未知变体被拦截", () => {
    const rules = touhouPack.abilities;
    // 术式版 3+6 = 9
    expect(abilitySpendTotal(rules, { "SPIRIT_ARTS#UTSUSHI": 2 })).toBe(9);
    expect(validateAbilitySpend(rules, "C", { "SPIRIT_ARTS#UTSUSHI": 2 }).ok).toBe(true);
    const bad = validateAbilitySpend(rules, "C", { "SPIRIT_ARTS#NOPE": 1 });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("未知能力类别");
  });

  it("妖弹化消费表 2/3/5/7/9/11/13（Lv8 起 13）", () => {
    expect(touhouPack.abilities.categories.YOUJUTSU?.variants.DANMAKU?.costTable).toEqual([2, 3, 5, 7, 9, 11, 13]);
  });
});

describe("种族免费能力与限制", () => {
  it("妖怪免费 3 级妖术，effectiveAbilityLevels 取较高者", () => {
    const youkai = touhouPack.races.YOUKAI;
    if (youkai === undefined) throw new Error("缺少 YOUKAI");
    expect(youkai.freeAbilityLevels.YOUJUTSU).toBe(3);
    const merged = effectiveAbilityLevels({ YOUJUTSU: 1 }, youkai);
    expect(merged.YOUJUTSU).toBe(3);
    const learnedMore = effectiveAbilityLevels({ YOUJUTSU: 5 }, youkai);
    expect(learnedMore.YOUJUTSU).toBe(5);
  });

  it("人类不能学妖力 / 妖术，属性使组合为例外", () => {
    const human = touhouPack.races.HUMAN;
    if (human === undefined) throw new Error("缺少 HUMAN");
    expect(abilityCategoryAllowedForRace(human, "YOUJUTSU")).toBe(false);
    expect(abilityCategoryAllowedForRace(human, "YOURIKI")).toBe(false);
    expect(abilityCategoryAllowedForRace(human, "ELEMENTALIST")).toBe(true);
    const check = validateAbilitySpend(touhouPack.abilities, "C", { YOUJUTSU: 1 }, { race: human });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("不能习得");
    // KP 可用属性使组合例外放行。
    expect(
      validateAbilitySpend(touhouPack.abilities, "C", { YOUJUTSU: 1 }, {
        race: human,
        allowElementalistException: true
      }).ok
    ).toBe(true);
  });

  it("abilityCategoryLevelFromLevels 汇总同类别实例（含变体）取最高", () => {
    expect(abilityCategoryLevelFromLevels({ "ELEMENTALIST:FIRE": 2, "ELEMENTALIST:WATER": 3 }, "ELEMENTALIST")).toBe(3);
    expect(abilityCategoryLevelFromLevels({ "SPIRIT_ARTS#UTSUSHI": 4, SPIRIT_ARTS: 1 }, "SPIRIT_ARTS")).toBe(4);
  });
});

describe("常时被动层（妖力 / 特技）", () => {
  const rules: AbilityRules = {
    ...touhouPack.abilities,
    definitions: {
      TOUGH: {
        id: "TOUGH",
        name: "强韧",
        categoryId: "FEAT",
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
            movementBonus: "abilityLv > 2 ? 1 : 0",
            grazeBonusPer: 0,
            danmakuDpReduction: 0,
            danmakuDamageReduction: 0,
            damageDice: "0",
            danmakuDamageBonus: "0"
          }
        ]
      },
      HIGH_FEAT: {
        id: "HIGH_FEAT",
        name: "高级特技",
        categoryId: "FEAT",
        kind: "PASSIVE",
        minLevel: 4,
        tags: [],
        spellIds: [],
        passives: [
          {
            attributeMods: {},
            skillMods: {},
            derivedMods: {},
            damageBonus: "10",
            reactionBonus: "0",
            accuracyBonus: "0",
            movementBonus: "0",
            grazeBonusPer: 0,
            danmakuDpReduction: 0,
            danmakuDamageReduction: 0,
            damageDice: "0",
            danmakuDamageBonus: "0"
          }
        ]
      },
      ACTIVE_ONLY: {
        id: "ACTIVE_ONLY",
        name: "主动能力",
        categoryId: "FEAT",
        kind: "ACTIVE",
        minLevel: 1,
        tags: [],
        spellIds: [],
        passives: [
          {
            attributeMods: { str: "99" },
            skillMods: {},
            derivedMods: {},
            damageBonus: "0",
            reactionBonus: "0",
            accuracyBonus: "0",
            movementBonus: "0",
            grazeBonusPer: 0,
            danmakuDpReduction: 0,
            danmakuDamageReduction: 0,
            damageDice: "0",
            danmakuDamageBonus: "0"
          }
        ]
      }
    }
  };

  it("按能力等级求值并累加属性 / 技能 / 衍生 / 战斗加值", () => {
    const mods = collectAbilityPassiveMods(rules, {
      abilityLevels: { FEAT: 3 },
      definitionIds: ["TOUGH"]
    });
    expect(mods.attributeMods.con).toBe(3);
    expect(mods.skillMods.DODGE).toBe(2);
    expect(mods.derivedMods.maxHp).toBe(6);
    expect(mods.damageBonus).toBe(3);
    expect(mods.reactionBonus).toBe(1);
    expect(mods.movementBonus).toBe(1);
    expect(mods.sources).toEqual(["TOUGH"]);
  });

  it("等级不足不生效，ACTIVE 条目不进入常时层", () => {
    const mods = collectAbilityPassiveMods(rules, {
      abilityLevels: { FEAT: 3 },
      definitionIds: ["HIGH_FEAT", "ACTIVE_ONLY", "NOT_EXIST"]
    });
    expect(mods.damageBonus).toBe(0);
    expect(mods.attributeMods.str).toBeUndefined();
  });

  it("多个已解锁条目的同类修正累加（高于 minLevel 时全部生效）", () => {
    const mods = collectAbilityPassiveMods(rules, {
      abilityLevels: { FEAT: 4 },
      definitionIds: ["TOUGH", "HIGH_FEAT"]
    });
    // TOUGH: abilityLv=4 -> +4；HIGH_FEAT: +10
    expect(mods.damageBonus).toBe(14);
  });
});

describe("妖力 / 特技列表定义与消费（wiki）", () => {
  it("东方包登记 19 个定义，含固定消费与逐级消费", () => {
    const defs = touhouPack.abilities.definitions;
    expect(Object.keys(defs).length).toBe(19);
    expect(defs.YOURIKI_ANIMAL_TALK?.cost).toBe(4);
    expect(defs.YOURIKI_AQUATIC?.cost).toBe(2);
    expect(defs.FEAT_SMALL_HITBOX?.cost).toBe(8);
    expect(defs.FEAT_HIGH_SPEED_FLIGHT?.costPerLevel).toBe("2");
  });

  it("固定消费与小步逐级消费计算", () => {
    const talk = touhouPack.abilities.definitions.YOURIKI_ANIMAL_TALK;
    const flight = touhouPack.abilities.definitions.FEAT_HIGH_SPEED_FLIGHT;
    const qigong = touhouPack.abilities.definitions.FEAT_QIGONG;
    if (talk === undefined || flight === undefined || qigong === undefined) throw new Error("缺少定义");
    expect(abilityDefinitionTotalCost(talk, 1)).toBe(4);
    expect(abilityDefinitionTotalCost(flight, 2)).toBe(4);
    expect(abilityDefinitionStepCost(flight, 2)).toBe(2);
    // 气功：升到 Lv2 需 5 + 10 = 15
    expect(abilityDefinitionTotalCost(qigong, 2)).toBe(15);
  });

  it("定义消费计入能力点总预算", () => {
    const rules = touhouPack.abilities;
    const defs = { YOURIKI_ANIMAL_TALK: 1, FEAT_HIGH_SPEED_FLIGHT: 2 };
    expect(abilityDefinitionSpendTotal(rules, defs)).toBe(8);
    expect(validateAbilitySpend(rules, "C", {}, { definitionLevels: defs }).ok).toBe(true);
    // D 级 15 点：使魔 15 + 动物交谈 4 = 19 超支
    const over = { FEAT_FAMILIAR: 1, YOURIKI_ANIMAL_TALK: 1 };
    expect(validateAbilitySpend(rules, "D", {}, { definitionLevels: over }).ok).toBe(false);
  });

  it("高速飞行 / 擦弹判定大带有可自动化的常时被动", () => {
    const flight = touhouPack.abilities.definitions.FEAT_HIGH_SPEED_FLIGHT;
    const graze = touhouPack.abilities.definitions.FEAT_WIDE_GRAZE;
    expect(flight?.passives[0]?.movementBonus).toBe("abilityLv");
    expect(graze?.passives[0]?.grazeBonusPer).toBe(3);
    const smallHitbox = touhouPack.abilities.definitions.FEAT_SMALL_HITBOX;
    expect(smallHitbox?.passives[0]?.danmakuDpReduction).toBe(1);
    expect(smallHitbox?.passives[0]?.danmakuDamageReduction).toBe(1);
    const qigong = touhouPack.abilities.definitions.FEAT_QIGONG;
    expect(qigong?.passives[0]?.damageDice).toBe("abilityLv");
    expect(qigong?.passives[0]?.danmakuDamageBonus).toBe("abilityLv");
  });
});
