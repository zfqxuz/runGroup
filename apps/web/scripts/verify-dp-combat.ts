/**
 * DP（千幻抄）战斗接线回归验证：
 * - 规则包切到 DP 后，回合 → 宣言 → 逐个行动 → 结算的顺序；
 * - DP 行动校验（弹幕无目标、射击/追击/近战需要敌方目标）；
 * - DP 应对选项与掩护候选（目标 + 队友）；
 * - DP 伤害公式 / 抵抗在 web 侧规则包下可用。
 *
 * 运行：npx tsx --env-file=.env scripts/verify-dp-combat.ts
 */
import {
  builtinRegistry,
  compileRulePack,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  resolveRulePack,
  type AttributeSet,
  type PackRegistry
} from "@touhou/rules";
import {
  addParticipant,
  beginDpRound,
  createCombat,
  currentDpActorId,
  declareDp,
  reactionTargetIdsForAction,
  resolveDpTurn,
  resolveSpellcardImmediate,
  type CombatParticipantState,
  type CombatState
} from "@touhou/combat";
import {
  dpReactionTypesForParticipant,
  validateCombatAction
} from "../src/server/combat/options";

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("DP 战斗断言失败：" + message);
}

const attrs: AttributeSet = {
  str: 50, con: 50, siz: 60, dex: 55,
  app: 50, int: 60, pow: 40, edu: 70, luck: 45
};

function buildDpPack() {
  const registry = builtinRegistry();
  const custom: PackRegistry = {
    ...registry,
    "tourhou-dp-verify": {
      schemaVersion: 1,
      id: "tourhou-dp-verify",
      system: "TOUHOU",
      version: "1.0.0",
      extends: ["touhou-ext@1.1.0"],
      combat: { mode: "DP" }
    }
  };
  return compileRulePack(resolveRulePack("tourhou-dp-verify", custom));
}

function buildUnit(
  state: CombatState,
  id: string,
  faction: string,
  kind: "PLAYER" | "NPC",
  pack: ReturnType<typeof buildDpPack>,
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
    derived,
    skills,
    atbMax: computeAtbMax(pack, { dex: attrs.dex }),
    speed: computeBaseSpeed(pack, { dex: attrs.dex })
  });
}

function main(): void {
  const pack = buildDpPack();
  ensure(pack.combat.mode === "DP", "规则包应处于 DP 模式");

  const state = createCombat({ id: "dp-verify", seed: "dp-verify", tickMs: 250, mode: "DP" });
  const actor = buildUnit(state, "actor", "PC", "PLAYER", pack, { DANMAKU: 100, DODGE: 100, MELEE: 100 });
  const e1 = buildUnit(state, "e1", "BOSS", "NPC", pack, { DODGE: 0, DANMAKU: 0 });
  const ally = buildUnit(state, "ally", "BOSS", "NPC", pack, { DODGE: 0, DANMAKU: 0 });

  // 1. 回合开始进入宣言阶段
  beginDpRound(pack, state);
  ensure(state.phase === "DP_DECLARATION", "beginDpRound 应进入 DP_DECLARATION");
  ensure((actor.dp ?? 0) > 0, "回合开始应回复 DP");
  declareDp(state, "actor", actor.dp);
  declareDp(state, "e1", 0);
  declareDp(state, "ally", 0);
  ensure(state.phase === "AWAITING_ACTION", "全部声明后应进入行动阶段");
  ensure(currentDpActorId(state) === "actor", "DP 高者先行动");
  ensure(actor.isReady === true && e1.isReady === false, "只有当前行动者就绪");

  // 2. DP 行动校验
  const bullet = { actorId: "actor", kind: "DANMAKU" as const, dpAction: "DANMAKU" as const };
  ensure(validateCombatAction({ pack, state, attackSkills: new Map() }, bullet) === null, "DP 弹幕无需目标");
  const ranged = { actorId: "actor", kind: "DANMAKU" as const, dpAction: "RANGED" as const, targetId: "e1", skill: "DANMAKU", dpDice: 1 };
  ensure(validateCombatAction({ pack, state, attackSkills: new Map() }, ranged) === null, "DP 射击目标合法");
  const friendly = { actorId: "actor", kind: "DANMAKU" as const, dpAction: "RANGED" as const, targetId: "ally", skill: "DANMAKU", dpDice: 1 };
  friendCheck: {
    // ally 是 e1 的队友、actor 的敌人，视为合法敌方目标；构造一个同阵营目标验证拦截。
    const sameSide = buildUnit(state, "pc-ally", "PC", "PLAYER", pack, { DANMAKU: 100 });
    const friendlyAction = { actorId: "actor", kind: "DANMAKU" as const, dpAction: "RANGED" as const, targetId: "pc-ally", skill: "DANMAKU", dpDice: 1 };
    ensure(validateCombatAction({ pack, state, attackSkills: new Map() }, friendlyAction) !== null, "DP 不能攻击同阵营");
    void sameSide;
    void friendly;
  }

  // 3. 掩护候选包含目标队友
  const targets = reactionTargetIdsForAction(pack, state, ranged);
  ensure(targets.includes("e1"), "掩护候选应包含原目标");
  ensure(targets.includes("ally"), "掩护候选应包含目标队友");

  // 4. 结算一次 DP 射击
  state.pending["actor"] = {
    actorId: "actor",
    kind: "DANMAKU",
    dpAction: "RANGED",
    targetId: "e1",
    skill: "DANMAKU",
    dpDice: 3,
    damageAbilityId: undefined,
    damage: "10"
  };
  const before = e1.hp;
  resolveDpTurn(pack, state, { e1: { type: "PASS" }, ally: { type: "PASS" } });
  ensure(e1.hp === before - 10, "DP 射击应结算伤害（PASS 视为回避失败）");
  ensure(state.pending["actor"] === undefined, "行动后应清空 pending");
  ensure(state.phase === "AWAITING_ACTION" || state.phase === "DP_DECLARATION", "结算后应推进回合");

  // 5. 任意时机展开：反应窗口即时展开符卡（4.9）
  const immediateTarget = buildUnit(state, "immediate", "BOSS", "NPC", pack, { DODGE: 0 });
  immediateTarget.mp = 100;
  resolveSpellcardImmediate(pack, state, immediateTarget.id, {
    actorId: immediateTarget.id,
    kind: "SPELLCARD",
    name: "即时展开验证",
    spellcardMode: "DECLARATION",
    declarationHp: 10,
    declarationDurationTicks: 240,
    mpCost: 0
  });
  ensure(immediateTarget.declaration !== null, "即时展开应建立 declaration");
  ensure(immediateTarget.usedSpellCards.includes("即时展开验证"), "即时展开应记录已使用");

  // 6. 应对 / 抵抗选项
  const dpOptions = dpReactionTypesForParticipant(false);
  ensure(dpOptions.includes("COVER") && dpOptions.includes("DODGE"), "DP 应对应含掩护与回避");
  const resistOptions = dpReactionTypesForParticipant(true);
  ensure(resistOptions.includes("RESIST"), "DP 能力应对应含抵抗");

  console.log("PASS DP 战斗接线：宣言 → 行动 → 应对 → 任意时机展开 → 结算，含掩护候选与行动校验");
}

main();
