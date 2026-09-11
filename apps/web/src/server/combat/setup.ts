import { randomUUID } from "node:crypto";
import {
  addParticipant,
  advanceToNextEvent,
  beginInitiativeRound,
  createCombat,
  type CombatState,
  type ParticipantInit
} from "@touhou/combat";
import {
  coc7DamageBonus,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  type AttributeSet,
  type CompiledRulePack,
  type DerivedStats
} from "@touhou/rules";
import type { Card, Character } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { EffectivePack } from "@/server/rules/loader";
import { NpcStatsSchema } from "@/shared/npc";
import { buildEffectiveSkills } from "@/server/character/skills";
import { emitCombatEnded } from "@/server/realtime";

export type UnitKind = "CHARACTER" | "NPC";
export type MemberRole = "KP" | "PLAYER" | "SPECTATOR";

export interface SelectableUnit {
  readonly ref: string;
  readonly kind: UnitKind;
  readonly name: string;
  readonly subtitle: string | null;
  readonly hp: number;
  readonly ownerId: string | null;
}

export interface UnitSelection {
  readonly ref: string;
  readonly faction: string;
}

export interface CreateCombatResult {
  readonly ok: boolean;
  readonly combatId?: string;
  readonly error?: string;
}

export function characterRef(id: string): string {
  return "character:" + id;
}

export function npcRef(id: string): string {
  return "npc:" + id;
}

function parseRef(ref: string): { kind: UnitKind; id: string } | null {
  if (ref.startsWith("character:")) return { kind: "CHARACTER", id: ref.slice(10) };
  if (ref.startsWith("npc:")) return { kind: "NPC", id: ref.slice(4) };
  return null;
}

function maxHpOfCard(card: Card): number {
  const stats = (card.stats ?? {}) as { maxHp?: unknown };
  return typeof stats.maxHp === "number" ? stats.maxHp : 0;
}

export async function listSelectableUnits(
  roomId: string,
  userId: string,
  role: MemberRole
): Promise<SelectableUnit[]> {
  const [entries, cards] = await Promise.all([
    prisma.roomCharacterEntry.findMany({
      where: { roomId, status: "APPROVED" },
      include: { character: true },
      orderBy: { submittedAt: "asc" }
    }),
    prisma.card.findMany({
      where: { roomId, scope: "ROOM", type: "NPC" },
      orderBy: { createdAt: "asc" }
    })
  ]);
  const units: SelectableUnit[] = [];
  for (const entry of entries) {
    const character = entry.character;
    if (role === "KP" || character.userId === userId) {
      units.push({
        ref: characterRef(character.id),
        kind: "CHARACTER",
        name: character.name,
        subtitle: character.occupation,
        hp: character.maxHp,
        ownerId: character.userId
      });
    }
  }
  if (role === "KP") {
    for (const card of cards) {
      units.push({
        ref: npcRef(card.id),
        kind: "NPC",
        name: card.name,
        subtitle: card.subtitle,
        hp: maxHpOfCard(card),
        ownerId: card.ownerId
      });
    }
  }
  return units;
}

function buildCharacterInit(pack: CompiledRulePack, character: Character, faction: string): ParticipantInit {
  const attributes: AttributeSet = {
    str: character.str,
    con: character.con,
    siz: character.siz,
    dex: character.dex,
    app: character.app,
    int: character.int,
    pow: character.pow,
    edu: character.edu,
    luck: character.luck
  };
  const skills = buildEffectiveSkills(pack, character);
  const outcome = computeDerived(pack, {
    attributes,
    race: character.race ?? null,
    skills
  });
  const vars: Record<string, number> = { ...outcome.attributes, ...outcome.derived };
  return {
    id: character.id,
    name: character.name,
    kind: "PLAYER",
    characterId: character.id,
    faction,
    attributes: outcome.attributes,
    derived: outcome.derived,
    skills,
    damageBonus: pack.system === "COC7" ? coc7DamageBonus(outcome.attributes.str + outcome.attributes.siz) : "0",
    atbMax: computeAtbMax(pack, vars),
    speed: computeBaseSpeed(pack, vars)
  };
}

