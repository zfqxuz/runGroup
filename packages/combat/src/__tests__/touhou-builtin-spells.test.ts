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
      "ELEMENTAL_DESTROY",
      "ELEMENTAL_GENERATE",
      "MAGIC_CURE",
      "MAGIC_HEAL",
      "MAGIC_SHIELD",
      "MAGIC_TRANSFER",
      "SPIRIT_BARRIER_BREAK",
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

  it("破魔结界：解除目标身上的结界", () => {
    const state = createCombat({ id: "c-builtin-break", seed: "builtin-break", tickMs: 250 });
    const caster = addUnit(state, "caster", "PC", { abilityLevels: { SPIRIT_ARTS: 1 } });
    const enemy = addUnit(state, "enemy", "BOSS");
    enemy.barrier = {
      hp: 20,
      maxHp: 20,
      name: "敌方结界",
      expiresAtRound: null,
      sizeMeters: 10,
      sizeId: "SIZE_10",
      requiredLevel: 3,
      targetValue: 20,
      penalty: 0,
      anchor: "SELF",
      durationHours: 3
    };
    forceReady(caster);
    forceReady(enemy);
    submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "enemy", spellId: "SPIRIT_BARRIER_BREAK", name: "SPIRIT_BARRIER_BREAK" });
    resolvePending(pack, state, { enemy: { type: "PASS" } });
    expect(enemy.barrier).toBeNull();
    expect(state.log.some((entry) => entry.data?.brokeBarrier === true)).toBe(true);
  });

  it("生成：按 属性使 Lv×4 创建遮挡物", () => {
    const { target } = cast("builtin-generate", "ELEMENTAL_GENERATE", { "ELEMENTALIST:FIRE": 3 });
    expect(target.cover?.hp).toBe(12);
    expect(target.cover?.blocksLineOfSight).toBe(true);
    expect(target.grantedElement ?? null).toBeNull();
  });

  it("消灭：破坏目标的生成物", () => {
    const state = createCombat({ id: "c-builtin-destroy", seed: "builtin-destroy", tickMs: 250 });
    const caster = addUnit(state, "caster", "PC", { abilityLevels: { "ELEMENTALIST:FIRE": 3 } });
    const target = addUnit(state, "target", "PC");
    target.cover = {
      name: "生成物",
      level: 0,
      hp: 12,
      maxHp: 12,
      expiresAtRound: null,
      blocksLineOfSight: true
    };
    forceReady(caster);
    forceReady(target);
    submitAction(state, { actorId: "caster", kind: "MAGIC", targetId: "target", spellId: "ELEMENTAL_DESTROY", name: "ELEMENTAL_DESTROY" });
    resolvePending(pack, state, { target: { type: "PASS" } });
    expect(target.cover).toBeNull();
    expect(state.log.some((entry) => entry.data?.brokeCover === true)).toBe(true);
  });

  it("恢复术：恢复 魔法 Lv×5 HP", () => {
    const { target } = cast("builtin-heal", "MAGIC_HEAL", { MAGIC: 4 });
    expect(target.hp).toBe(30); // 10 + 4×5
  });
});
