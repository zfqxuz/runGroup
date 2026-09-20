import {
  filterCombatForViewer,
  findParticipant,
  recoverTouhouLscLimits,
  type ActionSubmission,
  type ChaseAttackInput,
  type CombatState,
  type CombatView,
  type DefenseReaction
} from "@touhou/combat";
import { compileRulePack, type CompiledRulePack } from "@touhou/rules";
import { loadAttackOptionsByParticipant, loadNpcWeaponsByParticipant, type CombatAttackOption } from "./options";
import { loadItemsByParticipant, type CombatItemOption } from "./items";
import { loadSpellcardsByParticipant } from "./spellcards";
import { prisma } from "@/server/db/prisma";
import type { CombatSpellCardOption } from "@/shared/danmaku/spellcards";

export type RuntimeRole = "KP" | "PLAYER" | "SPECTATOR";

export interface CombatRuntime {
  readonly combatId: string;
  readonly roomId: string;
  readonly pack: CompiledRulePack;
  readonly state: CombatState;
  readonly controllers: Map<string, string[]>;
  readonly roles: Map<string, RuntimeRole>;
  readonly partyStatsVisible: boolean;
  /** 房间 PRIVATE 时，主动公开角色数值的玩家角色 id。 */
  readonly publicCharacterIds: ReadonlySet<string>;
  attackSkills: Map<string, readonly string[]>;
  /** participant.id -> 攻击技能与实际伤害表达式（来自角色装备卡）。 */
  attackOptions: Map<string, readonly CombatAttackOption[]>;
  /** participant.id -> 已装备的符卡。只在 TOUHOU 房间填充。 */
  readonly spellcardsByParticipant: ReadonlyMap<string, readonly CombatSpellCardOption[]>;
  /** participant.id -> 已装备、可用于战斗的道具卡。 */
  readonly itemsByParticipant: ReadonlyMap<string, readonly CombatItemOption[]>;
  pendingReactions: Map<string, string>;
  reactions: Record<string, DefenseReaction>;
  /** 追逐中等待目标应对的一次攻击；null 表示没有待结算攻击。 */
  chaseAttack: ChaseAttackInput | null;
  /** ATB 模式下，被攻击时选择逃跑的待处理对象；普通攻击结算后进入追逐。 */
  pendingFlee: { readonly targetId: string; readonly actorId: string } | null;
  /** 本次战斗中由 SUMMON 生成、已同步为持久 NPC 卡的 participant id。 */
  readonly summonCardIds: Set<string>;
  /** U-6：战斗绑定场景的网格信息；没有场景 / 地图时为 null。 */
  readonly sceneGrid: {
    readonly width: number;
    readonly height: number;
    readonly gridSize: number;
    readonly gridType: string;
  } | null;
  /** U-6：participant.id → 该单位在当前场景的 Token 坐标。 */
  readonly tokenPositions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
}

const cache = new Map<string, CombatRuntime>();

export function clearCombatRuntime(combatId: string): void {
  cache.delete(combatId);
}

export function hasCombatRuntime(combatId: string): boolean {
  return cache.has(combatId);
}