function buildNpcInit(pack: CompiledRulePack, card: Card, faction: string): ParticipantInit | string {
  const parsed = NpcStatsSchema.safeParse(card.stats);
  if (parsed.success === false) return "NPC 卡数据不合法：" + card.name;
  const attributes = parsed.data.attributes as AttributeSet;
  const derived: DerivedStats = {
    hp: parsed.data.maxHp,
    maxHp: parsed.data.maxHp,
    mp: parsed.data.maxMp,
    maxMp: parsed.data.maxMp,
    san: parsed.data.maxSan,
    maxSan: parsed.data.maxSan,
    dp: parsed.data.maxDp,
    maxDp: parsed.data.maxDp
  };
  const vars: Record<string, number> = { ...attributes, ...derived };
  return {
    id: card.id,
    name: card.name,
    kind: "NPC",
    characterId: null,
    faction,
    attributes,
    derived,
    skills: { ...parsed.data.skills },
    damageBonus: pack.system === "COC7" ? coc7DamageBonus(attributes.str + attributes.siz) : "0",
    atbMax: computeAtbMax(pack, vars),
    speed: computeBaseSpeed(pack, vars),
    isIdentified: false,
    isPublic: card.isPublic
  };
}

function dbPhase(state: CombatState): "ATB_CHARGING" | "ACTION" | "RESOLUTION" | "ENDED" {
  if (state.phase === "ENDED") return "ENDED";
  if (state.phase === "AWAITING_ACTION") return "ACTION";
  return "ATB_CHARGING";
}

export async function createCombatRecord(
  roomId: string,
  effective: EffectivePack,
  allies: readonly string[],
  enemies: readonly string[]
): Promise<CreateCombatResult> {
  if (allies.length === 0 || enemies.length === 0) {
    return { ok: false, error: "双方至少各需要一个参战单位" };
  }
  const seen = new Set<string>();
  const refs: UnitSelection[] = [];
  for (const ref of allies) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    refs.push({ ref, faction: "ALLY" });
  }
  for (const ref of enemies) {
    if (seen.has(ref)) return { ok: false, error: "同一个单位不能同时出现在双方" };
    seen.add(ref);
    refs.push({ ref, faction: "ENEMY" });
  }
  const characterIds: string[] = [];
  const npcIds: string[] = [];
  for (const selection of refs) {
    const ref = parseRef(selection.ref);
    if (ref === null) return { ok: false, error: "参战单位引用不合法" };
    if (ref.kind === "CHARACTER") characterIds.push(ref.id);
    else npcIds.push(ref.id);
  }
  const [characters, cards, approvedEntries] = await Promise.all([
    characterIds.length === 0
      ? Promise.resolve([] as Character[])
      : prisma.character.findMany({ where: { id: { in: characterIds } } }),
    npcIds.length === 0
      ? Promise.resolve([] as Card[])
      : prisma.card.findMany({ where: { id: { in: npcIds } } }),
    prisma.roomCharacterEntry.findMany({
      where: { roomId, status: "APPROVED", characterId: { in: characterIds } },
      select: { characterId: true }
    })
  ]);
  if (characters.length !== new Set(characterIds).size) {
    return { ok: false, error: "有角色不存在或未通过入房审核" };
  }
  const approved = new Set(approvedEntries.map((entry) => entry.characterId));
  for (const character of characters) {
    if (approved.has(character.id) === false) return { ok: false, error: "角色尚未通过入房审核" };
    if (character.system !== effective.compiled.system) return { ok: false, error: "角色模组与房间不一致" };
  }
  if (cards.length !== npcIds.length) return { ok: false, error: "有 NPC 卡不存在" };
  for (const card of cards) {
    if (card.roomId !== roomId || card.scope !== "ROOM" || card.type !== "NPC") {
      return { ok: false, error: "NPC 卡不属于本房间" };
    }
    if (card.system !== effective.compiled.system) return { ok: false, error: "NPC 卡模组与房间不一致" };
  }
  const pack = effective.compiled;
  const state = createCombat({
    id: randomUUID(),
    seed: randomUUID(),
    tickMs: pack.atb.tickMs,
    mode: pack.combat.mode
  });
  const characterById = new Map(characters.map((character) => [character.id, character]));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const npcDataById = new Map<string, unknown>();
  for (const selection of refs) {
    const ref = parseRef(selection.ref);
    if (ref === null) return { ok: false, error: "参战单位引用不合法" };
    if (ref.kind === "CHARACTER") {
      const character = characterById.get(ref.id);
      if (character === undefined) return { ok: false, error: "角色不存在" };
      addParticipant(state, buildCharacterInit(pack, character, selection.faction));
    } else {
      const card = cardById.get(ref.id);
      if (card === undefined) return { ok: false, error: "NPC 卡不存在" };
      const init = buildNpcInit(pack, card, selection.faction);
      if (typeof init === "string") return { ok: false, error: init };
      npcDataById.set(card.id, card.stats);
      addParticipant(state, init);
    }
  }
  if (pack.combat.mode === "INITIATIVE") beginInitiativeRound(pack, state);
  else advanceToNextEvent(pack, state);
  const created = await prisma.$transaction(async (tx) => {
    const combat = await tx.combat.create({
      data: {
        roomId,
        round: state.round,
        phase: dbPhase(state) as never,
        tick: state.tick,
        seed: state.seed,
        ruleSnapshot: effective.compiled.pack as never,
        ruleSnapshotHash: effective.checksum
      }
    });
    await tx.room.update({ where: { id: roomId }, data: { status: "COMBAT" } });
    await tx.combatSnapshot.create({
      data: { combatId: combat.id, seq: 1, state: state as never }
    });
    for (const participant of state.participants) {
      await tx.combatParticipant.create({
        data: {
          combatId: combat.id,
          characterId: participant.characterId,
          isNPC: participant.kind === "NPC",
          npcData: (npcDataById.get(participant.id) ?? null) as never,
          name: participant.name,
          atbValue: participant.atbValue,
          atbMax: participant.atbMax,
          speed: participant.speed,
          isReady: participant.isReady,
          currentHp: participant.hp,
          currentMp: participant.mp,
          currentSan: participant.san,
          currentDp: participant.dp,
          maxHp: participant.maxHp,
          maxMp: participant.maxMp,
          maxSan: participant.maxSan,
          maxDp: participant.maxDp,
          statusEffects: participant.statusEffects as never,
          isIdentified: participant.isIdentified,
          isPublic: participant.isPublic,
          spellState: (participant.declaration ?? {}) as never
        }
      });
    }
    return combat;
  });
  return { ok: true, combatId: created.id };
}

