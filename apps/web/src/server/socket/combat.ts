import type { Server as SocketServer, Socket } from "socket.io";
import {
  advanceToNextEvent,
  applyForcedSkips,
  chaseAttackIssue,
  chaseCurrentActorId,
  chaseEndTurn,
  chaseMove,
  chaseWithdraw,
  currentActorId,
  endCombat,
  endTurn,
  findParticipant,
  pushLog,
  reactionTargetIdsForAction,
  readyParticipants,
  resolveChaseAttack,
  resolveInitiativeTurn,
  resolvePending,
  startChase,
  submitAction,
  type ActionSubmission,
  type DefenseReaction
} from "@touhou/combat";
import { spellEffectsOf } from "@touhou/rules";
import {
  canControl,
  controlledReadyParticipantId,
  loadCombatRuntime,
  viewForUser,
  type CombatRuntime
} from "@/server/combat/runtime";
import { allowedReactionTypes, allowedReactionTypesForParticipant, attackOptionsForParticipant, validateCombatAction, type WeaponLike } from "@/server/combat/options";
import { prepareSpellcardAction } from "@/server/combat/spellcards";
import { saveCombatState } from "@/server/combat/setup";
import { findSummonCard, summonTemplateFromCard } from "@/server/combat/summon";
import { prisma } from "@/server/db/prisma";
import type {
  Ack,
  CombatActionPayload,
  CombatJoinAck,
  CombatReactionPayload,
  CombatReactionRequest,
  CombatUpdate
} from "@/shared/socket";

type AckCallback<T extends Ack> = (result: T) => void;

const roomChannel = (roomId: string): string => "room:" + roomId;
const combatChannel = (combatId: string): string => "combat:" + combatId;

const ACTION_KINDS: readonly string[] = [
  "DANMAKU",
  "SPELLCARD",
  "MAGIC",
  "DEFEND",
  "DODGE",
  "COUNTER",
  "ITEM",
  "FLEE",
  "PASS",
  "OUT_OF_RULE"
];

