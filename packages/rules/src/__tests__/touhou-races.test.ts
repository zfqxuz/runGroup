import { describe, expect, it } from "vitest";
import { applyDamagePipeline, compileParsedRulePack, resolveRulePack } from "../index";
import { builtinRegistry } from "../packs";

const registry = builtinRegistry();
const touhouPack = resolveRulePack("touhou-ext", registry);
const touhou = compileParsedRulePack(touhouPack);
const coc7 = compileParsedRulePack(resolveRulePack("coc7-baseline", registry));

describe("东方种族表（千幻抄）", () => {
  it("包含 wiki 的恶魔与怪异，并保留已实现的蓬莱人 / 半妖", () => {
    expect(Object.keys(touhouPack.races)).toEqual(
      expect.arrayContaining(["DEMON", "ABERRATION", "HOURAI", "HANYOU"])
    );
  });

  it("wiki 的 A-D 种族级别成员都已登记，并带对应级别", () => {
    // A: 吸血鬼·恶魔；B: 亡灵·天狗·妖怪·怪异；C: 魔法使·河童·付丧神·妖兽；D: 人类·妖精
    const expectedTiers: Record<string, "A" | "B" | "C" | "D"> = {
      VAMPIRE: "A", DEMON: "A",
      GHOST: "B", TENGU: "B", YOUKAI: "B", ABERRATION: "B",
      MAGICIAN: "C", KAPPA: "C", TSUKUMOGAMI: "C", BEAST: "C",
      HUMAN: "D", FAIRY: "D"
    };
    for (const [key, tier] of Object.entries(expectedTiers)) {
      expect(touhouPack.races[key], key).toBeDefined();
      expect(touhouPack.races[key]?.tier, key).toBe(tier);
    }
    // 非 wiki 的已实现种族不参与级别分配。
    expect(touhouPack.races.HOURAI?.tier).toBeUndefined();
    expect(touhouPack.races.HANYOU?.tier).toBeUndefined();
  });

  it("每个种族都带结构化 abilities，而不是只有扁平 flags", () => {
    for (const [key, race] of Object.entries(touhouPack.races)) {
      expect(race.abilities.length, `${key} 缺少 abilities`).toBeGreaterThan(0);
      for (const ability of race.abilities) {
        expect(ability.id.length).toBeGreaterThan(0);
        expect(ability.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("妖怪登记了魔法与神术弱点，吸血鬼登记了阳光弱点", () => {
    const youkai = touhouPack.races.YOUKAI?.abilities ?? [];
    const youkaiIds = youkai.map((ability) => ability.id);
    expect(youkaiIds).toContain("MAGIC_WEAKNESS");
    expect(youkaiIds).toContain("SPIRIT_WEAKNESS");
    for (const id of ["MAGIC_WEAKNESS", "SPIRIT_WEAKNESS"]) {
      expect(youkai.find((ability) => ability.id === id)?.automated).toBe(true);
    }

    const sunlight = touhouPack.races.VAMPIRE?.abilities.find((ability) => ability.id === "SUNLIGHT_WEAKNESS");
    expect(sunlight?.automated).toBe(true);
    expect(sunlight?.tags).toContain("SUNLIGHT");

    const regen = touhouPack.races.ABERRATION?.abilities.find((ability) => ability.id === "REGEN");
    expect(regen?.automated).toBe(true);
  });
});

describe("RACE_MOD 伤害管线隔离", () => {
  it("TOUHOU 管线应用 raceMultiplier 并写入步骤日志", () => {
    const outcome = applyDamagePipeline(touhou, {
      baseDamage: 10,
      defense: "PASS",
      raceMultiplier: 1.5
    });
    expect(outcome.damage).toBe(15);
    expect(outcome.steps.some((step) => step.includes("race/元素"))).toBe(true);
  });

  it("COC7 基线管线不含 RACE_MOD，传入乘数也不改变伤害", () => {
    const outcome = applyDamagePipeline(coc7, {
      baseDamage: 10,
      defense: "PASS",
      raceMultiplier: 1.5
    });
    expect(outcome.damage).toBe(10);
    expect(outcome.steps.some((step) => step.includes("race/元素"))).toBe(false);
  });
});
