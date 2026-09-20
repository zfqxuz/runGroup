import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  resolveRulePack,
  type AttributeSet
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
  str: 60, con: 60, siz: 60, dex: 60,
  app: 50, int: 60, pow: 50, edu: 60, luck: 50
};

const pack = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

function build(
  state: CombatState,
  id: string,
  faction: string,
  kind: "PLAYER" | "NPC",
  skills: Record<string, number>
): CombatParticipantState {
  const derived = computeDerived(pack, { attributes: attrs }).derived;
  return addParticipant(state, {
    id,
    name: id,
    kind,
    characterId: kind === "PLAYER" ? id : null,
    faction,
    attributes: attrs,
    derived: { ...derived, hp: 100, maxHp: 100, mp: 100, maxMp: 100 },
    skills,
    atbMax: computeAtbMax(pack, { dex: attrs.dex }),
    speed: computeBaseSpeed(pack, { dex: attrs.dex })
  });
}

describe("Touhou-COC7（非 DP）符卡映射", () => {
  it("符卡作为武器：走 CoC7 攻击判定并结算伤害", () => {
    const state = createCombat({ id: "coc7-sc-weapon", seed: "coc7-sc-weapon", tickMs: 250 });
    const actor = build(state, "actor", "PC", "PLAYER", { FIREARMS_HANDGUN: 100, DANMAKU: 100 });
    const enemy = build(state, "enemy", "BOSS", "NPC", { DODGE: 0 });
    actor.isReady = true;
    expect(
      submitAction(state, {
        actorId: "actor",
        kind: "SPELLCARD",
        targetId: "enemy",
        spellCardId: "sc-weapon",
        name: "测试符卡·武器",
        spellcardCombatMode: "WEAPON",
        spellcardMode: "CONSUMPTION",
        skill: "FIREARMS_HANDGUN",
        damage: "10",
        mpCost: 0
      })
    ).toBe(true);
    resolvePending(pack, state, { enemy: { type: "PASS" } });
    expect(enemy.hp).toBe(enemy.maxHp - 10);
    expect(state.log.some((entry) => entry.data?.event === "WEAPON")).toBe(true);
  });

  it("持续型符卡作为护甲：先扣护甲，耗尽后视为武器损毁", () => {
    const state = createCombat({ id: "coc7-sc-armor", seed: "coc7-sc-armor", tickMs: 250 });
    const actor = build(state, "actor", "PC", "PLAYER", { FIREARMS_HANDGUN: 100 });
    const enemy = build(state, "enemy", "BOSS", "NPC", { FIREARMS_HANDGUN: 100 });
    actor.isReady = true;
    expect(
      submitAction(state, {
        actorId: "actor",
        kind: "SPELLCARD",
        targetId: null,
        spellCardId: "sc-armor",
        name: "测试符卡·护甲",
        spellcardCombatMode: "ARMOR",
        spellcardMode: "DECLARATION",
        declarationHp: 30,
        mpCost: 0
      })
    ).toBe(true);
    resolvePending(pack, state, {});
    expect(actor.declaration?.combatMode).toBe("ARMOR");
    expect(actor.declaration?.hp).toBe(30);

    enemy.isReady = true;
    submitAction(state, {
      actorId: "enemy",
      kind: "DANMAKU",
      targetId: "actor",
      skill: "FIREARMS_HANDGUN",
      damage: "40"
    });
    resolvePending(pack, state, { actor: { type: "PASS" } });
    expect(actor.declaration).toBeNull();
    expect(actor.hp).toBe(actor.maxHp); // 护甲池吸收全部；溢出无效
    expect(actor.brokenSpellCards).toContain("sc-armor");
    expect(state.log.some((entry) => entry.data?.event === "DESTROYED")).toBe(true);
  });
});