export async function loadCombatRuntime(combatId: string): Promise<CombatRuntime | null> {
  const cached = cache.get(combatId);
  if (cached !== undefined) return cached;
  const combat = await prisma.combat.findUnique({
    where: { id: combatId },
    include: {
      room: {
        select: {
          system: true,
          characterVisibility: true,
          members: { select: { userId: true, role: true, statsPublic: true, activeCharacterId: true } }
        }
      }
    }
  });
  if (combat === null) return null;
  const snapshot = await prisma.combatSnapshot.findFirst({
    where: { combatId },
    orderBy: { seq: "desc" }
  });
  if (snapshot === null) return null;
  let pack: CompiledRulePack;
  try {
    pack = compileRulePack(combat.ruleSnapshot);
  } catch {
    return null;
  }
  const state = snapshot.state as unknown as CombatState;
  if (state === null || typeof state !== "object") return null;
  // 兼容旧快照：护甲和召唤序号是后加字段。
  state.summonSeq = Number.isFinite(state.summonSeq) ? state.summonSeq : 0;
  for (const participant of state.participants) {
    participant.armor = Math.max(0, Math.floor(participant.armor ?? 0));
    participant.maxArmor = Math.max(participant.armor, Math.floor(participant.maxArmor ?? participant.armor));
    participant.grazePoints = Math.max(0, Math.floor(participant.grazePoints ?? 0));
    participant.grazeDamageBonus = Math.max(0, Math.floor(participant.grazeDamageBonus ?? 0));
    participant.race = participant.race ?? null;
    participant.raceFlags = Array.isArray(participant.raceFlags) ? participant.raceFlags : [];
    const raceElements =
      participant.race === null ? [] : (pack.pack.races[participant.race]?.elements ?? []);
    participant.elements = Array.isArray(participant.elements) && participant.elements.length > 0
      ? participant.elements
      : [...raceElements];
    participant.abilityLevels =
      participant.abilityLevels !== null && typeof participant.abilityLevels === "object"
        ? participant.abilityLevels
        : {};
    participant.mpExhausted = participant.mpExhausted === true;
    participant.grantedElement =
      typeof participant.grantedElement === "string" && participant.grantedElement.length > 0
        ? participant.grantedElement
        : null;
    participant.grantedElementExpiresAtRound =
      typeof participant.grantedElementExpiresAtRound === "number"
        ? Math.max(0, Math.floor(participant.grantedElementExpiresAtRound))
        : null;
    participant.tempDp = Math.max(0, Math.floor(participant.tempDp ?? 0));
    participant.tempDpMax = Math.max(participant.tempDp, Math.floor(participant.tempDpMax ?? 0));
    participant.tempDpExpiresAtRound =
      typeof participant.tempDpExpiresAtRound === "number"
        ? Math.max(0, Math.floor(participant.tempDpExpiresAtRound))
        : null;
    participant.attackBuff =
      participant.attackBuff !== null && typeof participant.attackBuff === "object"
        ? {
            bonusDice: Math.max(0, Math.floor(participant.attackBuff.bonusDice ?? 0)),
            danmakuDamage: Math.max(0, Math.floor(participant.attackBuff.danmakuDamage ?? 0)),
            uses: Math.max(0, Math.floor(participant.attackBuff.uses ?? 0)),
            expiresAtRound:
              typeof participant.attackBuff.expiresAtRound === "number"
                ? Math.max(0, Math.floor(participant.attackBuff.expiresAtRound))
                : null
          }
        : null;
    participant.barrier =
      participant.barrier !== null && typeof participant.barrier === "object"
        ? {
            name: typeof participant.barrier.name === "string" ? participant.barrier.name : "结界",
            hp: Math.max(0, Math.floor(participant.barrier.hp ?? 0)),
            maxHp: Math.max(0, Math.floor(participant.barrier.maxHp ?? participant.barrier.hp ?? 0)),
            expiresAtRound:
              typeof participant.barrier.expiresAtRound === "number"
                ? Math.max(0, Math.floor(participant.barrier.expiresAtRound))
                : null,
            sizeId:
              typeof participant.barrier.sizeId === "string" ? participant.barrier.sizeId : null,
            sizeMeters:
              typeof participant.barrier.sizeMeters === "number"
                ? Math.max(0, participant.barrier.sizeMeters)
                : 0,
            requiredLevel:
              typeof participant.barrier.requiredLevel === "number"
                ? Math.max(1, Math.floor(participant.barrier.requiredLevel))
                : null,
            targetValue:
              typeof participant.barrier.targetValue === "number"
                ? Math.max(0, Math.floor(participant.barrier.targetValue))
                : 0,
            penalty:
              typeof participant.barrier.penalty === "number"
                ? Math.max(0, Math.floor(participant.barrier.penalty))
                : 0,
            anchor: participant.barrier.anchor === "AREA" ? "AREA" : "SELF",
            durationHours:
              typeof participant.barrier.durationHours === "number"
                ? Math.max(0, participant.barrier.durationHours)
                : 0
          }
        : null;
    participant.cover =
      participant.cover !== null && typeof participant.cover === "object"
        ? {
            name: typeof participant.cover.name === "string" ? participant.cover.name : "掩体",
            level:
              typeof participant.cover.level === "number"
                ? Math.max(0, Math.floor(participant.cover.level))
                : 1,
            hp: Math.max(0, Math.floor(participant.cover.hp ?? 0)),
            maxHp: Math.max(0, Math.floor(participant.cover.maxHp ?? participant.cover.hp ?? 0)),
            expiresAtRound:
              typeof participant.cover.expiresAtRound === "number"
                ? Math.max(0, Math.floor(participant.cover.expiresAtRound))
                : null,
            blocksLineOfSight: participant.cover.blocksLineOfSight === true
          }
        : null;
    participant.lscUsed = participant.lscUsed === true;
    participant.lscBroken = participant.lscBroken === true;
    participant.lscBrokenAt = typeof participant.lscBrokenAt === "string" ? participant.lscBrokenAt : null;
  }
  state.spellcardBattle =
    state.spellcardBattle !== null && typeof state.spellcardBattle === "object"
      ? state.spellcardBattle
      : null;
  // LSC 后遗症：载入时检查是否已过 30 分钟，若是则恢复 DP 上限。
  recoverTouhouLscLimits(pack, state);
  const members = combat.room.members;
  const roles = new Map<string, RuntimeRole>();
  const kpIds: string[] = [];
  for (const member of members) {
    const role = member.role as RuntimeRole;
    roles.set(member.userId, role);
    if (role === "KP") kpIds.push(member.userId);
  }
  const characterIds: string[] = [];
  for (const participant of state.participants) {
    if (participant.characterId !== null) characterIds.push(participant.characterId);
  }
  const characters = characterIds.length === 0
    ? []
    : await prisma.character.findMany({
        where: { id: { in: characterIds } },
        select: { id: true, userId: true }
      });
  const ownerByCharacter = new Map(characters.map((character) => [character.id, character.userId]));
  const controllers = new Map<string, string[]>();
  for (const participant of state.participants) {
    if (participant.kind === "PLAYER" && participant.characterId !== null) {
      const owner = ownerByCharacter.get(participant.characterId);
      controllers.set(participant.id, owner === undefined ? [] : [owner]);
    } else {
      controllers.set(participant.id, kpIds);
    }
  }
  const npcWeaponsByParticipant = await loadNpcWeaponsByParticipant(
    combatId,
    state.participants.map((participant) => ({ id: participant.id, kind: participant.kind }))
  );
  const attackOptions = await loadAttackOptionsByParticipant(
    pack,
    state.participants.map((participant) => ({
      id: participant.id,
      kind: participant.kind,
      characterId: participant.characterId,
      skills: participant.skills
    })),
    npcWeaponsByParticipant
  );
  const attackSkills = new Map<string, readonly string[]>(
    [...attackOptions.entries()].map(([participantId, options]) => [
      participantId,
      options.map((option) => option.skillId)
    ])
  );
  const spellcardsByParticipant = await loadSpellcardsByParticipant(
    combat.room.system === "TOUHOU" && pack.system === "TOUHOU" ? "TOUHOU" : "COC7",
    state.participants.map((participant) => ({
      id: participant.id,
      characterId: participant.characterId
    }))
  );
  const itemsByParticipant = await loadItemsByParticipant(
    state.participants.map((participant) => ({
      id: participant.id,
      characterId: participant.characterId
    }))
  );
  const publicCharacterIds = new Set<string>();
  for (const member of members) {
    if (member.statsPublic && member.activeCharacterId !== null) {
      publicCharacterIds.add(member.activeCharacterId);
    }
  }

  // U-6：读取战斗场景里的 Token 坐标，供战斗 UI 展示实际英尺距离。
  let sceneGrid: CombatRuntime["sceneGrid"] = null;
  const tokenPositions = new Map<string, { readonly x: number; readonly y: number }>();
  if (combat.sceneId !== null) {
    const tokens = await prisma.token.findMany({
      where: { roomId: combat.roomId, map: { sceneId: combat.sceneId } },
      select: {
        characterId: true,
        cardId: true,
        x: true,
        y: true,
        map: { select: { width: true, height: true, gridSize: true, gridType: true } }
      }
    });
    for (const token of tokens) {
      const participant = state.participants.find(
        (item) =>
          (item.characterId !== null && item.characterId === token.characterId) ||
          (item.characterId === null && token.cardId !== null && item.id === token.cardId)
      );
      if (participant === undefined) continue;
      tokenPositions.set(participant.id, { x: token.x, y: token.y });
      if (sceneGrid === null) {
        sceneGrid = {
          width: token.map.width,
          height: token.map.height,
          gridSize: token.map.gridSize,
          gridType: token.map.gridType
        };
      }
    }
  }

  const runtime: CombatRuntime = {
    combatId,
    roomId: combat.roomId,
    pack,
    state,
    controllers,
    roles,
    partyStatsVisible: combat.room.characterVisibility !== "PRIVATE",
    publicCharacterIds,
    attackSkills,
    attackOptions,
    spellcardsByParticipant,
    itemsByParticipant,
    pendingReactions: new Map(),
    reactions: {},
    chaseAttack: null,
    pendingFlee: null,
    summonCardIds: new Set(state.participants.filter((participant) => participant.summonedBy !== null && participant.summonedBy !== undefined).map((participant) => participant.id)),
    sceneGrid,
    tokenPositions
  };
  cache.set(combatId, runtime);
  return runtime;
}

