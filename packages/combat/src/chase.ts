import {
  coc7Movement,
  isSuccess,
  resolveCheck,
  type CheckResult,
  type CompiledRulePack
} from "@touhou/rules";
import { rollDie, type Rng } from "@touhou/formula";
import { findParticipant, pushLog } from "./combat";
import { rngFor } from "./rng";
import type {
  ChaseParticipantState,
  ChaseSide,
  ChaseState,
  CombatParticipantState,
  CombatState
} from "./types";

function nextChaseRng(state: CombatState, salt: string): Rng {
  state.rollSeq += 1;
  return rngFor(state.seed, state.rollSeq, salt);
}

function participantName(participant: CombatParticipantState): string {
  return participant.isIdentified ? participant.name : participant.name;
}

/**
 * 追逐基础 MOV。
 * COC7 步行追逐使用规则书 MOV；东方沿用 ATB 速度做近似换算。
 */
export function chaseBaseMov(pack: CompiledRulePack, participant: CombatParticipantState): number {
  if (pack.system === "COC7") {
    return Math.max(
      1,
      coc7Movement({
        str: participant.attributes.str,
        siz: participant.attributes.siz,
        dex: participant.attributes.dex
      })
    );
  }
  return Math.max(1, Math.floor(participant.speed / 1000));
}

/** 步行/肉体移动使用体质检定；载具追逐以后可以扩展为汽车驾驶。 */
export function chaseSpeedCheckTarget(_pack: CompiledRulePack, participant: CombatParticipantState): number {
  return Math.max(1, participant.attributes.con);
}

export interface StartChaseOptions {
  readonly preyId: string;
  readonly chaserIds: readonly string[];
  /** 地点总数；不传则根据初始站位自动取 maxPosition + 6（至少 8）。 */
  readonly trackLength?: number;
  /** 测试 / KP 覆盖速度检定骰值（1~100）。 */
  readonly speedRolls?: Readonly<Record<string, number>>;
}

export interface StartChaseResult {
  readonly ok: boolean;
  readonly error?: string;
  /** 速度检定后逃离者比最快追逐者还快，追逐还没开始就结束。 */
  readonly escapedImmediately?: boolean;
  readonly chase?: ChaseState;
}

interface ChaseSetupRow {
  readonly participant: CombatParticipantState;
  readonly side: ChaseSide;
  readonly baseMov: number;
  readonly mov: number;
  readonly roll: number;
  readonly result: CheckResult;
}

/**
 * 建立追逐（COC7 规则第一部分）。
 *
 * 1. 所有参与者进行体质检定（速度检定）：
 *    - 极限成功：MOV +1；
 *    - 成功：MOV 不变；
 *    - 失败：MOV -1。
 * 2. 若逃离者调整后 MOV 高于最快追逐者，直接判定逃离成功。
 * 3. 否则按 MOV 相对值排位：
 *    - 最慢追逐者在 0 号地点，其余追逐者每高 1 MOV 前移 1 个地点；
 *    - 最慢逃离者放在最快追逐者前方 2 个地点，其余逃离者按 MOV 差值继续前移。
 * 4. 每轮行动点 = 1 + (MOV - 全场最低 MOV)。
 */