export async function saveCombatState(combatId: string, state: CombatState): Promise<void> {
  const combat = await prisma.combat.findUnique({
    where: { id: combatId },
    select: { roomId: true }
  });
  if (combat === null) return;

  const latest = await prisma.combatSnapshot.findFirst({
    where: { combatId },
    orderBy: { seq: "desc" },
    select: { seq: true }
  });
  const seq = (latest?.seq ?? 0) + 1;
  const activeGame = await prisma.game.findFirst({
    where: {
      roomId: combat.roomId,
      status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });

  await prisma.$transaction(async (tx) => {
    await tx.combat.update({
      where: { id: combatId },
      data: {
        round: state.round,
        tick: state.tick,
        phase: dbPhase(state) as never,
        endedAt: state.phase === "ENDED" ? new Date() : null
      }
    });
    await tx.combatSnapshot.create({
      data: { combatId, seq, state: state as never }
    });

    if (activeGame !== null) {
      for (const participant of state.participants) {
        if (participant.characterId === null) continue;
        await tx.gameCharacter.updateMany({
          where: { gameId: activeGame.id, characterId: participant.characterId },
          data: {
            currentHp: participant.hp,
            currentMp: participant.mp,
            currentSan: participant.san,
            currentDp: participant.dp,
            status: participant.hp <= 0 ? "DEAD" : "ALIVE"
          }
        });
      }
    }

    if (state.phase === "ENDED") {
      await tx.room.update({ where: { id: combat.roomId }, data: { status: "PLAYING" } });
    }
  });

  if (state.phase === "ENDED") {
    emitCombatEnded(combat.roomId, combatId);
  }
}