export function canControl(runtime: CombatRuntime, userId: string, participantId: string): boolean {
  const participant = findParticipant(runtime.state, participantId);
  if (participant !== undefined && participant.possessedBy !== null && participant.possessedBy !== undefined) {
    const possessor = findParticipant(runtime.state, participant.possessedBy);
    if (possessor !== undefined) {
      const possessorControllers = runtime.controllers.get(possessor.id);
      return possessorControllers !== undefined && possessorControllers.includes(userId);
    }
  }
  const controllers = runtime.controllers.get(participantId);
  if (controllers === undefined) return false;
  return controllers.includes(userId);
}

export function controlledCharacterIds(runtime: CombatRuntime, userId: string): string[] {
  const ids: string[] = [];
  for (const participant of runtime.state.participants) {
    if (participant.characterId === null) continue;
    if (canControl(runtime, userId, participant.id)) ids.push(participant.characterId);
  }
  return ids;
}

export function viewForUser(runtime: CombatRuntime, userId: string): CombatView {
  const role = runtime.roles.get(userId) ?? "SPECTATOR";
  // 房间 PRIVATE 时，主动公开的玩家角色按 participant.isPublic 处理；
  // 只对 view 副本做标记，不改动运行时真实状态。
  const visibleState =
    runtime.publicCharacterIds.size === 0
      ? runtime.state
      : {
          ...runtime.state,
          participants: runtime.state.participants.map((participant) =>
            participant.characterId !== null && runtime.publicCharacterIds.has(participant.characterId)
              ? { ...participant, isPublic: true }
              : participant
          )
        };
  const view = filterCombatForViewer(visibleState, {
    userId,
    role,
    characterId: null,
    characterIds: controlledCharacterIds(runtime, userId),
    canSeePartyStats: runtime.partyStatsVisible
  });
  return {
    ...view,
    participants: view.participants.map((participant) => ({
      ...participant,
      controlledByViewer: canControl(runtime, userId, participant.id)
    })),
    pendingReactions: [...runtime.pendingReactions.entries()].map(([targetId, actorId]) => ({ actorId, targetId })),
    sceneGrid: runtime.sceneGrid,
    tokens: Object.fromEntries(runtime.tokenPositions)
  };
}

export function controlledReadyParticipantId(runtime: CombatRuntime, userId: string): string | null {
  for (const participant of runtime.state.participants) {
    if (participant.isReady && canControl(runtime, userId, participant.id)) return participant.id;
  }
  return null;
}

export type { ActionSubmission, DefenseReaction };
