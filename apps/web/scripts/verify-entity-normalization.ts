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
import { buildNpcDamageOverrides, normalizedWeapons } from "@/server/modules/templates";

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
  corbitt: normalizeEntityKey("npc-沃尔特-科比特", "fallback"),
  stephen: normalizeEntityKey("npc-史蒂芬-诺特", "fallback"),
  dagger: normalizeEntityKey("item-浮空匕首", "fallback"),
  ascii: normalizeEntityKey("item-liber-ivonis", "fallback")
};
check(keys.corbitt !== keys.stephen, "不同中文实体的 sourceKey 必须不同");
check(keys.dagger !== "item" && keys.dagger.includes("浮空匕首"), "中文 item sourceKey 必须保留中文");
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

if (failed > 0) {
  console.error("verify-entity-normalization: " + String(failed) + " failure(s)");
  process.exitCode = 1;
} else {
  console.log("verify-entity-normalization: all checks passed");
}
