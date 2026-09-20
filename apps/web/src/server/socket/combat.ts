import type { Server as SocketServer, Socket } from "socket.io";
import {
  advanceToNextEvent,
  applyForcedSkips,
  beginDpRound,
  buildInitiativeOrder,
  currentDpActorId,
  declareDp,
  findParticipant,
  chaseAttackIssue,
  chaseCurrentActorId,
  chaseEndTurn,
  chaseMove,
  chaseWithdraw,
  currentActorId,
  endCombat,
  endTurn,
  isThrownOutOfRange,
  matchRangeBand,
  pointBlankBonusDice,
  pushLog,
  reactionTargetIdsForAction,
  readyParticipants,
  resolveChaseAttack,
  thrownRangeFeet,
  resolveDpTurn,
  resolveInitiativeTurn,
  resolvePending,
  setInitiativeOrder,
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
import { allowedReactionTypes, allowedReactionTypesForParticipant, attackOptionsForParticipant, dpReactionTypesForParticipant, reactionTypesForAttack, validateCombatAction, type WeaponLike } from "@/server/combat/options";
import { consumeItemUse, prepareItemAction, type CombatItemOption } from "@/server/combat/items";
import { prepareSpellcardAction } from "@/server/combat/spellcards";
import { loadCombatDistance } from "@/server/combat/range";
import type { RoutineAttackStep } from "@touhou/combat";
import { saveCombatState } from "@/server/combat/setup";
import { findSummonCard, summonTemplateFromCard } from "@/server/combat/summon";
import { createPersistentSummonCard, removeSummonCardById, type SummonOrigin } from "@/server/magic/summons";
import { prisma } from "@/server/db/prisma";
import type {
  Ack,
  CombatActionPayload,
  CombatInitiativeOrderPayload,
  CombatJoinAck,
  CombatReadyWeaponPayload,
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
  "MANEUVER",
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
  // 召唤物被击杀后先清持久卡与地图 Token，再把剩余状态写回。
  await cleanupDefeatedSummons(runtime);
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

/** 召唤入场的新单位由 KP 接管；同时落成一张持久房间 NPC 卡，可被放入地图。 */
async function syncSummonedParticipants(
  runtime: CombatRuntime,
  summonTemplate: ActionSubmission["summonTemplate"],
  origin: SummonOrigin
): Promise<string[]> {
  const kpIds = kpUserIds(runtime);
  const created: string[] = [];
  for (const participant of runtime.state.participants) {
    if (participant.summonedBy === null || participant.summonedBy === undefined) continue;
    if (runtime.controllers.has(participant.id)) continue;
    runtime.controllers.set(participant.id, kpIds);
    created.push(participant.id);
    const weapons = (summonTemplate?.weapons ?? []) as readonly WeaponLike[];
    const options = attackOptionsForParticipant(
      runtime.pack,
      { id: participant.id, kind: "NPC", characterId: null, skills: participant.skills },
      weapons
    );
    runtime.attackOptions.set(participant.id, options);
    runtime.attackSkills.set(participant.id, options.map((option) => option.skillId));

    const template = {
      name: participant.name,
      attributes: participant.attributes,
      derived: {
        hp: participant.maxHp,
        maxHp: participant.maxHp,
        mp: participant.maxMp,
        maxMp: participant.maxMp,
        san: participant.maxSan,
        maxSan: participant.maxSan,
        dp: participant.maxDp,
        maxDp: participant.maxDp
      },
      skills: participant.skills,
      spells: participant.spells,
      damageBonus: participant.damageBonus,
      weapons: summonTemplate?.weapons,
      armorExpression: summonTemplate?.armorExpression ?? String(participant.armor)
    };
    const expiresAt = participant.summonExpiresAtRound ?? null;
    const remainingRounds = expiresAt === null ? 0 : Math.max(0, expiresAt - runtime.state.round);
    await createPersistentSummonCard({
      id: participant.id,
      roomId: runtime.roomId,
      ownerId: null,
      pack: runtime.pack,
      template,
      durationTicks: remainingRounds,
      origin
    }).catch(() => undefined);
    runtime.summonCardIds.add(participant.id);
  }
  return created;
}

/** 召唤物在战斗中被击杀 / 到期后，把持久 NPC 卡和地图 Token 一起清掉。 */
export async function cleanupDefeatedSummons(runtime: CombatRuntime): Promise<void> {
  for (const id of [...runtime.summonCardIds]) {
    const participant = findParticipant(runtime.state, id);
    if (participant === undefined || participant.defeated === true) {
      await removeSummonCardById(id).catch(() => undefined);
      runtime.summonCardIds.delete(id);
    }
  }
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

  if (runtime.pack.combat.mode === "DP") {
    // DP：宣言阶段等待所有单位声明；行动阶段每次只结算当前行动者的一项行动。
    if (runtime.state.phase !== "AWAITING_ACTION") return false;
    const dpActorId = currentDpActorId(runtime.state);
    if (dpActorId === null) return false;
    if (runtime.state.pending[dpActorId] === undefined) return false;
    resolveDpTurn(runtime.pack, runtime.state, runtime.reactions);
    runtime.reactions = {};
    await persistAndBroadcast(io, runtime);
    return true;
  }

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
  let summonOrigin: SummonOrigin | undefined;
  const actualAttack =
    kind === "DANMAKU"
      ? runtime.attackOptions.get(requestedActor)?.find((option) => option.skillId === requestedSkill)
      : undefined;
  const requestedRangeBand = Math.max(0, Math.floor(asNumber(raw.rangeBand) ?? 0));
  const selectedDamageBand =
    actualAttack?.damageBands[requestedRangeBand] ?? actualAttack?.damageBands[0];
  const requestedShots = Math.max(1, Math.min(3, Math.floor(asNumber(raw.shots) ?? 1)));
  const shots =
    actualAttack?.shots !== undefined && actualAttack.shots.includes(requestedShots)
      ? requestedShots
      : 1;
  const rawTargetId = asString(raw.targetId) ?? null;
  const manualPointBlank =
    raw.pointBlank === true && actualAttack?.skillId.startsWith("FIREARMS_") === true;
  let action: ActionSubmission = {
    actorId: requestedActor,
    kind: kind as ActionSubmission["kind"],
    targetId: rawTargetId,
    skill: requestedSkill,
    // 伤害不由客户端决定：服务端按角色实际装备 / 规则包覆盖客户端传来的表达式。
    damage: selectedDamageBand?.expression ?? actualAttack?.damage ?? asString(raw.damage),
    damageType: actualAttack?.damageType,
    element: actualAttack?.element,
    shots,
    maneuver:
      raw.maneuver === "DISARM" || raw.maneuver === "TRIP" || raw.maneuver === "GRAPPLE"
        ? raw.maneuver
        : undefined,
    bonusDice: manualPointBlank ? 1 : 0,
    bonusDiceSource: manualPointBlank ? "近距离点射" : undefined,
    accuracyMod: asNumber(raw.accuracyMod),
    atbCost: asNumber(raw.atbCost),
    name: asString(raw.name),
    spellId: asString(raw.spellId),
    spellCardId: asString(raw.spellCardId),
    mpCost: asNumber(raw.mpCost),
    sanCost: asString(raw.sanCost),
    spellcardMode: raw.spellcardMode === "DECLARATION" || raw.spellcardMode === "CONSUMPTION" ? raw.spellcardMode : undefined,
    declarationHp: asNumber(raw.declarationHp),
    declarationDurationTicks: asNumber(raw.declarationDurationTicks),
    declarationLsc: raw.declarationLsc === true,
    itemCardId: asString(raw.itemCardId),
    grazeSpend:
      raw.grazeSpend === "MP" || raw.grazeSpend === "MELEE_DAMAGE" || raw.grazeSpend === "RANGED_DAMAGE"
        ? raw.grazeSpend
        : undefined,
    // DP（千幻抄）：行动种类、骰数与目标由客户端声明，服务端仍会夹取骰数上限。
    dpAction:
      raw.dpAction === "DANMAKU" || raw.dpAction === "RANGED" || raw.dpAction === "CHASE" || raw.dpAction === "MELEE"
        ? raw.dpAction
        : undefined,
    dpDice: asNumber(raw.dpDice),
    dpSecondaryDice: asNumber(raw.dpSecondaryDice),
    dpTargetIds: Array.isArray(raw.dpTargetIds)
      ? raw.dpTargetIds.filter((id): id is string => typeof id === "string")
      : undefined,
    dpEscalation: asNumber(raw.dpEscalation),
    danmakuDpReduction: asNumber(raw.danmakuDpReduction),
    danmakuBaseDamage: asNumber(raw.danmakuBaseDamage),
    damageAbilityId: asString(raw.damageAbilityId),
    damageTrainingId: asString(raw.damageTrainingId),
    damageWeaponSkill: asString(raw.damageWeaponSkill)
  };

  // U-6：地图上有双方 Token 时，由服务端按实际英尺距离覆盖距离档与近距离奖励。
  if (
    runtime.pack.system === "COC7" &&
    actualAttack !== undefined &&
    rawTargetId !== null &&
    action.kind === "DANMAKU"
  ) {
    const actorParticipant = findParticipant(runtime.state, requestedActor);
    const targetParticipant = findParticipant(runtime.state, rawTargetId);
    if (actorParticipant !== undefined && targetParticipant !== undefined) {
      const distance = await loadCombatDistance(runtime.combatId, actorParticipant.id, targetParticipant.id);
      if (distance !== null) {
        if (actualAttack.skillId === "THROW" && isThrownOutOfRange(actorParticipant.attributes.str, distance.feet)) {
          ack({
            ok: false,
            error:
              "超出投掷最大射程（STR/5 = " +
              Math.floor(actorParticipant.attributes.str / 5) +
              " 码 / " +
              thrownRangeFeet(actorParticipant.attributes.str) +
              " 英尺）"
          });
          return;
        }
        const match = matchRangeBand(
          distance.feet,
          actorParticipant.attributes.dex,
          actualAttack.damageBands
        );
        if (match.bandIndex !== null) {
          const band = actualAttack.damageBands[match.bandIndex];
          if (band !== undefined) action = { ...action, damage: band.expression };
        }
        const autoBonus = pointBlankBonusDice(
          actualAttack.skillId,
          distance.feet,
          actorParticipant.attributes.dex
        );
        action = {
          ...action,
          bonusDice: autoBonus,
          bonusDiceSource: autoBonus > 0 ? "近距离点射（地图距离）" : undefined
        };
      }
    }
  }
  // U-3：多目标 / 多技能 routine。客户端只提交技能 + 目标 + 意图，
  // 伤害 / 距离档 / 奖励骰仍由服务端按角色实际装备与地图距离推导。
  if (kind === "DANMAKU" && Array.isArray(raw.routine) && raw.routine.length > 0) {
    const actorParticipant = findParticipant(runtime.state, requestedActor);
    const routineSteps: RoutineAttackStep[] = [];
    for (const item of raw.routine.slice(0, 8)) {
      const step = (item ?? {}) as Record<string, unknown>;
      const targetId = asString(step.targetId);
      if (targetId === undefined) continue;
      const stepSkill = asString(step.skill) ?? requestedSkill;
      if (stepSkill === undefined) continue;
      const stepAttack = runtime.attackOptions
        .get(requestedActor)
        ?.find((option) => option.skillId === stepSkill);
      const requestedStepBand = Math.max(0, Math.floor(asNumber(step.rangeBand) ?? 0));
      let stepBand = requestedStepBand;
      const manualStepPointBlank =
        step.pointBlank === true && stepAttack?.skillId.startsWith("FIREARMS_") === true;
      let stepBonus = manualStepPointBlank ? 1 : 0;
      let stepBonusSource = manualStepPointBlank ? "近距离点射" : undefined;
      if (runtime.pack.system === "COC7" && stepAttack !== undefined && actorParticipant !== undefined) {
        const distance = await loadCombatDistance(runtime.combatId, requestedActor, targetId);
        if (distance !== null) {
          const match = matchRangeBand(distance.feet, actorParticipant.attributes.dex, stepAttack.damageBands);
          if (match.bandIndex !== null) stepBand = match.bandIndex;
          const autoBonus = pointBlankBonusDice(
            stepAttack.skillId,
            distance.feet,
            actorParticipant.attributes.dex
          );
          if (autoBonus > 0) {
            stepBonus = autoBonus;
            stepBonusSource = "近距离点射（地图距离）";
          }
        }
      }
      const selectedStepBand =
        stepAttack?.damageBands[stepBand] ?? stepAttack?.damageBands[0];
      const requestedStepShots = Math.max(1, Math.min(3, Math.floor(asNumber(step.shots) ?? 1)));
      const stepShots =
        stepAttack?.shots !== undefined && stepAttack.shots.includes(requestedStepShots)
          ? requestedStepShots
          : 1;
      routineSteps.push({
        targetId,
        skill: stepSkill,
        damage: selectedStepBand?.expression ?? stepAttack?.damage,
        damageType: stepAttack?.damageType,
        element: stepAttack?.element,
        shots: stepShots,
        accuracyMod: asNumber(step.accuracyMod),
        bonusDice: stepBonus,
        bonusDiceSource: stepBonusSource,
        penaltyDice: Math.max(0, Math.floor(asNumber(step.penaltyDice) ?? 0))
      });
    }
    if (routineSteps.length === 0) {
      ack({ ok: false, error: "多目标 routine 没有合法的攻击步骤" });
      return;
    }
    action = {
      ...action,
      targetId: routineSteps[0]?.targetId ?? null,
      skill: routineSteps[0]?.skill,
      damage: routineSteps[0]?.damage,
      damageType: routineSteps[0]?.damageType,
      shots: undefined,
      bonusDice: 0,
      bonusDiceSource: undefined,
      routine: routineSteps
    };
  }

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
        select: { id: true, name: true, stats: true }
      });
      const explicitCard = summonEffect.cardId === undefined
        ? null
        : cards.find((item) => item.id === summonEffect.cardId) ?? null;
      const card = explicitCard ?? findSummonCard(cards, summonEffect.name, summonEffect.key);
      const template = card === null ? null : summonTemplateFromCard(card, runtime.pack);
      if (template !== null) action = { ...action, summonTemplate: template };
      const caster = findParticipant(runtime.state, requestedActor);
      summonOrigin = {
        spellId: spell.id,
        spellName: spell.name,
        casterId: requestedActor,
        casterName: caster?.name ?? null
      };
    }
  }

  let preparedItem: CombatItemOption | null = null;
  if (action.kind === "SPELLCARD") {
    const actor = findParticipant(runtime.state, requestedActor);
    if (actor === undefined) {
      ack({ ok: false, error: "行动单位不存在" });
      return;
    }
    const cards = runtime.spellcardsByParticipant.get(actor.id) ?? [];
    const prepared = prepareSpellcardAction(runtime.pack, actor, cards, action, runtime.state);
    if (prepared.ok === false) {
      ack({ ok: false, error: prepared.error });
      return;
    }
    action = prepared.action;
  }
  if (action.kind === "ITEM") {
    const actor = findParticipant(runtime.state, requestedActor);
    if (actor === undefined) {
      ack({ ok: false, error: "行动单位不存在" });
      return;
    }
    const cards = runtime.itemsByParticipant.get(actor.id) ?? [];
    const prepared = prepareItemAction(runtime.pack, actor, cards, action, runtime.state.round);
    if (prepared.ok === false) {
      ack({ ok: false, error: prepared.error });
      return;
    }
    action = prepared.action;
    preparedItem = prepared.item;
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
  if (preparedItem !== null) {
    const itemActor = findParticipant(runtime.state, requestedActor);
    if (itemActor !== undefined) consumeItemUse(itemActor, preparedItem, runtime.state.round);
  }
  const reactionTargetIds = reactionTargetIdsForAction(runtime.pack, runtime.state, action);
  if (reactionTargetIds.length > 0) {
    const canFlee =
      (action.kind === "DANMAKU" || action.kind === "MAGIC" || action.kind === "ITEM") &&
      reactionTargetIds.length === 1;
    const magicOptions: CombatReactionRequest["options"] | undefined =
      action.kind === "MAGIC" || action.kind === "ITEM"
        ? canFlee
          ? ["PASS", "DODGE", "FLEE"]
          : ["PASS", "DODGE"]
        : undefined;
    const dpOptions =
      runtime.pack.combat.mode === "DP"
        ? dpReactionTypesForParticipant(action.kind === "MAGIC" || action.kind === "ITEM")
        : undefined;
    for (const targetId of reactionTargetIds) {
      runtime.pendingReactions.set(targetId, action.actorId);
      const options =
        dpOptions ??
        magicOptions ??
        allowedReactionTypesForParticipant(runtime.pack, runtime.attackSkills, targetId, canFlee, action.skill);
      await emitReactionRequest(io, runtime, action.actorId, targetId, options);
    }
  }
  const resolved = await tryResolveCombat(io, runtime);
  if (resolved === false) {
    await broadcastCombat(io, runtime);
  } else {
    await syncSummonedParticipants(runtime, action.summonTemplate, summonOrigin ?? {});
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
    (pendingAction?.kind === "DANMAKU" || pendingAction?.kind === "MAGIC" || pendingAction?.kind === "ITEM") &&
    runtime.pendingReactions.size === 1;
  const pendingStepSkill =
    pendingAction?.routine?.find((step) => step.targetId === input.targetId)?.skill ??
    pendingAction?.skill ??
    null;
  const pendingAttackSkill = pendingStepSkill;
  const pendingIsCoc7Ranged =
    runtime.pack.system === "COC7" &&
    pendingAttackSkill !== null &&
    (pendingAttackSkill.startsWith("FIREARMS_") || pendingAttackSkill === "THROW");
  const seekCoverAllowed = pendingIsCoc7Ranged && pendingAction?.kind === "DANMAKU";
  const allowedTypes = allowedReactionTypes(runtime.pack);
  const isDpReaction = runtime.pack.combat.mode === "DP";
  if (raw.type === "SEEK_COVER") {
    if (seekCoverAllowed === false) {
      ack({ ok: false, error: "本次攻击不能寻找掩体" });
      return;
    }
  } else if (raw.type === "RESIST" || raw.type === "COVER") {
    if (isDpReaction === false) {
      ack({ ok: false, error: "本规则包不支持该应对" });
      return;
    }
    if (raw.type === "COVER") {
      const coverTargetId = asString(raw.coverTargetId);
      if (coverTargetId === undefined || coverTargetId === input.targetId) {
        ack({ ok: false, error: "掩护需要指定队友" });
        return;
      }
    }
  } else if (canFleeReaction === false && allowedTypes.includes(raw.type) === false) {
    ack({ ok: false, error: "本规则包不支持该应对" });
    return;
  }
  const fleeAfterResolution = canFleeReaction;
  if (fleeAfterResolution) {
    runtime.pendingFlee = { targetId: input.targetId, actorId: pendingActorId ?? "" };
  }
  let reactionType: "PASS" | "DEFEND" | "DODGE" | "COUNTER" | "SEEK_COVER" | "RESIST" | "COVER" =
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
  let counterDamage: string | undefined;
  let counterWeaponName: string | undefined;
  if (reactionType === "COUNTER") {
    if (runtime.pack.system === "COC7") {
      const allowed = (runtime.attackSkills.get(input.targetId) ?? []).filter((skillId) =>
        skillId.startsWith("FIGHTING_")
      );
      const candidate = reactionSkill !== undefined && allowed.includes(reactionSkill) ? reactionSkill : allowed[0];
      if (candidate === undefined) {
        reactionType = "PASS";
        reactionSkill = undefined;
        pushLog(runtime.state, {
          kind: "SYSTEM",
          actorId: target.id,
          targetId: null,
          text: target.name + " 没有可用的格斗专精，本次按未应对处理",
          data: { rollType: "COUNTER_FALLBACK" }
        });
      } else {
        reactionSkill = candidate;
        const option = (runtime.attackOptions.get(input.targetId) ?? []).find(
          (item) => item.skillId === candidate
        );
        counterDamage = option?.damage;
        counterWeaponName = option?.weaponName ?? (option?.source === "UNARMED" ? "徒手" : undefined);
      }
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
  const dpDice = asNumber(raw.dpDice);
  runtime.reactions[input.targetId] = {
    type: reactionType,
    skill: reactionSkill,
    ...(dpDice === undefined ? {} : { dpDice: Math.max(1, Math.floor(dpDice)) }),
    ...(reactionType === "COVER" && asString(raw.coverTargetId) !== undefined
      ? { coverTargetId: asString(raw.coverTargetId) as string }
      : {}),
    ...(counterDamage === undefined ? {} : { damage: counterDamage }),
    ...(counterWeaponName === undefined ? {} : { weaponName: counterWeaponName })
  };
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
    rangeBand?: unknown;
    shots?: unknown;
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
  const requestedRangeBand = Math.max(0, Math.floor(asNumber(input.rangeBand) ?? 0));
  // U-6：追逐攻击同样按双方 Token 的实际英尺距离覆盖伤害档与近距离奖励骰。
  let effectiveRangeBand = requestedRangeBand;
  let bonusDice = 0;
  let bonusDiceSource: string | undefined;
  const actorParticipant = findParticipant(runtime.state, actorId);
  if (runtime.pack.system === "COC7" && actualAttack !== undefined && actorParticipant !== undefined) {
    const distance = await loadCombatDistance(runtime.combatId, actorId, input.targetId);
    if (distance !== null) {
      const match = matchRangeBand(distance.feet, actorParticipant.attributes.dex, actualAttack.damageBands);
      if (match.bandIndex !== null) effectiveRangeBand = match.bandIndex;
      const autoBonus = pointBlankBonusDice(
        actualAttack.skillId,
        distance.feet,
        actorParticipant.attributes.dex
      );
      if (autoBonus > 0) {
        bonusDice = autoBonus;
        bonusDiceSource = "近距离点射（地图距离）";
      }
    }
  }
  const selectedDamageBand =
    actualAttack?.damageBands[effectiveRangeBand] ?? actualAttack?.damageBands[0];
  const requestedShots = Math.max(1, Math.min(3, Math.floor(asNumber(input.shots) ?? 1)));
  const shots =
    actualAttack?.shots !== undefined && actualAttack.shots.includes(requestedShots)
      ? requestedShots
      : 1;
  const damage = selectedDamageBand?.expression ?? actualAttack?.damage ?? "1d6";
  const damageType = actualAttack?.damageType;
  const accuracyMod = asNumber(input.accuracyMod);
  const action: ActionSubmission = {
    actorId,
    kind: "DANMAKU",
    targetId: input.targetId,
    skill,
    damage,
    damageType,
    shots,
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
  runtime.chaseAttack = { actorId, targetId: input.targetId, skill, damage, accuracyMod, bonusDice, bonusDiceSource };
  runtime.reactions = {};
  runtime.pendingReactions.clear();
  runtime.pendingReactions.set(input.targetId, actorId);
  await emitReactionRequest(
    io,
    runtime,
    actorId,
    input.targetId,
    reactionTypesForAttack(allowedReactionTypes(runtime.pack), skill, runtime.pack.system)
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

async function handleInitiativeOrder(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as Partial<CombatInitiativeOrderPayload>;
  if (userId === null || typeof input.combatId !== "string" || Array.isArray(input.order) === false) {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  if (runtime.roles.get(userId) !== "KP") {
    ack({ ok: false, error: "只有 KP 可以调整先攻顺序" });
    return;
  }
  if (runtime.pack.combat.mode !== "INITIATIVE" || runtime.pack.combat.kpAdjustsOrder === false) {
    ack({ ok: false, error: "当前战斗不支持调整先攻顺序" });
    return;
  }
  const order = input.order.filter((id): id is string => typeof id === "string");
  const previousOrder = [...runtime.state.initiativeOrder];
  const previousActive = currentActorId(runtime.state);
  if (setInitiativeOrder(runtime.pack, runtime.state, order) === false) {
    ack({ ok: false, error: "先攻顺序必须包含全部存活单位且不能重复" });
    return;
  }
  if (previousActive !== null) {
    const index = runtime.state.initiativeOrder.indexOf(previousActive);
    runtime.state.activeIndex = index >= 0 ? index : runtime.state.activeIndex;
  } else {
    runtime.state.initiativeOrder = previousOrder;
  }
  await persistAndBroadcast(io, runtime);
  ack({ ok: true });
}

async function handleReadyWeapon(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as Partial<CombatReadyWeaponPayload>;
  if (userId === null || typeof input.combatId !== "string" || typeof input.actorId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  const canAdjust = runtime.roles.get(userId) === "KP" || canControl(runtime, userId, input.actorId);
  if (canAdjust === false) {
    ack({ ok: false, error: "你不能操作这个单位" });
    return;
  }
  const participant = findParticipant(runtime.state, input.actorId);
  if (participant === undefined || participant.defeated) {
    ack({ ok: false, error: "单位不在场" });
    return;
  }
  if (runtime.pack.combat.mode !== "INITIATIVE") {
    ack({ ok: false, error: "准备火器只影响顺序制战斗的先攻" });
    return;
  }
  const hasFirearm = (runtime.attackOptions.get(input.actorId) ?? []).some((option) =>
    option.skillId.startsWith("FIREARMS_")
  );
  if (hasFirearm === false) {
    ack({ ok: false, error: "该单位没有可准备的火器" });
    return;
  }
  const ready = input.ready !== false;
  participant.initiativeMod = ready ? 50 : 0;
  const previousActive = currentActorId(runtime.state);
  runtime.state.initiativeOrder = buildInitiativeOrder(runtime.pack, runtime.state);
  if (previousActive !== null) {
    const index = runtime.state.initiativeOrder.indexOf(previousActive);
    runtime.state.activeIndex = index >= 0 ? index : 0;
  }
  pushLog(runtime.state, {
    kind: "SYSTEM",
    actorId: participant.id,
    targetId: null,
    text: participant.name + (ready ? " 已准备火器，决定先攻时视为 +50 DEX" : " 已收起火器，取消 +50 DEX 先攻修正"),
    data: { rollType: "READY_WEAPON", ready, initiativeMod: participant.initiativeMod }
  });
  await persistAndBroadcast(io, runtime);
  ack({ ok: true });
}

/** DP 宣言阶段：找出该用户还能声明的单位；KP 可代任意未声明单位操作。 */
function controlledDpDeclarerId(runtime: CombatRuntime, userId: string): string | null {
  const isKp = runtime.roles.get(userId) === "KP";
  for (const participant of runtime.state.participants) {
    if (participant.defeated) continue;
    if (runtime.state.dp?.declared[participant.id] !== undefined) continue;
    if (isKp || canControl(runtime, userId, participant.id)) return participant.id;
  }
  return null;
}

async function handleDpDeclare(
  io: SocketServer,
  socket: Socket,
  payload: unknown,
  ack: AckCallback<Ack>
): Promise<void> {
  const userId = userIdOf(socket);
  const input = (payload ?? {}) as { combatId?: unknown; participantId?: unknown; value?: unknown };
  if (userId === null || typeof input.combatId !== "string") {
    ack({ ok: false, error: "参数不合法" });
    return;
  }
  const runtime = await loadCombatRuntime(input.combatId);
  if (runtime === null) {
    ack({ ok: false, error: "战斗不存在" });
    return;
  }
  if (runtime.pack.combat.mode !== "DP") {
    ack({ ok: false, error: "当前战斗不是 DP 模式" });
    return;
  }
  const isKp = runtime.roles.get(userId) === "KP";
  const participantId =
    typeof input.participantId === "string"
      ? input.participantId
      : controlledDpDeclarerId(runtime, userId);
  if (participantId === null || (isKp === false && canControl(runtime, userId, participantId) === false)) {
    ack({ ok: false, error: "你不能操控这个单位" });
    return;
  }
  const value = typeof input.value === "number" && Number.isFinite(input.value) ? Math.floor(input.value) : 0;
  if (declareDp(runtime.state, participantId, value) === false) {
    ack({ ok: false, error: "现在不能声明 DP（阶段或单位不合法）" });
    return;
  }
  await persistAndBroadcast(io, runtime);
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
  socket.on("combat:dp-declare", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleDpDeclare(io, socket, payload, ack);
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
  socket.on("combat:initiative-order", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleInitiativeOrder(io, socket, payload, ack);
  });
  socket.on("combat:ready-weapon", (payload: unknown, ack: AckCallback<Ack>) => {
    void handleReadyWeapon(io, socket, payload, ack);
  });
}
