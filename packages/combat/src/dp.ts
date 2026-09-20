import { compile as compileExpr, evaluate } from "@touhou/formula";
import type { CompiledRulePack } from "@touhou/rules";
import { findParticipant, pushLog, resolveDpActionForActor, resolveRoundRaceAbilities, type DefenseReaction, type ResolveResult } from "./combat";
import type { CombatParticipantState, CombatState } from "./types";

function evalDpExpr(
  pack: CompiledRulePack,
  source: string,
  vars: Readonly<Record<string, number>>
): number {
  const expression = compileExpr(source, { vars: Object.keys(vars), consts: pack.constantNames });
  const value = evaluate(expression, { vars, consts: pack.pack.const });
  return Number.isFinite(value) ? value : 0;
}

/** 千幻抄 DP 回复数：ceil((知性+感觉)/3)，最低 2；可叠加待机等加成。 */
export function dpRegenFor(
  pack: CompiledRulePack,
  participant: CombatParticipantState,
  regenBonus = 0
): number {
  const rules = pack.pack.dp;
  const max = Math.max(0, Math.floor(participant.maxDp));
  if (max <= 0) return 0;
  let base = rules.minRegen;
  try {
    base = Math.max(rules.minRegen, Math.floor(evalDpExpr(pack, rules.regen, participant.vars)));
  } catch {
    base = rules.minRegen;
  }
  const current = Math.max(0, Math.floor(participant.dp));
  const bonus = Math.max(0, Math.floor(regenBonus));
  const next = Math.min(max, current + base + bonus);
  return next - current;
}

/**
 * 进入 DP 战斗的一轮开始：
 * 1. 结算种族每轮再生（复用现有逻辑）；
 * 2. 为存活单位回复 DP；
 * 3. 清空本轮宣言，等待所有单位声明 DP。
 */
export function beginDpRound(pack: CompiledRulePack, state: CombatState): void {
  if (state.mode !== "DP") return;
  if (state.dp === null || state.dp === undefined) {
    state.dp = { declared: {}, regenBonus: {}, acted: [] };
  }
  const pendingBonus = { ...state.dp.regenBonus };
  resolveRoundRaceAbilities(pack, state);
  state.dp = { declared: {}, regenBonus: {}, acted: [] };

  for (const participant of state.participants) {
    if (participant.defeated) continue;
    const regen = dpRegenFor(pack, participant, pendingBonus[participant.id] ?? 0);
    if (regen > 0) {
      participant.dp = Math.min(participant.maxDp, participant.dp + regen);
      pushLog(state, {
        kind: "STATUS",
        actorId: participant.id,
        targetId: participant.id,
        text: participant.name + " 回复 " + regen + " DP（当前 " + participant.dp + " / " + participant.maxDp + "）",
        data: { rollType: "DP_REGEN", dp: participant.dp, regen }
      });
    }
    participant.reactionsThisRound = 0;
    participant.coverUsedThisRound = false;
    participant.abilityUsedThisRound = false;
    participant.isReady = false;
  }
  state.phase = "DP_DECLARATION";
  pushLog(state, {
    kind: "SYSTEM",
    actorId: null,
    targetId: null,
    text: "第 " + state.round + " 轮：请所有参战单位声明本回合 DP",
    data: { rollType: "DP_ROUND_START", round: state.round }
  });
}

/** 按声明 DP 从高到低排序；同值 PC 先于 NPC，再按 id 稳定排序。 */
export function dpTurnOrder(state: CombatState): string[] {
  const declared = state.dp?.declared ?? {};
  return state.participants
    .filter((participant) => participant.defeated === false)
    .slice()
    .sort((a, b) => {
      const da = declared[a.id] ?? a.dp;
      const db = declared[b.id] ?? b.dp;
      if (db !== da) return db - da;
      const ka = a.kind === "PLAYER" ? 0 : 1;
      const kb = b.kind === "PLAYER" ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return a.id < b.id ? -1 : 1;
    })
    .map((participant) => participant.id);
}

function aliveCount(state: CombatState): number {
  return state.participants.filter((participant) => participant.defeated === false).length;
}