export function startChase(
  pack: CompiledRulePack,
  state: CombatState,
  options: StartChaseOptions
): StartChaseResult {
  if (state.chase !== null && state.chase.status === "ACTIVE") {
    return { ok: false, error: "已经在追逐中" };
  }
  const prey = findParticipant(state, options.preyId);
  if (prey === undefined || prey.defeated) {
    return { ok: false, error: "逃离者不在场" };
  }
  const chasers = options.chaserIds
    .map((id) => findParticipant(state, id))
    .filter((item): item is CombatParticipantState => item !== undefined && item.defeated === false);
  if (chasers.length === 0) {
    return { ok: false, error: "没有可参与追逐的追逐者" };
  }

  const rows: ChaseSetupRow[] = [prey, ...chasers].map((participant) => {
    const side: ChaseSide = participant.id === prey.id ? "PREY" : "CHASER";
    const baseMov = chaseBaseMov(pack, participant);
    const target = chaseSpeedCheckTarget(pack, participant);
    const roll = options.speedRolls?.[participant.id] ?? rollDie(nextChaseRng(state, "chase-speed:" + participant.id), 100);
    const check = resolveCheck(pack, roll, target);
    const success = isSuccess(check.result);
    const extreme = check.result === "EXTREME" || check.result === "CRITICAL";
    const mov = Math.max(1, baseMov + (extreme ? 1 : success ? 0 : -1));

    pushLog(state, {
      kind: "CHECK",
      actorId: participant.id,
      targetId: null,
      text:
        "速度检定：" +
        participantName(participant) +
        " 掷 1d100 = " +
        roll +
        "，体质目标值 " +
        target +
        " → " +
        check.result +
        "，MOV " +
        baseMov +
        " → " +
        mov,
      data: { rollType: "CHASE_SPEED", roll, target, result: check.result, baseMov, mov }
    });

    return { participant, side, baseMov, mov, roll, result: check.result };
  });

  const chaserRows = rows.filter((row) => row.side === "CHASER");
  const preyRows = rows.filter((row) => row.side === "PREY");
  const fastestChaserMov = Math.max(...chaserRows.map((row) => row.mov));
  if (preyRows.every((row) => row.mov > fastestChaserMov)) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: prey.id,
      targetId: null,
      text:
        prey.name +
        " 的速度检定 MOV " +
        preyRows[0]?.mov +
        " 高于最快追逐者的 MOV " +
        fastestChaserMov +
        "，在追逐开始前就成功逃离。",
      data: { rollType: "CHASE_ESCAPE", escapedImmediately: true }
    });
    return { ok: true, escapedImmediately: true };
  }

  const minAllMov = Math.min(...rows.map((row) => row.mov));
  const chaserSorted = [...chaserRows].sort((a, b) => a.mov - b.mov || a.participant.id.localeCompare(b.participant.id));
  const minChaserMov = chaserSorted[0]?.mov ?? 1;
  const chaserPositions = new Map<string, number>();
  for (const row of chaserSorted) {
    chaserPositions.set(row.participant.id, row.mov - minChaserMov);
  }
  const maxChaserPosition = Math.max(0, ...chaserPositions.values());
  const preySorted = [...preyRows].sort((a, b) => a.mov - b.mov || a.participant.id.localeCompare(b.participant.id));
  const slowestPreyMov = preySorted[0]?.mov ?? minAllMov;
  const slowestPreyPosition = Math.max(2, maxChaserPosition + 2);

  const chaseParticipants: ChaseParticipantState[] = rows.map((row) => {
    const maxActionPoints = 1 + (row.mov - minAllMov);
    const position =
      row.side === "PREY"
        ? slowestPreyPosition + (row.mov - slowestPreyMov)
        : chaserPositions.get(row.participant.id) ?? 0;
    return {
      id: row.participant.id,
      name: row.participant.name,
      side: row.side,
      baseMov: row.baseMov,
      mov: row.mov,
      position,
      actionPoints: maxActionPoints,
      maxActionPoints,
      speedRoll: row.roll,
      speedResult: row.result
    };
  });

  const maxPosition = Math.max(...chaseParticipants.map((participant) => participant.position));
  const trackLength = Math.max(options.trackLength ?? 0, maxPosition + 6, 8);
  const order = [...chaseParticipants]
    .sort(
      (a, b) =>
        (findParticipant(state, b.id)?.attributes.dex ?? 0) -
          (findParticipant(state, a.id)?.attributes.dex ?? 0) ||
        a.id.localeCompare(b.id)
    )
    .map((participant) => participant.id);

  const chase: ChaseState = {
    status: "ACTIVE",
    round: 1,
    activeIndex: 0,
    order,
    trackLength,
    participants: chaseParticipants,
    ending: null
  };
  state.chase = chase;
  pushLog(state, {
    kind: "SYSTEM",
    actorId: prey.id,
    targetId: null,
    text:
      "追逐开始：" +
      prey.name +
      " 逃离，" +
      chasers.map((participant) => participant.name).join("、") +
      " 追逐。地点 0~" +
      (trackLength - 1) +
      "，逃离者到达最后一个地点即逃脱。",
    data: { rollType: "CHASE_START", trackLength }
  });

  return { ok: true, chase };
}

export function chaseCurrentActorId(chase: ChaseState): string | null {
  if (chase.status !== "ACTIVE") return null;
  return chase.order[chase.activeIndex] ?? null;
}

