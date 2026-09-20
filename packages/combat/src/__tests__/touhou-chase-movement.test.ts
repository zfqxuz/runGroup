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
import { addParticipant, chaseBaseMov, createCombat } from "../index";

const registry = builtinRegistry();
const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", registry));
const coc7 = compileParsedRulePack(resolveRulePack("coc7-baseline", registry));

const attrs: AttributeSet = {
  str: 5, con: 5, siz: 6, dex: 5,
  app: 5, int: 6, pow: 4, edu: 7, luck: 4
};

function participant(
  pack: typeof touhou,
  id: string,
  skills: Record<string, number>,
  passiveMods?: { movementBonus: number }
) {
  const state = createCombat({ id: "c-" + id, seed: id, tickMs: 250, mode: pack.system === "TOUHOU" ? "DP" : "ATB" });
  const derived = computeDerived(pack, { attributes: attrs }).derived;
  return addParticipant(state, {
    id,
    name: id,
    kind: "NPC",
    faction: "A",
    attributes: attrs,
    derived,
    skills,
    atbMax: computeAtbMax(pack, { dex: attrs.dex }),
    speed: computeBaseSpeed(pack, { dex: attrs.dex }),
    passiveMods:
      passiveMods === undefined
        ? undefined
        : {
            damageBonus: 0,
            reactionBonus: 0,
            accuracyBonus: 0,
            movementBonus: passiveMods.movementBonus,
            grazeBonusPer: 0,
            danmakuDpReduction: 0,
            danmakuDamageReduction: 0
          }
  });
}

describe("14.1 移动公式接入追逐", () => {
  it("东方按 {身体}+〈运动〉 级别换算 m/s，SKILL_SCALE=20", () => {
    // str=5，ATHLETICS=50 → 技能等级 2 → 移动 7 m/s。
    const p = participant(touhou, "t1", { ATHLETICS: 50 });
    expect(chaseBaseMov(touhou, p)).toBe(7);
  });

  it("常时移动加值叠加在移动结果上", () => {
    const p = participant(touhou, "t2", { ATHLETICS: 50 }, { movementBonus: 3 });
    expect(chaseBaseMov(touhou, p)).toBe(10);
  });

  it("COC7 仍走规则书 MOV，不读取东方移动公式", () => {
    const p = participant(coc7, "c1", { ATHLETICS: 100 });
    // (str+siz)/2 /5 向上取整的相关处理由 coc7Movement 决定；至少验证不回退到 m/s 数值。
    expect(chaseBaseMov(coc7, p)).toBeGreaterThan(0);
    expect(chaseBaseMov(coc7, p)).toBeLessThan(10);
  });
});