/**
 * 声明本回合剩余的 DP。声明值不得高于当前 DP；
 * 全部存活单位声明完毕后，按声明值排定行动顺序并进入行动阶段。
 */
export function declareDp(state: CombatState, participantId: string, value: number): boolean {
  if (state.mode !== "DP" || state.phase !== "DP_DECLARATION" || state.dp === null || state.dp === undefined) {
    return false;
  }
  const participant = findParticipant(state, participantId);
  if (participant === undefined || participant.defeated) return false;
  const requested = Number.isFinite(value) ? Math.floor(value) : 0;
  const declared = Math.max(0, Math.min(Math.max(0, Math.floor(participant.dp)), requested));
  state.dp.declared[participantId] = declared;
  pushLog(state, {
    kind: "SYSTEM",
    actorId: participant.id,
    targetId: null,
    text: participant.name + " 声明 DP " + declared,
    data: { rollType: "DP_DECLARE", declared }
  });
  if (Object.keys(state.dp.declared).length >= aliveCount(state)) {
    state.initiativeOrder = dpTurnOrder(state);
    state.activeIndex = 0;
    state.phase = "AWAITING_ACTION";
    const first = findParticipant(state, state.initiativeOrder[0] ?? "");
    if (first !== undefined) first.isReady = true;
  }
  return true;
}

export function currentDpActorId(state: CombatState): string | null {
  if (state.mode !== "DP" || state.phase !== "AWAITING_ACTION") return null;
  return state.initiativeOrder[state.activeIndex] ?? null;
}

export function markDpActed(state: CombatState, participantId: string): void {
  if (state.dp === null || state.dp === undefined) return;
  if (state.dp.acted.includes(participantId) === false) {
    state.dp.acted = [...state.dp.acted, participantId];
  }
}

/** 待机：选择不进行攻击行动，下一回合 DP 回复 +2。 */
export function grantDpWaitBonus(state: CombatState, participantId: string): void {
  if (state.dp === null || state.dp === undefined) return;
  state.dp.regenBonus[participantId] = (state.dp.regenBonus[participantId] ?? 0) + 2;
}

/** 结束当前 DP 行动；一轮走完后进入下一轮回复 + 宣言。 */
export function endDpTurn(
  pack: CompiledRulePack,
  state: CombatState
): { roundAdvanced: boolean; nextActorId: string | null } {
  if (state.mode !== "DP") return { roundAdvanced: false, nextActorId: null };
  const current = state.initiativeOrder[state.activeIndex];
  if (current !== undefined) {
    markDpActed(state, current);
    const actor = findParticipant(state, current);
    if (actor !== undefined) actor.isReady = false;
  }
  state.activeIndex += 1;
  if (state.activeIndex >= state.initiativeOrder.length) {
    state.round += 1;
    beginDpRound(pack, state);
    return { roundAdvanced: true, nextActorId: null };
  }
  state.phase = "AWAITING_ACTION";
  const next = state.initiativeOrder[state.activeIndex] ?? null;
  const nextActor = next === null ? undefined : findParticipant(state, next);
  if (nextActor !== undefined) nextActor.isReady = true;
  return { roundAdvanced: false, nextActorId: next };
}

/**
 * DP 模式：结算当前行动者的行动，然后推进到下一个行动者 / 下一轮。
 * 行动种类由 ActionSubmission.dpAction 决定；弹幕与射击已在 combat.ts 实现。
 */
export function resolveDpTurn(
  pack: CompiledRulePack,
  state: CombatState,
  reactions: Readonly<Record<string, DefenseReaction>> = {}
): ResolveResult {
  if (state.mode !== "DP" || state.phase !== "AWAITING_ACTION") {
    return { acted: [], defeated: [], cleared: [] };
  }
  const actorId = currentDpActorId(state);
  if (actorId === null) {
    return { acted: [], defeated: [], cleared: [] };
  }
  const result = resolveDpActionForActor(pack, state, reactions, actorId);
  endDpTurn(pack, state);
  return result;
}