export function findChaseParticipant(
  chase: ChaseState,
  id: string
): ChaseParticipantState | undefined {
  return chase.participants.find((participant) => participant.id === id);
}

export interface ChaseMoveResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly escaped?: boolean;
  readonly contacted?: boolean;
}

/**
 * 消耗行动点移动。
 * 每移动一个地点消耗 1 点行动点；到达最后一个地点的逃离者立即脱离追逐。
 */
export function chaseMove(state: CombatState, actorId: string, rawSteps: number): ChaseMoveResult {
  const chase = state.chase;
  if (chase === null || chase.status !== "ACTIVE") {
    return { ok: false, error: "当前没有进行中的追逐" };
  }
  const currentId = chaseCurrentActorId(chase);
  if (currentId !== actorId) {
    return { ok: false, error: "还没轮到这个单位行动" };
  }
  const actor = findChaseParticipant(chase, actorId);
  if (actor === undefined) return { ok: false, error: "该单位不在这场追逐中" };
  const steps = Math.floor(rawSteps);
  if (steps === 0) return { ok: false, error: "移动格数必须大于 0" };
  const from = actor.position;
  const to = Math.max(0, Math.min(chase.trackLength - 1, from + steps));
  const cost = Math.abs(to - from);
  if (cost < 1) return { ok: false, error: "已经到达追逐边界" };
  if (actor.actionPoints < cost) {
    return { ok: false, error: "行动点不足：需要 " + cost + "，剩余 " + actor.actionPoints };
  }
  actor.position = to;
  actor.actionPoints -= cost;

  pushLog(state, {
    kind: "ACTION",
    actorId: actor.id,
    targetId: null,
    text:
      actor.name +
      " " +
      (steps > 0 ? "前进" : "后退") +
      " " +
      cost +
      " 个地点（" +
      from +
      " → " +
      to +
      "），剩余行动点 " +
      actor.actionPoints,
    data: { rollType: "CHASE_MOVE", from, to, cost, actionPoints: actor.actionPoints }
  });

  if (actor.side === "PREY" && to >= chase.trackLength - 1) {
    chase.status = "ESCAPED";
    chase.ending = actor.name + " 到达最后一个地点，成功逃脱";
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: chase.ending,
      data: { rollType: "CHASE_ESCAPED" }
    });
    return { ok: true, escaped: true };
  }

  const contacted = chase.participants.some(
    (participant) =>
      participant.side === "PREY" &&
      participant.position === to &&
      participant.id !== actor.id
  );
  if (actor.side === "CHASER" && contacted) {
    pushLog(state, {
      kind: "SYSTEM",
      actorId: actor.id,
      targetId: null,
      text: actor.name + " 追上并进入逃离者所在地点，可以发起攻击。",
      data: { rollType: "CHASE_CONTACT", position: to }
    });
  }
  return { ok: true, contacted };
}

export interface ChaseTurnResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly newRound?: boolean;
  readonly nextActorId?: string | null;
}

/** 结束当前单位回合；跑完一轮后重置所有行动点并进入下一轮。 */
export function chaseEndTurn(state: CombatState): ChaseTurnResult {
  const chase = state.chase;
  if (chase === null || chase.status !== "ACTIVE") {
    return { ok: false, error: "当前没有进行中的追逐" };
  }
  chase.activeIndex += 1;
  if (chase.activeIndex >= chase.order.length) {
    chase.activeIndex = 0;
    chase.round += 1;
    for (const participant of chase.participants) {
      participant.actionPoints = participant.maxActionPoints;
    }
    pushLog(state, {
      kind: "SYSTEM",
      actorId: null,
      targetId: null,
      text: "追逐进入第 " + chase.round + " 轮，所有参与者行动点已重置。",
      data: { rollType: "CHASE_ROUND", round: chase.round }
    });
    return { ok: true, newRound: true, nextActorId: chaseCurrentActorId(chase) };
  }
  return { ok: true, nextActorId: chaseCurrentActorId(chase) };
}

export function endChase(state: CombatState, reason: string): void {
  if (state.chase === null) return;
  state.chase.status = "ENDED";
  state.chase.ending = reason;
  pushLog(state, {
    kind: "SYSTEM",
    actorId: null,
    targetId: null,
    text: reason,
    data: { rollType: "CHASE_END" }
  });
}
