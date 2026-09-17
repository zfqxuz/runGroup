/**
 * 通用实体归一化 / 合并 / 武器伤害回填回归。
 *
 * 全部使用合成数据，不依赖任何具体团本。
 *
 * 运行：npm run verify:entity-normalization --workspace @touhou/web
 */
import { builtinRegistry, compileRulePack, resolveRulePack } from "@touhou/rules";
import { normalizeEntityKey } from "@/server/modules/keys";
import { mergeDraft } from "@/server/ai/chunking";
import { enrichItemDamageFromSources } from "@/server/ai/item-damage";
import { enrichNpcStatsFromSources, parseNpcStatsText } from "@/server/ai/npc-stats";
import { dedupeNpcRecords, mergeNpcAliasNames, npcRecordsLikelySame } from "@/server/ai/npc-dedupe";
import { armorExpressionFromText, armorExpressionFromValue } from "@/server/combat/armor";
import { buildNpcDamageOverrides, normalizedSkills, normalizedWeapons } from "@/server/modules/templates";

let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) console.log("PASS " + label);
  else {
    failed += 1;
    console.error("FAIL " + label);
  }
}

// ---------- 1. Unicode sourceKey ----------
const keys = {
  npc: normalizeEntityKey("npc-测试角色", "fallback"),
  otherNpc: normalizeEntityKey("npc-另一个角色", "fallback"),
  item: normalizeEntityKey("item-测试道具", "fallback"),
  ascii: normalizeEntityKey("item-liber-ivonis", "fallback")
};
check(keys.npc !== keys.otherNpc, "不同中文实体的 sourceKey 必须不同");
check(keys.item !== "item" && keys.item.includes("测试道具"), "中文 item sourceKey 必须保留中文");
check(keys.ascii === "item-liber-ivonis", "ASCII sourceKey 保持不变");

// ---------- 2. 通用别名合并 ----------
const base = { title: "测试团本", system: "COC7" as const, era: "MODERN", author: "tester", validImagePaths: new Set<string>() };
const merged = mergeDraft({
  ...base,
  images: [],
  extractions: [
    { label: "a", meta: {}, sections: {}, structured: { items: [{ id: "item-red-orb", name: "红色宝珠", aliases: ["宝珠"], itemType: "ARTIFACT", damage: "2d6" }] } },
    { label: "b", meta: {}, sections: {}, structured: { items: [{ id: "item-orb", name: "宝珠", aliases: [], itemType: "ARTIFACT" }] } }
  ]
});
const mergedItems = merged.structured.item ?? [];
check(mergedItems.length === 1, "同一实体的不同名称/别名应合并为一条");
check(JSON.stringify(mergedItems[0]?.aliases ?? []).includes("宝珠"), "合并后应保留别名");

const separate = mergeDraft({
  ...base,
  images: [],
  extractions: [
    { label: "a", meta: {}, sections: {}, structured: { items: [{ id: "item-a", name: "铁剑", aliases: [], itemType: "WEAPON", damage: "1d8" }] } },
    { label: "b", meta: {}, sections: {}, structured: { items: [{ id: "item-b", name: "银剑", aliases: [], itemType: "WEAPON", damage: "1d8" }] } }
  ]
});
check((separate.structured.item ?? []).length === 2, "无包含/别名关系的实体不能误合并");

// ---------- 3. 武器伤害从物品回填 ----------
const pack = compileRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));
const warnings: string[] = [];
const overrides = buildNpcDamageOverrides([
  { kind: "item", id: "item-staff", title: "浮空法杖", data: { id: "item-staff", name: "浮空法杖", aliases: ["法杖"], itemType: "ARTIFACT", damage: "2d6" } },
  { kind: "item", id: "item-blade", title: "普通匕首", data: { id: "item-blade", name: "普通匕首", aliases: [], itemType: "WEAPON", damage: "1d4" } }
]);
const weapons = normalizedWeapons(
  [
    { name: "浮空魔法法杖", damage: "1d4", range: "MELEE" },
    { name: "普通匕首", damage: "1d4", range: "MELEE" },
    { name: "肉搏攻击", damage: "1d3+db", range: "MELEE" }
  ],
  pack as never,
  warnings,
  "测试 NPC",
  overrides
);
const staff = weapons.find((weapon) => weapon.name === "浮空魔法法杖");
const dagger = weapons.find((weapon) => weapon.name === "普通匕首");
const brawl = weapons.find((weapon) => weapon.name === "肉搏攻击");
check(staff?.damage === "2d6", "共享中文二字的武器应从物品回填伤害");
check(dagger?.damage === "1d4", "直接同名的武器应使用物品伤害");
check(brawl?.damage === "1d3+db", "没有对应物品的武器不应被误覆盖");