function userIdOf(socket: { data: unknown }): string | null {
  const id = (socket.data as { userId?: unknown }).userId;
  return typeof id === "string" ? id : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function broadcastCombat(io: SocketServer, runtime: CombatRuntime): Promise<void> {
  const sockets = await io.in(combatChannel(runtime.combatId)).fetchSockets();
  for (const target of sockets) {
    const userId = userIdOf(target);
    if (userId === null) continue;
    const role = runtime.roles.get(userId);
    if (role === undefined) continue;
    const update: CombatUpdate = { combatId: runtime.combatId, view: viewForUser(runtime, userId) };
    target.emit("combat:update", update);
  }
}

async function persistAndBroadcast(io: SocketServer, runtime: CombatRuntime): Promise<void> {
  await saveCombatState(runtime.combatId, runtime.state);
  await broadcastCombat(io, runtime);
}

async function emitReactionRequest(
  io: SocketServer,
  runtime: CombatRuntime,
  actorId: string,
  targetId: string,
  options?: CombatReactionRequest["options"]
): Promise<void> {
  const actor = runtime.state.participants.find((item) => item.id === actorId);
  const target = runtime.state.participants.find((item) => item.id === targetId);
  if (actor === undefined || target === undefined) return;
  const payload: CombatReactionRequest = {
    combatId: runtime.combatId,
    actorId,
    actorName: actor.name,
    targetId,
    targetName: target.name,
    options: options ?? allowedReactionTypesForParticipant(runtime.pack, runtime.attackSkills, targetId)
  };
  io.to(combatChannel(runtime.combatId)).emit("combat:reaction-request", payload);
}

function isEnded(state: CombatRuntime["state"]): boolean {
  return state.phase === "ENDED";
}

function kpUserIds(runtime: CombatRuntime): string[] {
  const ids: string[] = [];
  for (const [userId, role] of runtime.roles.entries()) {
    if (role === "KP") ids.push(userId);
  }
  return ids;
}

/** 召唤入场的新单位由 KP 接管；若服务端解析出了独立卡片，同时生成攻击选项。 */
function syncSummonedParticipants(
  runtime: CombatRuntime,
  summonTemplate: ActionSubmission["summonTemplate"]
): string[] {
  const kpIds = kpUserIds(runtime);
  const created: string[] = [];
  for (const participant of runtime.state.participants) {
    if (participant.summonedBy === null || participant.summonedBy === undefined) continue;
    if (runtime.controllers.has(participant.id)) continue;
    runtime.controllers.set(participant.id, kpIds);
    created.push(participant.id);
    if (summonTemplate !== undefined) {
      const weapons = (summonTemplate.weapons ?? []) as readonly WeaponLike[];
      const options = attackOptionsForParticipant(
        runtime.pack,
        { id: participant.id, kind: "NPC", characterId: null, skills: participant.skills },
        weapons
      );
      runtime.attackOptions.set(participant.id, options);
      runtime.attackSkills.set(participant.id, options.map((option) => option.skillId));
    }
  }
  return created;
}

export async function tryResolveCombat(
  io: SocketServer,
  runtime: CombatRuntime
): Promise<boolean> {
  if (isEnded(runtime.state)) return false;
  // 追逐轮与普通 ATB / 先攻轮分开处理，避免两套回合系统互相抢行动。
  if (runtime.state.chase !== null && runtime.state.chase.status === "ACTIVE") return false;
  if (runtime.pendingReactions.size > 0) return false;
  applyForcedSkips(runtime.state);

  if (runtime.pack.combat.mode === "INITIATIVE") {
    const actorId = currentActorId(runtime.state);
    if (actorId === null) return false;
    if (runtime.state.pending[actorId] === undefined) return false;
    resolveInitiativeTurn(runtime.pack, runtime.state, runtime.reactions);
    runtime.reactions = {};
    if (isEnded(runtime.state) === false) endTurn(runtime.pack, runtime.state);
    await persistAndBroadcast(io, runtime);
    return true;
  }

  const ready = readyParticipants(runtime.state);
  if (ready.length === 0) return false;
  for (const participant of ready) {
    if (runtime.state.pending[participant.id] === undefined) return false;
  }
  resolvePending(runtime.pack, runtime.state, runtime.reactions);
  runtime.reactions = {};
  if (isEnded(runtime.state) === false) advanceToNextEvent(runtime.pack, runtime.state);
  await persistAndBroadcast(io, runtime);
  return true;
}

async function tryResolveChaseAttack(
  io: SocketServer,
  runtime: CombatRuntime
): Promise<boolean> {
  const pending = runtime.chaseAttack;
  if (pending === null) return false;
  const chase = runtime.state.chase;
  if (chase === null || chase.status !== "ACTIVE") {
    runtime.chaseAttack = null;
    runtime.pendingReactions.clear();
    runtime.reactions = {};
    return false;
  }
  if (runtime.pendingReactions.size > 0) return false;
  runtime.chaseAttack = null;
  const reactions = runtime.reactions;
  runtime.reactions = {};
  const result = resolveChaseAttack(runtime.pack, runtime.state, pending, reactions);
  if (result.ok === false) {
    pushLog(runtime.state, {
      kind: "SYSTEM",
      actorId: pending.actorId,
      targetId: pending.targetId,
      text: "追逐攻击未结算：" + (result.error ?? "未知原因")
    });
  }
  await persistAndBroadcast(io, runtime);
  return true;
}

async function maybeStartPendingFlee(io: SocketServer, runtime: CombatRuntime): Promise<boolean> {
  const pending = runtime.pendingFlee;
  if (pending === null) return false;
  runtime.pendingFlee = null;

  const prey = findParticipant(runtime.state, pending.targetId);
  if (prey === undefined || prey.defeated || runtime.state.phase === "ENDED") return false;
  if (runtime.state.chase !== null && runtime.state.chase.status === "ACTIVE") return false;

  const chasers = runtime.state.participants
    .filter(
      (participant) =>
        participant.defeated === false &&
        participant.id !== prey.id &&
        participant.faction !== prey.faction
    )
    .map((participant) => participant.id);
  if (chasers.length === 0) return false;

  const result = startChase(runtime.pack, runtime.state, {
    preyId: prey.id,
    chaserIds: chasers,
    trackLength: 10,
    initialLead: 1,
    allowImmediateEscape: false
  });
  if (result.ok !== true) return false;
  await persistAndBroadcast(io, runtime);
  return true;
}

async function handleJoin(
  socket: Socket,
  combatId: unknown,
  ack: AckCallback<CombatJoinAck>
): Promise<void> {
  const userId = userIdOf(socket);
  if (userId === null || typeof combatId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  if (runtime.roles.has(userId) === false) {
    ack({ ok: false, error: "你不在这个房间里" });
    return;
  }
  await socket.join(combatChannel(combatId));
  ack({ ok: true, view: viewForUser(runtime, userId) });
}

async function handleAction(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as { combatId?: unknown; actorId?: unknown; action?: unknown };
  if (userId === null || typeof input.combatId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  const requestedActor = typeof input.actorId === "string" ? input.actorId : controlledReadyParticipantId(runtime, userId);
  if (requestedActor === null || canControl(runtime, userId, requestedActor) === false) {
    ack({ ok: false, error: "你不能操控这个单位" });
    return;
  }
  const raw = (input.action ?? {}) as Record<string, unknown>;
  const kind = raw.kind;
  if (typeof kind !== "string" || ACTION_KINDS.includes(kind) === false) {
    ack({ ok: false, error: "行动类型不合法" });
    return;
  }
  const requestedSkill = asString(raw.skill);
  const actualAttack =
    kind === "DANMAKU"
      ? runtime.attackOptions.get(requestedActor)?.find((option) => option.skillId === requestedSkill)
      : undefined;
  let action: ActionSubmission = {
    actorId: requestedActor,
    kind: kind as ActionSubmission["kind"],
    targetId: asString(raw.targetId) ?? null,
    skill: requestedSkill,
    // 伤害不由客户端决定：服务端按角色实际装备 / 规则包覆盖客户端传来的表达式。
    damage: actualAttack?.damage ?? asString(raw.damage),
    accuracyMod: asNumber(raw.accuracyMod),
    atbCost: asNumber(raw.atbCost),
    name: asString(raw.name),
    spellId: asString(raw.spellId),
    spellCardId: asString(raw.spellCardId),
    mpCost: asNumber(raw.mpCost),
    sanCost: asString(raw.sanCost),
    spellcardMode: raw.spellcardMode === "DECLARATION" || raw.spellcardMode === "CONSUMPTION" ? raw.spellcardMode : undefined,
    declarationHp: asNumber(raw.declarationHp),
    declarationDurationTicks: asNumber(raw.declarationDurationTicks)
  };
  if (action.kind === "MAGIC") {
    const spell = runtime.pack.pack.magic?.spells.find(
      (item) => item.id === action.spellId || item.name === action.name
    );
    const summonEffect = spell === undefined
      ? undefined
      : spellEffectsOf(spell).find((effect) => effect.type === "SUMMON");
    if (spell !== undefined && summonEffect !== undefined) {
      const cards = await prisma.card.findMany({
        where: {
          roomId: runtime.roomId,
          scope: "ROOM",
          type: "NPC",
          system: runtime.pack.system
        },
        select: { name: true, stats: true }
      });
      const card = findSummonCard(cards, summonEffect.name);
      const template = card === null ? null : summonTemplateFromCard(card, runtime.pack);
      if (template !== null) action = { ...action, summonTemplate: template };
    }
  }

  if (action.kind === "SPELLCARD") {
    const actor = findParticipant(runtime.state, requestedActor);
    if (actor === undefined) {
      ack({ ok: false, error: "行动单位不存在" });
      return;
    }
    const cards = runtime.spellcardsByParticipant.get(actor.id) ?? [];
    const prepared = prepareSpellcardAction(runtime.pack, actor, cards, action);
    if (prepared.ok === false) {
      ack({ ok: false, error: prepared.error });
      return;
    }
    action = prepared.action;
  }
  if (action.kind === "FLEE") {
    if (runtime.state.chase !== null && runtime.state.chase.status === "ACTIVE") {
      ack({ ok: false, error: "追逐进行中：请使用追逐移动或结束回合" });
      return;
    }
    const actor = findParticipant(runtime.state, requestedActor);
    if (actor === undefined) {
      ack({ ok: false, error: "行动单位不存在" });
      return;
    }
    const chasers = runtime.state.participants
      .filter(
        (participant) =>
          participant.defeated === false &&
          participant.id !== actor.id &&
          participant.faction !== actor.faction
      )
      .map((participant) => participant.id);
    if (chasers.length > 0) {
      const chaseResult = startChase(runtime.pack, runtime.state, {
        preyId: actor.id,
        chaserIds: chasers,
        trackLength: 10,
        // 从已有战斗中逃跑：不是从远处起跑，先给 1 格接触距离；
        // 且不能凭速度检定直接脱战，必须进入追逐流程由追逐规则决定胜负。
        initialLead: 1,
        allowImmediateEscape: false
      });
      if (chaseResult.ok === false) {
        ack({ ok: false, error: chaseResult.error ?? "无法建立追逐" });
        return;
      }
      if (chaseResult.escapedImmediately !== true) {
        runtime.pendingReactions.clear();
        runtime.reactions = {};
        runtime.state.pending = {};
        await persistAndBroadcast(io, runtime);
        ack({ ok: true });
        return;
      }
      // 速度检定直接甩开追逐者：继续按普通 FLEE 结算，把该单位移出战斗。
    }
  }

  if (runtime.state.chase !== null && runtime.state.chase.status === "ACTIVE") {
    ack({ ok: false, error: "追逐进行中：请使用追逐移动或结束回合" });
    return;
  }

  const actionError = validateCombatAction({ pack: runtime.pack, state: runtime.state, attackSkills: runtime.attackSkills }, action);
  if (typeof actionError === "string") {
    ack({ ok: false, error: actionError });
    return;
  }
  if (submitAction(runtime.state, action) === false) {
    ack({ ok: false, error: "现在不能行动，或该单位未就绪" });
    return;
  }
  const reactionTargetIds = reactionTargetIdsForAction(runtime.pack, runtime.state, action);
  if (reactionTargetIds.length > 0) {
    const canFlee =
      (action.kind === "DANMAKU" || action.kind === "MAGIC") &&
      reactionTargetIds.length === 1;
    const magicOptions: CombatReactionRequest["options"] | undefined =
      action.kind === "MAGIC"
        ? canFlee
          ? ["PASS", "DODGE", "FLEE"]
          : ["PASS", "DODGE"]
        : undefined;
    for (const targetId of reactionTargetIds) {
      runtime.pendingReactions.set(targetId, action.actorId);
      const options =
        magicOptions ??
        allowedReactionTypesForParticipant(runtime.pack, runtime.attackSkills, targetId, canFlee);
      await emitReactionRequest(io, runtime, action.actorId, targetId, options);
    }
  }
  const resolved = await tryResolveCombat(io, runtime);
  if (resolved === false) {
    await broadcastCombat(io, runtime);
  } else {
    syncSummonedParticipants(runtime, action.summonTemplate);
    await maybeStartPendingFlee(io, runtime);
  }
  ack({ ok: true });
}

async function handleReaction(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as { combatId?: unknown; targetId?: unknown; reaction?: unknown };
  if (userId === null || typeof input.combatId !== "string" || typeof input.targetId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  if (canControl(runtime, userId, input.targetId) === false) {
    ack({ ok: false, error: "你不能操控这个单位" });
    return;
  }
  const raw = (input.reaction ?? {}) as CombatReactionPayload;
  const target = runtime.state.participants.find((item) => item.id === input.targetId);
  if (target === undefined) {
    ack({ ok: false, error: "应对目标不存在" });
    return;
  }
  const pendingActorId = runtime.pendingReactions.get(input.targetId);
  const pendingAction =
    pendingActorId === undefined ? undefined : runtime.state.pending[pendingActorId];
  const canFleeReaction =
    raw.type === "FLEE" &&
    runtime.chaseAttack === null &&
    pendingActorId !== undefined &&
    (pendingAction?.kind === "DANMAKU" || pendingAction?.kind === "MAGIC") &&
    runtime.pendingReactions.size === 1;
  const allowedTypes = allowedReactionTypes(runtime.pack);
  if (canFleeReaction === false && allowedTypes.includes(raw.type) === false) {
    ack({ ok: false, error: "本规则包不支持该应对" });
    return;
  }
  const fleeAfterResolution = canFleeReaction;
  if (fleeAfterResolution) {
    runtime.pendingFlee = { targetId: input.targetId, actorId: pendingActorId ?? "" };
  }
  let reactionType: "PASS" | "DEFEND" | "DODGE" | "COUNTER" =
    raw.type === "FLEE" ? "PASS" : raw.type;
  let reactionSkill = asString(raw.skill);
  if (fleeAfterResolution) {
    pushLog(runtime.state, {
      kind: "ACTION",
      actorId: target.id,
      targetId: pendingActorId ?? null,
      text: target.name + " 放弃防御，试图逃跑。",
      data: { rollType: "REACTION_FLEE" }
    });
  }
  if (reactionType === "DODGE") {
    const candidate = reactionSkill ?? "DODGE";
    const isDodge = candidate === "DODGE";
    const isGraze = candidate === "GRAZE" && runtime.pack.skills.some((skill) => skill.id === "GRAZE");
    if (isDodge === false && isGraze === false) {
      ack({ ok: false, error: "应对技能不合法" });
      return;
    }
    reactionSkill = candidate;
  }
  if (reactionType === "COUNTER") {
    const hasCoc7BrawlBase =
      runtime.pack.system === "COC7" &&
      runtime.pack.skills.some((skill) => skill.id === "FIGHTING_BRAWL");
    if (hasCoc7BrawlBase) {
      // COC7 标准：反击使用格斗（斗殴）检定；卡面没写也按基础值 25 计算。
      reactionSkill = "FIGHTING_BRAWL";
    } else {
      const allowed = runtime.attackSkills.get(input.targetId) ?? [];
      const candidate = reactionSkill ?? allowed[0];
      if (candidate === undefined || allowed.includes(candidate) === false) {
        // 非 COC7 包没有可用反击技能时不能把应对窗口卡死：按 PASS 继续结算并记录原因。
        reactionType = "PASS";
        reactionSkill = undefined;
        pushLog(runtime.state, {
          kind: "SYSTEM",
          actorId: target.id,
          targetId: null,
          text: target.name + " 没有可用的反击技能，本次按未应对处理",
          data: { rollType: "COUNTER_FALLBACK" }
        });
      } else {
        reactionSkill = candidate;
      }
    }
  }
  runtime.pendingReactions.delete(input.targetId);
  runtime.reactions[input.targetId] = { type: reactionType, skill: reactionSkill };
  const resolvedChase = await tryResolveChaseAttack(io, runtime);
  const resolved = resolvedChase ? true : await tryResolveCombat(io, runtime);
  if (resolved === false) {
    await broadcastCombat(io, runtime);
  } else {
    await maybeStartPendingFlee(io, runtime);
  }
  ack({ ok: true });
}

async function handleChaseMove(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as { combatId?: unknown; actorId?: unknown; steps?: unknown };
  if (userId === null || typeof input.combatId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  if (runtime.chaseAttack !== null) {
    ack({ ok: false, error: "追逐攻击正在等待目标应对，请先完成结算" });
    return;
  }
  const actorId = typeof input.actorId === "string" ? input.actorId : null;
  if (actorId === null || canControl(runtime, userId, actorId) === false) {
    ack({ ok: false, error: "你不能操控这个单位" });
    return;
  }
  const steps = typeof input.steps === "number" && Number.isFinite(input.steps) ? Math.trunc(input.steps) : 0;
  const result = chaseMove(runtime.state, actorId, steps);
  if (result.ok === false) {
    ack({ ok: false, error: result.error ?? "追逐移动失败" });
    return;
  }
  if (result.escaped === true) {
    endCombat(runtime.state, "追逐结束：逃离者成功脱身");
  }
  await persistAndBroadcast(io, runtime);
  ack({ ok: true });
}

async function handleChaseWithdraw(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as { combatId?: unknown; actorId?: unknown; reason?: unknown };
  if (userId === null || typeof input.combatId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  if (runtime.chaseAttack !== null) {
    ack({ ok: false, error: "追逐攻击正在等待目标应对，请先完成结算" });
    return;
  }
  const chase = runtime.state.chase;
  const actorId =
    typeof input.actorId === "string"
      ? input.actorId
      : chase === null
        ? null
        : chaseCurrentActorId(chase);
  if (actorId === null) {
    ack({ ok: false, error: "当前没有可放弃追逐的单位" });
    return;
  }
  if (canControl(runtime, userId, actorId) === false) {
    ack({ ok: false, error: "你不能操控这个单位" });
    return;
  }
  const reason = typeof input.reason === "string" ? input.reason : undefined;
  const result = chaseWithdraw(runtime.state, actorId, reason);
  if (result.ok === false) {
    ack({ ok: false, error: result.error ?? "放弃追逐失败" });
    return;
  }
  await persistAndBroadcast(io, runtime);
  ack({ ok: true });
}

async function handleChaseEndTurn(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as { combatId?: unknown; actorId?: unknown };
  if (userId === null || typeof input.combatId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  if (runtime.chaseAttack !== null) {
    ack({ ok: false, error: "追逐攻击正在等待目标应对，请先完成结算" });
    return;
  }
  const chase = runtime.state.chase;
  const currentId = chase === null ? null : chaseCurrentActorId(chase);
  if (currentId === null || canControl(runtime, userId, currentId) === false) {
    ack({ ok: false, error: "还没轮到你操控的单位行动" });
    return;
  }
  const result = chaseEndTurn(runtime.state);
  if (result.ok === false) {
    ack({ ok: false, error: result.error ?? "结束追逐回合失败" });
    return;
  }
  await persistAndBroadcast(io, runtime);
  ack({ ok: true });
}

async function handleChaseAttack(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as {
    combatId?: unknown;
    actorId?: unknown;
    targetId?: unknown;
    skill?: unknown;
    damage?: unknown;
    accuracyMod?: unknown;
  };
  if (
    userId === null ||
    typeof input.combatId !== "string" ||
    typeof input.targetId !== "string"
  ) {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  const chase = runtime.state.chase;
  if (chase === null || chase.status !== "ACTIVE") {
    ack({ ok: false, error: "当前没有进行中的追逐" });
    return;
  }
  const actorId = typeof input.actorId === "string" ? input.actorId : chaseCurrentActorId(chase);
  if (actorId === null || canControl(runtime, userId, actorId) === false) {
    ack({ ok: false, error: "你不能操控这个单位" });
    return;
  }
  if (runtime.chaseAttack !== null) {
    ack({ ok: false, error: "已有一次追逐攻击正在等待应对" });
    return;
  }
  const issue = chaseAttackIssue(runtime.state, actorId, input.targetId);
  if (issue !== null) {
    ack({ ok: false, error: issue });
    return;
  }
  const allowedSkills = runtime.attackSkills.get(actorId) ?? [];
  const skill = asString(input.skill) ?? allowedSkills[0];
  const actualAttack = runtime.attackOptions
    .get(actorId)
    ?.find((option) => option.skillId === skill);
  const damage = actualAttack?.damage ?? "1d6";
  const accuracyMod = asNumber(input.accuracyMod);
  const action: ActionSubmission = {
    actorId,
    kind: "DANMAKU",
    targetId: input.targetId,
    skill,
    damage,
    accuracyMod
  };
  const actionError = validateCombatAction(
    { pack: runtime.pack, state: runtime.state, attackSkills: runtime.attackSkills },
    action
  );
  if (typeof actionError === "string") {
    ack({ ok: false, error: actionError });
    return;
  }
  runtime.chaseAttack = { actorId, targetId: input.targetId, skill, damage, accuracyMod };
  runtime.reactions = {};
  runtime.pendingReactions.clear();
  runtime.pendingReactions.set(input.targetId, actorId);
  await emitReactionRequest(
    io,
    runtime,
    actorId,
    input.targetId,
    allowedReactionTypes(runtime.pack)
  );
  await broadcastCombat(io, runtime);
  ack({ ok: true });
}

async function handleAbort(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as { combatId?: unknown };
  if (userId === null || typeof input.combatId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  if (runtime.roles.get(userId) !== "KP") {
    ack({ ok: false, error: "只有 KP 能中止战斗" });
    return;
  }
  if (isEnded(runtime.state)) {
    ack({ ok: true });
    return;
  }
  runtime.pendingReactions.clear();
  runtime.reactions = {};
  runtime.chaseAttack = null;
  runtime.pendingFlee = null;
  runtime.state.chase = null;
  endCombat(runtime.state, "KP 中止了战斗");
  await saveCombatState(runtime.combatId, runtime.state);
  await broadcastCombat(io, runtime);
  io.to(roomChannel(runtime.roomId)).emit("combat:aborted", { combatId: runtime.combatId });
  ack({ ok: true });
}

async function handleForceResolve(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as { combatId?: unknown };
  if (userId === null || typeof input.combatId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  if (runtime.roles.get(userId) !== "KP") {
    ack({ ok: false, error: "只有 KP 能强制结算" });
    return;
  }
  if (runtime.state.chase !== null && runtime.state.chase.status === "ACTIVE") {
    if (runtime.chaseAttack === null) {
      ack({ ok: false, error: "追逐进行中：请等待移动结算，或直接中止战斗" });
      return;
    }
    for (const targetId of runtime.pendingReactions.keys()) {
      runtime.reactions[targetId] = { type: "PASS" };
    }
    runtime.pendingReactions.clear();
    const resolved = await tryResolveChaseAttack(io, runtime);
    if (resolved === false) await broadcastCombat(io, runtime);
    ack({ ok: true });
    return;
  }
  for (const targetId of runtime.pendingReactions.keys()) {
    runtime.reactions[targetId] = { type: "PASS" };
  }
  runtime.pendingReactions.clear();
  if (runtime.pack.combat.mode === "INITIATIVE") {
    const actorId = currentActorId(runtime.state);
    if (actorId !== null && runtime.state.pending[actorId] === undefined) {
      submitAction(runtime.state, { actorId, kind: "PASS" });
    }
  } else {
    for (const participant of readyParticipants(runtime.state)) {
      if (runtime.state.pending[participant.id] === undefined) {
        submitAction(runtime.state, { actorId: participant.id, kind: "PASS" });
      }
    }
  }
  const resolved = await tryResolveCombat(io, runtime);
  if (resolved === false) {
    await broadcastCombat(io, runtime);
  } else {
    await maybeStartPendingFlee(io, runtime);
  }
  ack({ ok: true });
}

export function registerCombatHandlers(io: SocketServer, socket: Socket): void {
  socket.on("combat:join", (combatId: unknown, ack: AckCallback<CombatJoinAck>) => {
    void handleJoin(socket, combatId, ack);
  });
  socket.on("combat:action", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleAction(io, socket, payload, ack);
  });
  socket.on("combat:reaction", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleReaction(io, socket, payload, ack);
  });
  socket.on("combat:chase-move", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleChaseMove(io, socket, payload, ack);
  });
  socket.on("combat:chase-end-turn", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleChaseEndTurn(io, socket, payload, ack);
  });
  socket.on("combat:chase-attack", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleChaseAttack(io, socket, payload, ack);
  });
  socket.on("combat:chase-withdraw", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleChaseWithdraw(io, socket, payload, ack);
  });
  socket.on("combat:force-resolve", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleForceResolve(io, socket, payload, ack);
  });
  socket.on("combat:abort", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleAbort(io, socket, payload, ack);
  });
}
