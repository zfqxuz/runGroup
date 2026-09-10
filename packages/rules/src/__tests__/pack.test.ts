import { describe, expect, it } from "vitest";
import {
  compileRulePack,
  resolveRulePack,
  RulePackError,
  type RulePackErrorCode
} from "../index";
import { builtinRegistry, COC7_BASELINE } from "../packs";

const registry = builtinRegistry();

function cloneBaseline(): Record<string, any> {
  return structuredClone(COC7_BASELINE) as Record<string, any>;
}

function codeOf(fn: () => unknown): RulePackErrorCode {
  try {
    fn();
  } catch (error) {
    if (error instanceof RulePackError) return error.code;
    throw error;
  }
  throw new Error("expected RulePackError but nothing was thrown");
}

describe("extends 链解析", () => {
  it("基线包自身可解析", () => {
    const pack = resolveRulePack("coc7-baseline", registry);
    expect(pack.id).toBe("coc7-baseline");
    expect(pack.system).toBe("COC7");
  });

  it("东方包继承基线并覆盖", () => {
    const pack = resolveRulePack("touhou-ext", registry);
    expect(pack.system).toBe("TOUHOU");
    expect(pack.const.MP_PER_POW).toBe(4);
    expect(pack.derived.maxMp).toBe("pow * MP_PER_POW");
    expect(pack.check.criticalAt).toBe("1");
    expect(pack.attributes.max).toBe(90);
    expect(pack.atb.actionCost.DANMAKU).toBe("40");
    expect(pack.races.FAIRY?.attrMods.dex).toBe("15");
  });

  it("找不到依赖包时报错", () => {
    expect(codeOf(() => resolveRulePack("touhou-ext", {}))).toBe("SCHEMA_INVALID");
  });
});

describe("编译期 fail-fast", () => {
  it("未知标识符", () => {
    const bad = cloneBaseline();
    bad.derived.maxHp = "floor((con + sizz) / 10)";
    expect(() => compileRulePack(bad)).toThrow(RulePackError);
    expect(() => compileRulePack(bad)).toThrow(/sizz/);
  });

  it("derived 循环依赖", () => {
    const bad = cloneBaseline();
    bad.derived = { maxHp: "maxMp + 1", maxMp: "maxHp + 1" };
    expect(codeOf(() => compileRulePack(bad))).toBe("DERIVED_CYCLE");
  });

  it("缺少核心行动消耗", () => {
    const bad = cloneBaseline();
    delete bad.atb.actionCost.DEFEND;
    expect(codeOf(() => compileRulePack(bad))).toBe("MISSING_ACTION_COST");
  });

  it("行动消耗写错 key", () => {
    const bad = cloneBaseline();
    bad.atb.actionCost = { TYPO: "10" };
    expect(() => compileRulePack(bad)).toThrow(RulePackError);
  });

  it("公式里出现骰子被拒", () => {
    const bad = cloneBaseline();
    bad.derived.maxHp = "1d6 + 10";
    expect(() => compileRulePack(bad)).toThrow(RulePackError);
  });

  it("schema 缺失字段", () => {
    expect(codeOf(() => compileRulePack({ id: "x" }))).toBe("SCHEMA_INVALID");
  });
});

describe("预设角色数据", () => {
  const coc7 = resolveRulePack("coc7-baseline", registry);
  const touhou = resolveRulePack("touhou-ext", registry);

  it("两个内置包各自发布四类预设角色", () => {
    for (const pack of [coc7, touhou]) {
      expect(pack.presets.map((preset) => preset.name)).toEqual(["路人", "巡警", "妖精", "强者"]);
      expect(new Set(pack.presets.map((preset) => preset.id)).size).toBe(4);
    }
  });

  it("预设技能只能引用本包技能表", () => {
    for (const pack of [coc7, touhou]) {
      const skillIds = new Set(pack.skills.map((skill) => skill.id));
      for (const preset of pack.presets) {
        for (const skillId of Object.keys(preset.skills)) {
          expect(skillIds.has(skillId)).toBe(true);
        }
      }
    }
  });

  it("预设属性与生存数值齐全", () => {
    for (const pack of [coc7, touhou]) {
      for (const preset of pack.presets) {
        expect(Object.keys(preset.attributes).sort()).toEqual([
          "app",
          "con",
          "dex",
          "edu",
          "int",
          "luck",
          "pow",
          "siz",
          "str"
        ]);
        expect(preset.maxHp).toBeGreaterThan(0);
        expect(preset.maxMp).toBeGreaterThanOrEqual(0);
        expect(preset.maxSan).toBeGreaterThan(0);
        expect(preset.maxDp).toBeGreaterThanOrEqual(0);
        expect(preset.tier.length).toBeGreaterThan(0);
        expect(preset.rarity.length).toBeGreaterThan(0);
      }
    }
  });

  it("extends 数组替换：东方包不会串入 COC7 预设", () => {
    const coc7Fairy = coc7.presets.find((preset) => preset.id === "FAIRY");
    const touhouFairy = touhou.presets.find((preset) => preset.id === "FAIRY");
    expect(coc7Fairy).toBeDefined();
    expect(touhouFairy).toBeDefined();
    expect(coc7Fairy?.race).toBeNull();
    expect(touhouFairy?.race).toBe("FAIRY");
    expect(touhou.version).toBe("1.1.0");
  });

  it("编译产物保留预设角色", () => {
    const compiled = compileRulePack(coc7);
    expect(compiled.presets.length).toBe(4);
    expect(compiled.presets[0]?.name).toBe("路人");
  });
});
