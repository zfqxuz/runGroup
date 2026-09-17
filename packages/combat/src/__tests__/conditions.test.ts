import { describe, expect, it } from "vitest";
import {
  builtinRegistry,
  compileParsedRulePack,
  computeDerived,
  makeCondition,
  resolveRulePack,
  type AttributeSet
} from "@touhou/rules";
import { addParticipant, createCombat } from "../combat";
import { coreConditionsFromParticipant, participantConditions, persistableConditions, possessInitFromConditions } from "../conditions";
import { filterCombatForViewer } from "../filter";

const coc7 = compileParsedRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));

const attrs: AttributeSet = { str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50 };

function makeState() {
  const pack = coc7;
  const derived = computeDerived(pack, { attributes: attrs, skills: {} }).derived;
  const state = createCombat({ id: "cond", seed: "cond", tickMs: 250, mode: "INITIATIVE" });
  const participant = addParticipant(state, {
    id: "char-a",
    name: "角色 A",
    kind: "PLAYER",
    characterId: "char-a",
    faction: "ALLY",
    attributes: attrs,
    derived,
    atbMax: 1000,
    speed: 10
  });
  return { pack, state, participant };
}

describe("战斗 / 局内状态桥接", () => {
  it("核心 COC7 状态由战斗标记派生", () => {
    const { participant } = makeState();
    participant.majorWound = true;
    participant.prone = true;
    const types = coreConditionsFromParticipant(participant).map((condition) => condition.type);
    expect(types).toEqual(["MAJOR_WOUND", "PRONE"]);
  });

  it("夺舍持久状态会在开局时转成充能池", () => {
    const conditions = [
      makeCondition({ type: "POSSESS", controllerId: "npc-x", unit: "CHARGE", remaining: 4 })
    ];
    const init = possessInitFromConditions(conditions);
    expect(init.possessedBy).toBe("npc-x");
    expect(init.possessCharges).toBe(4);

    const { pack, state } = makeState();
    const participant = addParticipant(state, {
      id: "char-b",
      name: "角色 B",
      kind: "PLAYER",
      characterId: "char-b",
      faction: "ENEMY",
      attributes: attrs,
      derived: computeDerived(pack, { attributes: attrs, skills: {} }).derived,
      atbMax: 1000,
      speed: 10,
      conditions,
      possessCharges: 3
    });
    expect(participant.possessedBy).toBe("npc-x");
    expect(participant.possessCharges).toBe(3);
  });

  it("派生的护甲 / 夺舍状态进入战斗视图，战斗临时状态不写回局内", () => {
    const { state, participant } = makeState();
    participant.armor = 7;
    participant.maxArmor = 7;
    participant.armorExpiresAtRound = 3;
    participant.possessedBy = "npc-x";
    participant.possessCharges = 2;
    participant.stunActions = 1;
    state.round = 1;

    const all = participantConditions(participant, state.round);
    expect(all.find((condition) => condition.type === "ARMOR")?.duration.remaining).toBe(2);
    expect(all.find((condition) => condition.type === "POSSESS")?.duration.remaining).toBe(2);

    const persisted = persistableConditions(participant, state.round);
    const persistedTypes = persisted.map((condition) => condition.type);
    expect(persistedTypes).toContain("POSSESS");
    // 护甲作为可持久化的魔法状态写回（进入下一次战斗仍生效）。
    expect(persistedTypes).toContain("ARMOR");
    expect(persisted.find((condition) => condition.type === "ARMOR")?.duration.remaining).toBe(2);
    expect(persistedTypes).not.toContain("STUN");

    const view = filterCombatForViewer(state, { userId: "kp", role: "KP", characterId: null });
    const viewParticipant = view.participants[0]!;
    expect(viewParticipant.possessCharges).toBe(2);
    expect(viewParticipant.conditions.some((condition) => condition.type === "ARMOR")).toBe(true);
  });
});