// ---------- 4. NPC 身份去重：别名污染不能误合并 ----------
const polluted = npcRecordsLikelySame(
  { name: "加布里埃尔·马卡里奥", aliases: ["特蕾莎", "可悲的小女孩"] },
  { name: "特蕾莎·马卡里奥，可悲的小女孩" }
);
check(polluted === false, "共享姓氏 + 被污染的短别名不能误合并 NPC");
const sameNpc = npcRecordsLikelySame({ name: "测试者" }, { name: "测试者（首领）" });
check(sameNpc === true, "同一 NPC 的括号别名应合并");
const nicknameMerged = npcRecordsLikelySame(
  { name: "W·测试者" },
  { name: "沃尔特·测试者，不死的测试者", aliases: ["测试者"] }
);
check(nicknameMerged === true, "带首字母缩写的昵称应通过显式别名精确合并到主 NPC");
const honorificMerged = npcRecordsLikelySame(
  { name: "老测试者" },
  { name: "沃尔特·测试者，不死的测试者", aliases: ["测试者"] }
);
check(honorificMerged === true, "带年龄前缀的昵称应通过显式别名精确合并到主 NPC");
const ghostSeparate = npcRecordsLikelySame({ name: "W·测试者" }, { name: "测试者的鬼魂" });
check(ghostSeparate === false, "描述性称呼不能与昵称误合并");
const clustered = dedupeNpcRecords([
  { name: "W·测试者", aliases: ["测试者的鬼魂"] },
  { name: "老测试者" },
  { name: "沃尔特·测试者，不死的测试者", aliases: ["测试者"] },
  { name: "测试者的鬼魂" }
]);
check(clustered.length === 2, "昵称变体应合并进主 NPC，描述性实体保持独立");
const preservedArrays = dedupeNpcRecords([
  { name: "测试者", skillsFromText: [], weapons: [] },
  {
    name: "测试者",
    skillsFromText: [{ skill: "闪避", value: 17 }],
    weapons: [{ name: "匕首", damage: "1d4+2" }]
  }
]);
check(preservedArrays.length === 1, "同一 NPC 应合并为一条");
check(
  Array.isArray(preservedArrays[0]?.skillsFromText) && preservedArrays[0].skillsFromText.length === 1,
  "合并 NPC 时不能把 skillsFromText 对象数组丢成空"
);
check(
  Array.isArray(preservedArrays[0]?.weapons) && preservedArrays[0].weapons.length === 1,
  "合并 NPC 时不能把 weapons 对象数组丢成空"
);

// ---------- 5. 原文伤害回填 ----------
const itemEntries: Record<string, unknown>[] = [
  { name: "测试法器", aliases: ["法器"], itemType: "ARTIFACT", damage: "1d4" },
  { name: "普通物品", itemType: "ITEM" }
];
const fixed = enrichItemDamageFromSources(itemEntries, [
  { text: "测试法器浮空攻击。\n\n它造成 2D6 + 1 的伤害。\n\n再次造成 2D6 + 1 伤害。" }
]);
check(fixed === 1, "原文出现多次的伤害表达式应回填到物品");
check(itemEntries[0]?.damage === "2d6+1", "伤害表达式应归一化为 2d6+1");
check(itemEntries[1]?.damage === undefined, "非武器物品不应被强行补充伤害");

// ---------- 6. NPC 武器去重 ----------
const dedupedWeapons = normalizedWeapons(
  [
    { name: "浮空匕首", damage: "1d4+2", range: "MELEE" },
    { name: "浮空魔法匕首", damage: "1d3+db", range: "MELEE" }
  ],
  pack as never,
  warnings,
  "测试 NPC"
);
check(dedupedWeapons.length === 1, "名称高度相似的 NPC 武器应合并");
check(dedupedWeapons[0]?.damage === "1d4+2", "武器合并时应保留可解析的骰式伤害");

