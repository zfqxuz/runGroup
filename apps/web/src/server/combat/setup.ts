import { randomUUID } from "node:crypto";
import { parseDice, rollDice } from "@touhou/formula";
import {
  addParticipant,
  persistableConditions,
  advanceToNextEvent,
  beginInitiativeRound,
  createCombat,
  nextRollRng,
  type CombatState,
  type ParticipantInit
} from "@touhou/combat";
import {
  coc7DamageBonus,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  parseConditions,
  type AttributeSet,
  type CompiledRulePack,
  type DerivedStats,
  type GameCondition
} from "@touhou/rules";
import type { Card, Character, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { EffectivePack } from "@/server/rules/loader";
import { NpcStatsSchema } from "@/shared/npc";
import { buildEffectiveSkills } from "@/server/character/skills";
import { emitCombatEnded } from "@/server/realtime";
import { armorExpressionFromValue } from "@/server/combat/armor";

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

export interface CreateCombatOptions {
  /** 指定战斗场景；提供时所有参战单位必须在该场景。 */
  readonly sceneId?: string | null;
}

interface ParticipantScene {
  readonly ref: string;
  readonly name: string;
  readonly sceneId: string;
  readonly sceneName: string;
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

function stringArrayOf(value: unknown): string[] {
  if (Array.isArray(value) === false) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function characterSpellsOf(character: Character): string[] {
  const sourceData = (character.sourceData ?? {}) as Record<string, unknown>;
  const sourceSpells = stringArrayOf(sourceData.spells);
  if (sourceSpells.length > 0) return sourceSpells;
  const backstory = (character.backstory ?? {}) as Record<string, unknown>;
  return stringArrayOf(backstory.spells);
}

function buildCharacterInit(
  pack: CompiledRulePack,
  character: Character,
  faction: string,
  conditions: readonly GameCondition[] = []
): ParticipantInit {
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
    spells: characterSpellsOf(character),
    damageBonus: pack.system === "COC7" ? coc7DamageBonus(outcome.attributes.str + outcome.attributes.siz) : "0",
    atbMax: computeAtbMax(pack, vars),
    speed: computeBaseSpeed(pack, vars),
    conditions
  };
}

function buildNpcInit(
  pack: CompiledRulePack,
  card: Card,
  faction: string,
  defaultSpells: readonly string[] = []
): ParticipantInit | string {
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
    spells: parsed.data.spells.length > 0 ? [...parsed.data.spells] : [...defaultSpells],
    damageBonus: pack.system === "COC7" ? coc7DamageBonus(attributes.str + attributes.siz) : "0",
    atbMax: computeAtbMax(pack, vars),
    speed: computeBaseSpeed(pack, vars),
    isIdentified: false,
    isPublic: card.isPublic,
    conditions: parsed.data.conditions
  };
}

function dbPhase(state: CombatState): "ATB_CHARGING" | "ACTION" | "RESOLUTION" | "ENDED" {
  if (state.phase === "ENDED") return "ENDED";
  if (state.phase === "AWAITING_ACTION") return "ACTION";
  return "ATB_CHARGING";
}

/**
 * 解析参战单位当前所在场景。
 * 迁移策略：如果没有任何参战单位带 Token，则退回旧行为（不强制场景）；
 * 只要有一方带 Token，就要求全体都入场且处于同一场景。
 */
async function resolveParticipantScenes(
  roomId: string,
  refs: readonly UnitSelection[]
): Promise<Map<string, ParticipantScene | null>> {
  const result = new Map<string, ParticipantScene | null>();
  const characterIds: string[] = [];
  const cardIds: string[] = [];
  for (const selection of refs) {
    const ref = parseRef(selection.ref);
    if (ref === null) continue;
    if (ref.kind === "CHARACTER") characterIds.push(ref.id);
    else cardIds.push(ref.id);
  }
  const tokens = await prisma.token.findMany({
    where: {
      roomId,
      OR: [
        ...(characterIds.length === 0 ? [] : [{ characterId: { in: [...new Set(characterIds)] } }]),
        ...(cardIds.length === 0 ? [] : [{ cardId: { in: [...new Set(cardIds)] } }])
      ]
    },
    select: {
      characterId: true,
      cardId: true,
      map: { select: { sceneId: true, scene: { select: { name: true } } } }
    }
  });
  const tokenByEntity = new Map<string, ParticipantScene>();
  for (const token of tokens) {
    const entityId = token.characterId ?? token.cardId;
    if (entityId === null) continue;
    tokenByEntity.set(entityId, {
      ref: "",
      name: "",
      sceneId: token.map.sceneId,
      sceneName: token.map.scene.name
    });
  }
  for (const selection of refs) {
    const ref = parseRef(selection.ref);
    if (ref === null) continue;
    const scene = tokenByEntity.get(ref.id) ?? null;
    result.set(selection.ref, scene === null ? null : { ...scene, ref: selection.ref });
  }
  return result;
}

/** 找出房间内进行中的战斗已占用的实体，避免同一单位同时参加多场战斗。 */
async function activeCombatEntityIds(roomId: string): Promise<Set<string>> {
  const active = await prisma.combat.findMany({
    where: { roomId, endedAt: null },
    select: { id: true }
  });
  const ids = new Set<string>();
  if (active.length === 0) return ids;
  const snapshots = await prisma.combatSnapshot.findMany({
    where: { combatId: { in: active.map((combat) => combat.id) } },
    orderBy: [{ combatId: "asc" }, { seq: "desc" }],
    select: { combatId: true, state: true }
  });
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.combatId)) continue;
    seen.add(snapshot.combatId);
    const state = snapshot.state as { participants?: unknown };
    if (Array.isArray(state.participants) === false) continue;
    for (const participant of state.participants) {
      const id = (participant as { id?: unknown }).id;
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

/** 把 ref 换成可读名字，错误提示里不暴露内部 id。 */
async function refLabels(refs: readonly UnitSelection[]): Promise<Map<string, string>> {
  const characterIds: string[] = [];
  const cardIds: string[] = [];
  for (const selection of refs) {
    const ref = parseRef(selection.ref);
    if (ref === null) continue;
    if (ref.kind === "CHARACTER") characterIds.push(ref.id);
    else cardIds.push(ref.id);
  }
  const [characters, cards] = await Promise.all([
    characterIds.length === 0
      ? Promise.resolve([] as { id: string; name: string }[])
      : prisma.character.findMany({ where: { id: { in: [...new Set(characterIds)] } }, select: { id: true, name: true } }),
    cardIds.length === 0
      ? Promise.resolve([] as { id: string; name: string }[])
      : prisma.card.findMany({ where: { id: { in: [...new Set(cardIds)] } }, select: { id: true, name: true } })
  ]);
  const byId = new Map<string, string>();
  for (const row of [...characters, ...cards]) byId.set(row.id, row.name);
  const labels = new Map<string, string>();
  for (const selection of refs) {
    const ref = parseRef(selection.ref);
    labels.set(selection.ref, ref === null ? selection.ref : byId.get(ref.id) ?? selection.ref);
  }
  return labels;
}

/** 场景隔离 + 进行中战斗席位互斥。 */
async function validateCombatPlacement(
  roomId: string,
  refs: readonly UnitSelection[],
  options: CreateCombatOptions
): Promise<string | null> {
  const scenes = await resolveParticipantScenes(roomId, refs);
  const labels = await refLabels(refs);
  const missing = refs.filter((selection) => (scenes.get(selection.ref) ?? null) === null);
  const present = refs.filter((selection) => (scenes.get(selection.ref) ?? null) !== null);
  // 只有「至少一方已入场」时才强制全体入场，兼容尚未使用地图的旧房间。
  if (present.length > 0) {
    if (missing.length > 0) {
      const names = missing.map((selection) => labels.get(selection.ref) ?? selection.ref).join("、");
      return "以下单位尚未放入地图，不能参战：" + names;
    }
    const sceneIds = new Set(present.map((selection) => scenes.get(selection.ref)!.sceneId));
    if (sceneIds.size > 1) {
      return "参战单位不在同一场景，战斗已取消。请先把所有人移动到同一场景。";
    }
    const sceneId = [...sceneIds][0]!;
    if (options.sceneId !== null && options.sceneId !== undefined && options.sceneId !== sceneId) {
      return "参战单位当前不在指定战斗场景。";
    }
  }
  const occupied = await activeCombatEntityIds(roomId);
  const conflicts: string[] = [];
  for (const selection of refs) {
    const ref = parseRef(selection.ref);
    if (ref === null) continue;
    if (occupied.has(ref.id)) conflicts.push(labels.get(selection.ref) ?? selection.ref);
  }
  if (conflicts.length > 0) {
    return "以下单位已经在另一场进行中的战斗里，不能重复参战：" + conflicts.join("、");
  }
  return null;
}

export async function createCombatRecord(
  roomId: string,
  effective: EffectivePack,
  allies: readonly string[],
  enemies: readonly string[],
  options: CreateCombatOptions = {}
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
  const placementError = await validateCombatPlacement(roomId, refs, options);
  if (placementError !== null) return { ok: false, error: placementError };
  const pack = effective.compiled;
  const activeGame = await prisma.game.findFirst({
    where: {
      roomId,
      status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  const gameConditions = new Map<string, unknown>();
  if (activeGame !== null && characterIds.length > 0) {
    const rows = await prisma.gameCharacter.findMany({
      where: { gameId: activeGame.id, characterId: { in: [...new Set(characterIds)] } },
      select: { characterId: true, conditions: true }
    });
    for (const row of rows) gameConditions.set(row.characterId, row.conditions);
  }
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
      addParticipant(
        state,
        buildCharacterInit(pack, character, selection.faction, parseConditions(gameConditions.get(character.id)))
      );
    } else {
      const card = cardById.get(ref.id);
      if (card === undefined) return { ok: false, error: "NPC 卡不存在" };
      const defaultNpcSpells = pack.pack.magic?.spells.map((spell) => spell.id) ?? [];
      const init = buildNpcInit(pack, card, selection.faction, defaultNpcSpells);
      if (typeof init === "string") return { ok: false, error: init };
      npcDataById.set(card.id, card.stats);
      const participant = addParticipant(state, init);
      const armorExpression = armorExpressionFromValue(card.stats);
      if (armorExpression !== null) {
        try {
          const rolled = rollDice(parseDice(armorExpression), nextRollRng(state, "npc-armor:" + card.id)).total;
          participant.armor = Math.max(0, Math.floor(rolled));
          participant.maxArmor = participant.armor;
        } catch {
          // 卡面护甲表达式不合法时按 0 处理，不影响战斗创建。
        }
      }
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

/** 把 NPC / 召唤物参战单位的局内状态写回卡片 stats.conditions。 */
async function writeNpcConditions(db: Prisma.TransactionClient, state: CombatState): Promise<void> {
  const npcIds = [...new Set(
    state.participants.filter((participant) => participant.characterId === null).map((participant) => participant.id)
  )];
  if (npcIds.length === 0) return;
  const cards = await db.card.findMany({
    where: { id: { in: npcIds } },
    select: { id: true, stats: true }
  });
  for (const card of cards) {
    const participant = state.participants.find((item) => item.id === card.id);
    if (participant === undefined) continue;
    const base =
      card.stats !== null && typeof card.stats === "object" && Array.isArray(card.stats) === false
        ? { ...(card.stats as Record<string, unknown>) }
        : {};
    base.conditions = persistableConditions(participant);
    await db.card.update({ where: { id: card.id }, data: { stats: base as never } });
  }
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
            conditions: persistableConditions(participant) as never,
            status: participant.dead === true
              ? "DEAD"
              : participant.dying === true
                ? "DYING"
                : participant.unconscious === true || participant.hp <= 0
                  ? "UNCONSCIOUS"
                  : "ALIVE"
          }
        });
      }
      await writeNpcConditions(tx, state);
    }

    if (state.phase === "ENDED") {
      await tx.room.update({ where: { id: combat.roomId }, data: { status: "PLAYING" } });
    }
  });

  if (state.phase === "ENDED") {
    emitCombatEnded(combat.roomId, combatId);
  }
}
