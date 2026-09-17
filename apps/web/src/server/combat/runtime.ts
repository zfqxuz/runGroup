import {
  filterCombatForViewer,
  type ActionSubmission,
  type ChaseAttackInput,
  type CombatState,
  type CombatView,
  type DefenseReaction
} from "@touhou/combat";
import { compileRulePack, type CompiledRulePack } from "@touhou/rules";
import { loadAttackOptionsByParticipant, loadNpcWeaponsByParticipant, type CombatAttackOption } from "./options";
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
  pendingReactions: Map<string, string>;
  reactions: Record<string, DefenseReaction>;
  /** 追逐中等待目标应对的一次攻击；null 表示没有待结算攻击。 */
  chaseAttack: ChaseAttackInput | null;
  /** ATB 模式下，被攻击时选择逃跑的待处理对象；普通攻击结算后进入追逐。 */
  pendingFlee: { readonly targetId: string; readonly actorId: string } | null;
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
  }
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
  const publicCharacterIds = new Set<string>();
  for (const member of members) {
    if (member.statsPublic && member.activeCharacterId !== null) {
      publicCharacterIds.add(member.activeCharacterId);
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
    pendingReactions: new Map(),
    reactions: {},
    chaseAttack: null,
    pendingFlee: null
  };
  cache.set(combatId, runtime);
  return runtime;
}

export function canControl(runtime: CombatRuntime, userId: string, participantId: string): boolean {
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
    pendingReactions: [...runtime.pendingReactions.entries()].map(([targetId, actorId]) => ({ actorId, targetId }))
  };
}

export function controlledReadyParticipantId(runtime: CombatRuntime, userId: string): string | null {
  for (const participant of runtime.state.participants) {
    if (participant.isReady && canControl(runtime, userId, participant.id)) return participant.id;
  }
  return null;
}

export type { ActionSubmission, DefenseReaction };