// ---------- 7. 技能百分比解析与优先级 ----------
const parsedStats = parseNpcStatsText(
  "测试 NPC\n\nSTR 50 CON 50 SIZ 50 DEX 50 APP 50 INT 50 POW 50 EDU 50\n战斗: 50% (困难25% / 极端10%)\n闪避 17%\n技能: 聆听 60%，潜行 90%"
);
const skillMap = new Map(parsedStats.skills.map((skill) => [skill.name, skill.value]));
check(skillMap.get("战斗") === 50, "应解析出「战斗 50%」");
check(skillMap.get("闪避") === 17, "应解析出「闪避 17%」");
check(skillMap.get("聆听") === 60 && skillMap.get("潜行") === 90, "应解析多技能百分比");
const mergedSkills = normalizedSkills(
  [{ skill: "FIGHTING_BRAWL", value: 25 }, { skill: "DODGE", value: 25 }],
  pack as never,
  warnings,
  "测试 NPC",
  [{ skill: "战斗", value: 50 }, { skill: "闪避", value: 17 }]
);
check(mergedSkills.FIGHTING_BRAWL === 50 && mergedSkills.DODGE === 17, "原文技能值应覆盖模型默认 25");

// ---------- 8. 幸运缺省值 ----------
const luckEntry: Record<string, unknown> = {
  name: "测试 NPC",
  attributes: { str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 10 },
  statText: "STR 50 CON 50 SIZ 50 DEX 50 APP 50 INT 50 POW 50 EDU 50\n战斗 50%"
};
enrichNpcStatsFromSources([luckEntry], [{ text: "测试 NPC\n\nSTR 50 CON 50 SIZ 50 DEX 50 APP 50 INT 50 POW 50 EDU 50\n战斗 50%" }]);
check((luckEntry.attributes as Record<string, unknown>).luck === 0, "原文没有幸运时应按 0 而不是模型值");

// ---------- 9. n8n 别名先合并，再按原文回填技能 ----------
const englishNamedNpc: Record<string, unknown> = { name: "Walter Tester", aliases: [] };
mergeNpcAliasNames(englishNamedNpc, ["沃尔特·测试者，不死的测试者", "测试者"]);
const aliasEnriched = enrichNpcStatsFromSources([englishNamedNpc], [{
  text: "沃尔特·测试者，不死的测试者\n\nSTR 90 CON 115 SIZ 55 DEX 35 APP 05 INT 80 POW 90 EDU 80\nHP: 16\nMP: 18\nSAN: 0\n战斗 50%\n闪避 17%"
}]);
check(aliasEnriched === 1, "n8n 别名合并后，英文名 NPC 应能命中原文窗口");
const textSkillMap = new Map(
  (Array.isArray(englishNamedNpc.skillsFromText) ? englishNamedNpc.skillsFromText : [])
    .filter((item): item is { skill: string; value: number } => {
      return item !== null && typeof item === "object" && typeof (item as { skill?: unknown }).skill === "string" && typeof (item as { value?: unknown }).value === "number";
    })
    .map((item) => [item.skill, item.value])
);
check(textSkillMap.get("闪避") === 17, "原文技能应在合并别名后写入 skillsFromText");

// ---------- 10. 通用护甲表达式解析 ----------
check(armorExpressionFromText("护甲: 2D6") === "2D6", "应解析「护甲: 2D6」");
check(armorExpressionFromText("获得 1D6 点防非魔法伤害的护甲") === "1D6", "应解析「1D6 点护甲」");
check(armorExpressionFromText("他将获得 2D6 的护甲") === "2D6", "应解析「获得 2D6 的护甲」");
check(
  armorExpressionFromValue({ weapons: [{ notes: "测试法术提供 2D6 护甲" }] }) === "2D6",
  "应从 NPC 卡任意嵌套字段解析护甲表达式"
);
check(armorExpressionFromValue({ armor: 3 }) === "3", "数字护甲字段应保留");
check(armorExpressionFromValue({ armor: "2D6" }) === "2D6", "裸护甲字段应保留骰式");
check(armorExpressionFromValue({ notes: "没有护甲信息" }) === null, "无护甲信息时返回 null");

if (failed > 0) {
  console.error("verify-entity-normalization: " + String(failed) + " failure(s)");
  process.exitCode = 1;
} else {
  console.log("verify-entity-normalization: all checks passed");
}
