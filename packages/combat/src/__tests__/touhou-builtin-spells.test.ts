import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  resolveRulePack,
  type AttributeSet,
  type PackRegistry
} from "@touhou/rules";
import {
  addParticipant,
  createCombat,
  resolvePending,
  submitAction,
  type CombatParticipantState,
  type CombatState
} from "../index";

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

function buildPack() {
  const registry = builtinRegistry();
  const custom: PackRegistry = {
    ...registry,
    "touhou-builtin-spell-test": {
      schemaVersion: 1,
      id: "touhou-builtin-spell-test",
      system: "TOUHOU",
      version: "1.0.0",
      extends: ["touhou-ext@1.1.0"],
      // 只开开关，不覆盖 spells，保留 touhou-ext 内置法术。
      magic: { enabled: true }
    }
  };
  return compileParsedRulePack(resolveRulePack("touhou-builtin-spell-test", custom));
}

const pack = buildPack();

function addUnit(
  state: CombatState,
  id: string,
  faction: string,
  options: Partial<Parameters<typeof addParticipant>[1]> = {}
): CombatParticipantState {
  const derived = computeDerived(pack, { attributes: attrs }).derived;
  return addParticipant(state, {
    id,
    name: id,
    kind: "PLAYER",
    characterId: id,
    faction,
    attributes: attrs,
    derived: { ...derived, hp: 100, maxHp: 100, mp: 100, maxMp: 100 },
    skills: { SPIRIT_ARTS: 100, MAGIC: 100, DODGE: 0 },
    atbMax: computeAtbMax(pack, { dex: 55 }),
    speed: computeBaseSpeed(pack, { dex: 55 }),
    ...options
  });
}

function forceReady(participant: CombatParticipantState, value = 100000): void {
  participant.isReady = true;
  participant.atbValue = value;
}

function cast(seed: string, spellId: string, casterLevels: Record<string, number>): { state: CombatState; caster: CombatParticipantState; target: CombatParticipantState } {
  const state = createCombat({ id: "c-" + seed, seed, tickMs: 250 });
  const caster = addUnit(state, "caster", "PC", { abilityLevels: casterLevels });
  const target = addUnit(state, "target", "PC");
  target.hp = 10;
  forceReady(caster);
  forceReady(target);
  submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "target", spellId, name: spellId });
  resolvePending(pack, state, { target: { type: "PASS" } });
  return { state, caster, target };
}

describe("千幻抄内置法术（wiki 自动结算子集）", () => {
  it("东方包登记 4 个内置法术，默认启用开关关闭", () => {
    const base = resolveRulePack("touhou-ext", builtinRegistry());
    expect(base.magic?.enabled).toBe(false);
    expect(base.magic?.spells.map((spell) => spell.id).sort()).toEqual([
      "MAGIC_CURE",
      "MAGIC_HEAL",
      "MAGIC_SHIELD",
      "MAGIC_TRANSFER",
      "SPIRIT_BLESSING"
    ]);
  });

  it("加持：恢复 神术 Lv×5 HP，并消耗 4 灵力", () => {
    const { caster, target } = cast("builtin-blessing", "SPIRIT_BLESSING", { SPIRIT_ARTS: 3 });
    expect(caster.mp).toBe(96);
    expect(target.hp).toBe(25); // 10 + 3×5
  });

  it("护盾术：获得 ceil(魔法 Lv×1.5) 追加 DP", () => {
    const { caster, target } = cast("builtin-shield", "MAGIC_SHIELD", { MAGIC: 4 });
    expect(caster.mp).toBe(96);
    expect(target.tempDp).toBe(6); // ceil(4 × 1.5)
    expect(target.tempDpMax).toBe(6);
  });

  it("恢复术：恢复 魔法 Lv×5 HP", () => {
    const { target } = cast("builtin-heal", "MAGIC_HEAL", { MAGIC: 4 });
    expect(target.hp).toBe(30); // 10 + 4×5
  });
});
