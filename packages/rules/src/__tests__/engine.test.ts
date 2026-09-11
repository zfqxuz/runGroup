import { describe, expect, it } from "vitest";
import {
  applyDamagePipeline,
  compileParsedRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  consumeAction,
  msUntilReady,
  nextReadyTick,
  advanceTicks,
  ticksUntilReady,
  toMicro,
  schedule,
  resolveActionCost,
  resolveCheck,
  resolveOpposed,
  resolveRulePack,
  speedMultiplierOf,
  type AtbActor,
  type AttributeSet
} from "../index";
import { builtinRegistry } from "../packs";

const coc7 = compileParsedRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));
const touhou = compileParsedRulePack(resolveRulePack("touhou-ext", builtinRegistry()));

const attrs: AttributeSet = {
  str: 50,
  con: 50,
  siz: 60,
  dex: 55,
  app: 50,
  int: 60,
  pow: 40,
  edu: 70,
  luck: 45
};

describe("衍生属性", () => {
  it("COC7 基线公式", () => {
    const result = computeDerived(coc7, { attributes: attrs });
    expect(result.derived.maxHp).toBe(11);
    expect(result.derived.maxMp).toBe(8);
    expect(result.derived.maxSan).toBe(99);
  });

  it("COC7 最大 SAN 为 99 - 克苏鲁神话", () => {
    const result = computeDerived(coc7, {
      attributes: attrs,
      skills: { CTHULHU_MYTHOS: 23 }
    });
    expect(result.derived.maxSan).toBe(76);
  });

  it("东方扩展公式与常量", () => {
    const result = computeDerived(touhou, { attributes: attrs });
    expect(result.derived.maxHp).toBe(11);
    expect(result.derived.maxMp).toBe(160);
    expect(result.derived.maxDp).toBe(150);
  });

  it("种族先改属性再算衍生", () => {
    const result = computeDerived(touhou, { attributes: attrs, race: "FAIRY" });
    expect(result.attributes.dex).toBe(70);
    expect(result.attributes.str).toBe(45);
    expect(result.attributes.int).toBe(55);
    // 千幻抄妖精没有额外 HP 惩罚，按修正后 con + siz 计算：50 + 60 => 11
    expect(result.derived.maxHp).toBe(11);
    expect(result.derived.maxDp).toBe(145);
    expect(result.skillBonuses.ELEMENTAL_MAGIC).toBe(35);
    expect(result.flags).toContain("RESPAWN_MONTHLY");
  });

  it("人类幸运 +15", () => {
    const result = computeDerived(touhou, { attributes: attrs, race: "HUMAN" });
    expect(result.attributes.luck).toBe(60);
  });

  it("未知种族直接报错", () => {
    expect(() => computeDerived(touhou, { attributes: attrs, race: "LUNARIAN" })).toThrow(/未定义种族/);
  });
});

describe("COC7 判定", () => {
  const check = (roll: number, target: number) => resolveCheck(coc7, roll, target).result;

  it("大成功 / 极难 / 困难 / 普通", () => {
    expect(check(1, 50)).toBe("CRITICAL");
    expect(check(10, 50)).toBe("EXTREME");
    expect(check(25, 50)).toBe("HARD");
    expect(check(50, 50)).toBe("REGULAR");
  });

  it("失败与大失败的分界", () => {
    expect(check(51, 50)).toBe("FAIL");
    expect(check(95, 45)).toBe("FAIL");
    expect(check(96, 45)).toBe("FUMBLE");
    expect(check(100, 45)).toBe("FUMBLE");
    expect(check(100, 80)).toBe("FUMBLE");
  });

  it("技能值 45 时 96 是大失败，技能值 50 时不是", () => {
    expect(check(97, 49)).toBe("FUMBLE");
    expect(check(97, 50)).toBe("FAIL");
  });

  it("target <= 0 直接失败，不进入除数分支", () => {
    expect(check(1, 0)).toBe("FAIL");
    expect(check(1, -20)).toBe("FAIL");
  });

  it("技能值 >= 100 时 100 是普通成功而非大失败", () => {
    expect(check(100, 100)).toBe("REGULAR");
  });

  it("对抗检定先比等级再比技能值", () => {
    const win = resolveOpposed(coc7, { roll: 10, target: 50 }, { roll: 30, target: 50 });
    expect(win.winner).toBe("ATTACKER");
    expect(win.attacker.result).toBe("EXTREME");

    const bySkill = resolveOpposed(coc7, { roll: 40, target: 80 }, { roll: 30, target: 40 });
    expect(bySkill.winner).toBe("ATTACKER");
  });
});

