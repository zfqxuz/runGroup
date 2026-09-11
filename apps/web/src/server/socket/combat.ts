import type { Server as SocketServer, Socket } from "socket.io";
import {
  advanceToNextEvent,
  applyForcedSkips,
  endCombat,
  currentActorId,
  endTurn,
  readyParticipants,
  resolveInitiativeTurn,
  resolvePending,
  submitAction,
  type ActionSubmission,
  type DefenseReaction
} from "@touhou/combat";
import { isHostileSpell, spellTargeting } from "@touhou/rules";
import {
  canControl,
  controlledReadyParticipantId,
  loadCombatRuntime,
  viewForUser,
  type CombatRuntime
} from "@/server/combat/runtime";
import { allowedReactionTypes, validateCombatAction } from "@/server/combat/options";
import { saveCombatState } from "@/server/combat/setup";
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

function needsReaction(pack: CombatRuntime["pack"], action: ActionSubmission): boolean {
  const target = action.targetId ?? null;
  if (target === null || target === action.actorId) return false;
  if (action.kind === "DANMAKU") return true;
  if (action.kind === "MAGIC") {
    const spell = pack.pack.magic?.spells.find((item) => item.id === action.spellId || item.name === action.name);
    if (spell === undefined) return false;
    // 群体法术不做单个反应窗口；单体攻击性法术（ENEMY / ANY）需要目标应对。
    const targeting = spellTargeting(spell);
    return spell.target === "ONE" && isHostileSpell(spell) && targeting !== "ALLY" && targeting !== "SELF";
  }
  return false;
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
    options: options ?? allowedReactionTypes(runtime.pack)
  };
  io.to(combatChannel(runtime.combatId)).emit("combat:reaction-request", payload);
}

function isEnded(state: CombatRuntime["state"]): boolean {
  return state.phase === "ENDED";
}

export async function tryResolveCombat(
  io: SocketServer,
  runtime: CombatRuntime
): Promise<boolean> {
  if (isEnded(runtime.state)) return false;
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
  const action: ActionSubmission = {
    actorId: requestedActor,
    kind: kind as ActionSubmission["kind"],
    targetId: asString(raw.targetId) ?? null,
    skill: asString(raw.skill),
    damage: asString(raw.damage),
    accuracyMod: asNumber(raw.accuracyMod),
    atbCost: asNumber(raw.atbCost),
    name: asString(raw.name),
    spellId: asString(raw.spellId),
    mpCost: asNumber(raw.mpCost),
    sanCost: asString(raw.sanCost),
    spellcardMode: raw.spellcardMode === "DECLARATION" || raw.spellcardMode === "CONSUMPTION" ? raw.spellcardMode : undefined,
    declarationHp: asNumber(raw.declarationHp),
    declarationDurationTicks: asNumber(raw.declarationDurationTicks)
  };
  const actionError = validateCombatAction({ pack: runtime.pack, state: runtime.state, attackSkills: runtime.attackSkills }, action);
  if (typeof actionError === "string") {
    ack({ ok: false, error: actionError });
    return;
  }
  if (submitAction(runtime.state, action) === false) {
    ack({ ok: false, error: "现在不能行动，或该单位未就绪" });
    return;
  }
  const targetId = action.targetId ?? null;
  if (needsReaction(runtime.pack, action) && targetId !== null) {
    runtime.pendingReactions.set(targetId, action.actorId);
    const magicOptions: CombatReactionRequest["options"] | undefined =
      action.kind === "MAGIC" ? ["PASS", "DODGE"] : undefined;
    await emitReactionRequest(io, runtime, action.actorId, targetId, magicOptions);
  }
  const resolved = await tryResolveCombat(io, runtime);
  if (resolved === false) await broadcastCombat(io, runtime);
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
  const allowedTypes = allowedReactionTypes(runtime.pack);
  if (allowedTypes.includes(raw.type) === false) {
    ack({ ok: false, error: "本规则包不支持该应对" });
    return;
  }
  const target = runtime.state.participants.find((item) => item.id === input.targetId);
  if (target === undefined) {
    ack({ ok: false, error: "应对目标不存在" });
    return;
  }
  let reactionSkill = asString(raw.skill);
  if (raw.type === "DODGE") {
    const candidate = reactionSkill ?? "DODGE";
    const isDodge = candidate === "DODGE";
    const isGraze = candidate === "GRAZE" && runtime.pack.skills.some((skill) => skill.id === "GRAZE");
    if (isDodge === false && isGraze === false) {
      ack({ ok: false, error: "应对技能不合法" });
      return;
    }
    reactionSkill = candidate;
  }
  if (raw.type === "COUNTER") {
    const allowed = runtime.attackSkills.get(input.targetId) ?? [];
    const candidate = reactionSkill ?? allowed[0];
    if (candidate === undefined || allowed.includes(candidate) === false) {
      ack({ ok: false, error: "应对技能不合法" });
      return;
    }
    reactionSkill = candidate;
  }
  runtime.pendingReactions.delete(input.targetId);
  runtime.reactions[input.targetId] = { type: raw.type, skill: reactionSkill };
  const resolved = await tryResolveCombat(io, runtime);
  if (resolved === false) await broadcastCombat(io, runtime);
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
  if (resolved === false) await broadcastCombat(io, runtime);
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
  socket.on("combat:force-resolve", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleForceResolve(io, socket, payload, ack);
  });
  socket.on("combat:abort", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleAbort(io, socket, payload, ack);
  });
}
