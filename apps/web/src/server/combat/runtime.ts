import {
  filterCombatForViewer,
  type ActionSubmission,
  type CombatState,
  type CombatView,
  type DefenseReaction
} from "@touhou/combat";
import { compileRulePack, type CompiledRulePack } from "@touhou/rules";
import { loadAttackSkillsByParticipant } from "./options";
import { prisma } from "@/server/db/prisma";

export type RuntimeRole = "KP" | "PLAYER" | "SPECTATOR";

export interface CombatRuntime {
  readonly combatId: string;
  readonly roomId: string;
  readonly pack: CompiledRulePack;
  readonly state: CombatState;
  readonly controllers: Map<string, string[]>;
  readonly roles: Map<string, RuntimeRole>;
  readonly partyStatsVisible: boolean;
  readonly attackSkills: ReadonlyMap<string, readonly string[]>;
  pendingReactions: Map<string, string>;
  reactions: Record<string, DefenseReaction>;
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
          characterVisibility: true,
          members: { select: { userId: true, role: true } }
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
  const attackSkills = await loadAttackSkillsByParticipant(
    pack,
    state.participants.map((participant) => ({
      id: participant.id,
      kind: participant.kind,
      characterId: participant.characterId,
      skills: participant.skills
    }))
  );
  const runtime: CombatRuntime = {
    combatId,
    roomId: combat.roomId,
    pack,
    state,
    controllers,
    roles,
    partyStatsVisible: combat.room.characterVisibility !== "PRIVATE",
    attackSkills,
    pendingReactions: new Map(),
    reactions: {}
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
  const view = filterCombatForViewer(runtime.state, {
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