describe("伤害管线由 RulePack 决定顺序", () => {
  it("COC7 基线：无防御时原样结算", () => {
    const outcome = applyDamagePipeline(coc7, { baseDamage: 10, defense: "PASS" });
    expect(outcome.damage).toBe(10);
    expect(outcome.mpCost).toBe(0);
  });

  it("东方：防御消耗灵力并按倍率减伤", () => {
    const outcome = applyDamagePipeline(touhou, { baseDamage: 10, defense: "DEFEND" });
    expect(outcome.mpCost).toBe(10);
    expect(outcome.damage).toBe(0);
  });

  it("东方：伤害高于减伤时留下余量", () => {
    const outcome = applyDamagePipeline(touhou, { baseDamage: 40, defense: "DEFEND" });
    expect(outcome.damage).toBe(10);
  });

  it("擦弹成功：免伤并回复一半灵力", () => {
    const outcome = applyDamagePipeline(touhou, {
      baseDamage: 21,
      defense: "DODGE",
      defenseSuccess: true
    });
    expect(outcome.damage).toBe(0);
    expect(outcome.mpGained).toBe(10);
  });

  it("擦弹失败：吃满伤害", () => {
    const outcome = applyDamagePipeline(touhou, {
      baseDamage: 21,
      defense: "DODGE",
      defenseSuccess: false
    });
    expect(outcome.damage).toBe(21);
    expect(outcome.mpGained).toBe(0);
  });

  it("消弹成功：双方抵消", () => {
    const outcome = applyDamagePipeline(touhou, {
      baseDamage: 30,
      defense: "COUNTER",
      defenseSuccess: true
    });
    expect(outcome.damage).toBe(0);
    expect(outcome.mpCost).toBe(20);
  });

  it("消弹失败：受一半伤害", () => {
    const outcome = applyDamagePipeline(touhou, {
      baseDamage: 30,
      defense: "COUNTER",
      defenseSuccess: false
    });
    expect(outcome.damage).toBe(15);
  });

  it("符卡倍率与强化修正按管线顺序生效", () => {
    const outcome = applyDamagePipeline(touhou, {
      baseDamage: 10,
      defense: "PASS",
      spellcardMultiplier: 2,
      enhanceFlat: 3
    });
    expect(outcome.damage).toBe(23);
  });

  it("护盾乘算减伤", () => {
    const outcome = applyDamagePipeline(touhou, {
      baseDamage: 20,
      defense: "PASS",
      shieldMultiplier: 0.7
    });
    expect(outcome.damage).toBe(14);
  });

  it("记录管线步骤供战斗日志仲裁", () => {
    const outcome = applyDamagePipeline(touhou, { baseDamage: 10, defense: "DEFEND" });
    expect(outcome.steps.length).toBeGreaterThan(0);
    expect(outcome.steps.join(" ")).toContain("defend");
  });
});

describe("ATB 全局计数器", () => {
  function actor(id: string, value: number, speed: number, max = 100): AtbActor {
    return {
      id,
      atbValue: toMicro(value),
      atbMax: toMicro(max),
      speed: toMicro(speed),
      isReady: false
    };
  }

  it("配置单位换算为整数微计数", () => {
    expect(computeAtbMax(touhou, { dex: 55 })).toBe(100000);
    expect(computeBaseSpeed(touhou, { dex: 55 })).toBe(7500);
    expect(computeBaseSpeed(touhou, { dex: 10 })).toBe(3000);
  });

  it("所需帧数 = ceil((max - value) / speed)", () => {
    expect(ticksUntilReady(actor("fast", 0, 7.5))).toBe(14);
    expect(ticksUntilReady(actor("slow", 0, 3))).toBe(34);
    expect(ticksUntilReady(actor("half", 50, 7.5))).toBe(7);
    expect(msUntilReady(actor("fast", 0, 7.5), 250)).toBe(3500);
  });

  it("推进恰好帧数才就绪，差一帧都不行", () => {
    const a = actor("a", 0, 7.5);
    const need = ticksUntilReady(a);
    expect(advanceTicks([a], need - 1)).toEqual([]);
    expect(a.isReady).toBe(false);
    const ready = advanceTicks([a], 1);
    expect(ready.map((item) => item.id)).toEqual(["a"]);
    expect(a.isReady).toBe(true);
  });

  it("speed 为 0 永远不会就绪（STOP 状态）", () => {
    const a = actor("stopped", 0, 0);
    expect(ticksUntilReady(a)).toBe(Number.POSITIVE_INFINITY);
    advanceTicks([a], 200);
    expect(a.isReady).toBe(false);
  });

  it("同帧就绪按超出量降序：速度快者先手", () => {
    const fast = actor("fast", 0, 30);
    const slow = actor("slow", 0, 26);
    const ready = advanceTicks([slow, fast], 4);
    expect(ready.map((item) => item.id)).toEqual(["fast", "slow"]);
    expect(fast.atbValue).toBeGreaterThan(slow.atbValue);
  });

  it("nextReadyTick 找出最先就绪的人", () => {
    const next = nextReadyTick([actor("slow", 0, 5), actor("fast", 0, 10)]);
    expect(next?.id).toBe("fast");
    expect(next?.ticks).toBe(10);
  });

  it("行动消耗扣进度并清除就绪标记", () => {
    const a = actor("a", 100, 7.5);
    a.isReady = true;
    consumeAction(a, resolveActionCost(touhou, "SPELLCARD", { dex: 55 }));
    expect(a.atbValue).toBe(toMicro(40));
    expect(a.isReady).toBe(false);
  });

  it("schedule 给出下一个就绪事件与墙钟时间", () => {
    const plan = schedule([actor("slow", 0, 3), actor("fast", 0, 7.5)], 250);
    expect(plan.ticks).toBe(14);
    expect(plan.ms).toBe(3500);
    expect(plan.ready).toEqual(["fast"]);
  });

  it("已有人就绪时 schedule 立即返回", () => {
    const a = actor("a", 100, 7.5);
    a.isReady = true;
    const plan = schedule([a], 250);
    expect(plan.ticks).toBe(0);
    expect(plan.ms).toBe(0);
    expect(plan.ready).toEqual(["a"]);
  });

  it("状态效果连乘且与顺序无关", () => {
    const haste = { key: "HASTE", stacks: 1, remainingTicks: 1 };
    const slow = { key: "SLOW", stacks: 1, remainingTicks: 1 };
    expect(speedMultiplierOf(touhou, [haste], {})).toBe(1.5);
    expect(speedMultiplierOf(touhou, [{ ...haste, stacks: 2 }], {})).toBe(2.25);
    expect(speedMultiplierOf(touhou, [{ key: "STOP", stacks: 1, remainingTicks: 1 }], {})).toBe(0);
    expect(speedMultiplierOf(touhou, [haste, slow], {})).toBe(0.75);
    expect(speedMultiplierOf(touhou, [slow, haste], {})).toBe(0.75);
  });
});
