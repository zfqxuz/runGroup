import { randomUUID } from "node:crypto";
import { parseDice, rollDice } from "@touhou/formula";
import {
  addParticipant,
  persistableConditions,
  advanceToNextEvent,
  beginDpRound,
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
  /** 当前 Token 所在场景；null 表示尚未放入地图。 */
  readonly sceneId: string | null;
  readonly sceneName: string | null;
  /** 已在某场进行中的战斗里；null 表示空闲。 */
  readonly activeCombatId: string | null;
  /** 是否可以直接参战（未入场 / 已在其它战斗中会被置灰）。 */
  readonly eligible: boolean;
  /** 不可参战的原因；eligible=true 时为 null。 */
  readonly ineligibleReason: string | null;
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
  const characterIds = entries
    .filter((entry) => role === "KP" || entry.character.userId === userId)
    .map((entry) => entry.characterId);
  const cardIds = role === "KP" ? cards.map((card) => card.id) : [];
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
  const sceneByEntity = new Map<string, { id: string; name: string }>();
  for (const token of tokens) {
    const entityId = token.characterId ?? token.cardId;
    if (entityId === null) continue;
    sceneByEntity.set(entityId, { id: token.map.sceneId, name: token.map.scene.name });
  }
  const seats = await activeCombatSeats(roomId);
  const decorate = (
    base: Omit<SelectableUnit, "sceneId" | "sceneName" | "activeCombatId" | "eligible" | "ineligibleReason">
  ): SelectableUnit => {
    const entityId = base.ref.startsWith("character:") ? base.ref.slice(10) : base.ref.slice(4);
    const scene = sceneByEntity.get(entityId) ?? null;
    const activeCombatId = seats.get(entityId) ?? null;
    const reasons: string[] = [];
    if (scene === null) reasons.push("尚未放入地图");
    if (activeCombatId !== null) reasons.push("已在另一场进行中的战斗");
    return {
      ...base,
      sceneId: scene?.id ?? null,
      sceneName: scene?.name ?? null,
      activeCombatId,
      eligible: reasons.length === 0,
      ineligibleReason: reasons.length === 0 ? null : reasons.join("；")
    };
  };
  const units: SelectableUnit[] = [];
  for (const entry of entries) {
    const character = entry.character;
    if (role === "KP" || character.userId === userId) {
      units.push(decorate({
        ref: characterRef(character.id),
        kind: "CHARACTER",
        name: character.name,
        subtitle: character.occupation,
        hp: character.maxHp,
        ownerId: character.userId
      }));
    }
  }
  if (role === "KP") {
    for (const card of cards) {
      units.push(decorate({
        ref: npcRef(card.id),
        kind: "NPC",
        name: card.name,
        subtitle: card.subtitle,
        hp: maxHpOfCard(card),
        ownerId: card.ownerId
      }));
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

function numberRecordOf(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = Math.max(0, Math.floor(raw));
  }
  return out;
}

/** 千幻抄能力等级：优先读角色 sourceData.abilities，其次 backstory.abilities。 */
export function characterAbilityLevelsOf(character: Character): Record<string, number> {
  const sourceData = (character.sourceData ?? {}) as Record<string, unknown>;
  const source = numberRecordOf(sourceData.abilities);
  if (Object.keys(source).length > 0) return source;
  const backstory = (character.backstory ?? {}) as Record<string, unknown>;
  return numberRecordOf(backstory.abilities);
}

export function characterSpellsOf(character: Character): string[] {
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
  conditions: readonly GameCondition[] = [],
  vitals?: ParticipantInit["vitals"]
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
    race: character.race ?? null,
    raceFlags: outcome.flags,
    elements:
      character.race === null
        ? []
        : [...(pack.pack.races[character.race]?.elements ?? [])],
    abilityLevels: characterAbilityLevelsOf(character),
    skills,
    spells: characterSpellsOf(character),
    damageBonus: pack.system === "COC7" ? coc7DamageBonus(outcome.attributes.str + outcome.attributes.siz) : "0",
    atbMax: computeAtbMax(pack, vars),
    speed: computeBaseSpeed(pack, vars),
    conditions,
    vitals
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
  const summonOrigin = parsed.data.summonOrigin ?? {};
  const originCasterId = typeof summonOrigin.casterId === "string" ? summonOrigin.casterId : null;
  const isPersistentSummon = parsed.data.summoned === true;
  return {
    id: card.id,
    name: card.name,
    kind: "NPC",
    characterId: null,
    faction,
    attributes,
    derived,
    race: parsed.data.race ?? null,
    raceFlags: parsed.data.race === null ? [] : [...(pack.races[parsed.data.race]?.flags ?? [])],
    elements:
      parsed.data.race === null
        ? []
        : [...(pack.pack.races[parsed.data.race]?.elements ?? [])],
    abilityLevels: { ...parsed.data.abilities },
    // 持久召唤卡再次参战时仍标记为召唤物，便于到期 / 击杀后清理卡与 Token。
    summonedBy: isPersistentSummon ? originCasterId ?? card.id : null,
    summonedName: isPersistentSummon ? card.name : null,
    skills: { ...parsed.data.skills },
    spells: parsed.data.spells.length > 0 ? [...parsed.data.spells] : [...defaultSpells],
    damageBonus: pack.system === "COC7" ? coc7DamageBonus(attributes.str + attributes.siz) : "0",
    atbMax: computeAtbMax(pack, vars),
    speed: computeBaseSpeed(pack, vars),
    isIdentified: false,
    isPublic: card.isPublic,
    conditions: parsed.data.conditions,
    // 战斗外召唤留下的持续轮次：进入战斗后从第 1 轮开始倒计时。
    summonExpiresAtRound:
      parsed.data.summonDurationTicks !== undefined && parsed.data.summonDurationTicks > 0
        ? 1 + parsed.data.summonDurationTicks
        : null
  };
}

function dbPhase(state: CombatState): "ATB_CHARGING" | "ACTION" | "RESOLUTION" | "ENDED" {
  if (state.phase === "ENDED") return "ENDED";
  if (state.phase === "AWAITING_ACTION" || state.phase === "DP_DECLARATION") return "ACTION";
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
  if (characterIds.length === 0 && cardIds.length === 0) {
    for (const selection of refs) result.set(selection.ref, null);
    return result;
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

/** 找出房间内进行中的战斗已占用的实体（entityId -> combatId），避免同一单位同时参加多场战斗。 */
export async function activeCombatSeats(roomId: string): Promise<Map<string, string>> {
  const active = await prisma.combat.findMany({
    where: { roomId, endedAt: null },
    select: { id: true }
  });
  const seats = new Map<string, string>();
  if (active.length === 0) return seats;
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
      if (typeof id === "string" && seats.has(id) === false) seats.set(id, snapshot.combatId);
    }
  }
  return seats;
}

async function activeCombatEntityIds(roomId: string): Promise<Set<string>> {
  return new Set((await activeCombatSeats(roomId)).keys());
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

interface CombatPlacementResult {
  readonly error: string | null;
  /** 校验通过后战斗应绑定的场景；双方都未入场时为 null。 */
  readonly sceneId: string | null;
}

/** 场景隔离 + 进行中战斗席位互斥。 */
async function validateCombatPlacement(
  roomId: string,
  refs: readonly UnitSelection[],
  options: CreateCombatOptions
): Promise<CombatPlacementResult> {
  const scenes = await resolveParticipantScenes(roomId, refs);
  const labels = await refLabels(refs);
  const missing = refs.filter((selection) => (scenes.get(selection.ref) ?? null) === null);
  const present = refs.filter((selection) => (scenes.get(selection.ref) ?? null) !== null);
  let resolvedSceneId: string | null = null;
  // 只有「至少一方已入场」时才强制全体入场，兼容尚未使用地图的旧房间。
  if (present.length > 0) {
    if (missing.length > 0) {
      const names = missing.map((selection) => labels.get(selection.ref) ?? selection.ref).join("、");
      return { error: "以下单位尚未放入地图，不能参战：" + names, sceneId: null };
    }
    const sceneIds = new Set(present.map((selection) => scenes.get(selection.ref)!.sceneId));
    if (sceneIds.size > 1) {
      return { error: "参战单位不在同一场景，战斗已取消。请先把所有人移动到同一场景。", sceneId: null };
    }
    resolvedSceneId = [...sceneIds][0]!;
    if (options.sceneId !== null && options.sceneId !== undefined && options.sceneId !== resolvedSceneId) {
      return { error: "参战单位当前不在指定战斗场景。", sceneId: null };
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
    return { error: "以下单位已经在另一场进行中的战斗里，不能重复参战：" + conflicts.join("、"), sceneId: null };
  }
  return { error: null, sceneId: resolvedSceneId };
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
  const placement = await validateCombatPlacement(roomId, refs, options);
  if (placement.error !== null) return { ok: false, error: placement.error };
  const pack = effective.compiled;
  const activeGame = await prisma.game.findFirst({
    where: {
      roomId,
      status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  const gameCharacterState = new Map<
    string,
    { readonly conditions: unknown; readonly vitals: NonNullable<ParticipantInit["vitals"]> }
  >();
  const missingGameCharacters: {
    readonly characterId: string;
    readonly userId: string;
    readonly currentHp: number;
    readonly currentMp: number;
    readonly currentSan: number;
    readonly currentDp: number;
  }[] = [];
  if (activeGame !== null && characterIds.length > 0) {
    const rows = await prisma.gameCharacter.findMany({
      where: { gameId: activeGame.id, characterId: { in: [...new Set(characterIds)] } },
      select: {
        characterId: true,
        conditions: true,
        currentHp: true,
        currentMp: true,
        currentSan: true,
        currentDp: true
      }
    });
    const existingIds = new Set(rows.map((row) => row.characterId));
    for (const row of rows) {
      gameCharacterState.set(row.characterId, {
        conditions: row.conditions,
        vitals: {
          hp: row.currentHp,
          mp: row.currentMp,
          san: row.currentSan,
          dp: row.currentDp
        }
      });
    }
    // 开局后才通过审核的角色可能没有 GameCharacter；进入战斗时补一条，
    // 否则战斗结束 / 中止时没有局内行可写，房间看板会回退成基础卡的满血值。
    for (const character of characters) {
      if (existingIds.has(character.id)) continue;
      gameCharacterState.set(character.id, {
        conditions: [],
        vitals: {
          hp: character.hp,
          mp: character.mp,
          san: character.san,
          dp: character.dp
        }
      });
      missingGameCharacters.push({
        characterId: character.id,
        userId: character.userId,
        currentHp: character.hp,
        currentMp: character.mp,
        currentSan: character.san,
        currentDp: character.dp
      });
    }
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
      const gameState = gameCharacterState.get(character.id);
      addParticipant(
        state,
        buildCharacterInit(
          pack,
          character,
          selection.faction,
          parseConditions(gameState?.conditions),
          gameState?.vitals
        )
      );
    } else {
      const card = cardById.get(ref.id);
      if (card === undefined) return { ok: false, error: "NPC 卡不存在" };
      const defaultNpcSpells = pack.pack.magic?.spells.map((spell) => spell.id) ?? [];
      const init = buildNpcInit(pack, card, selection.faction, defaultNpcSpells);
      if (typeof init === "string") return { ok: false, error: init };
      // 战斗运行时的 participant.id 是 NPC 卡 id，而 DB CombatParticipant.id 是独立 cuid。
      // 把 participant id 一并写进 npcData，供 loadNpcWeaponsByParticipant 在重载时反查武器。
      npcDataById.set(
        card.id,
        card.stats !== null && typeof card.stats === "object" && Array.isArray(card.stats) === false
          ? { ...(card.stats as Record<string, unknown>), __participantId: card.id }
          : { __participantId: card.id }
      );
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
  else if (pack.combat.mode === "DP") beginDpRound(pack, state);
  else advanceToNextEvent(pack, state);
  const created = await prisma.$transaction(async (tx) => {
    const combat = await tx.combat.create({
      data: {
        roomId,
        sceneId: placement.sceneId,
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
    if (activeGame !== null && missingGameCharacters.length > 0) {
      await tx.gameCharacter.createMany({
        data: missingGameCharacters.map((entry) => ({
          gameId: activeGame.id,
          characterId: entry.characterId,
          userId: entry.userId,
          currentHp: entry.currentHp,
          currentMp: entry.currentMp,
          currentSan: entry.currentSan,
          currentDp: entry.currentDp,
          status: entry.currentHp > 0 ? "ALIVE" : "DEAD",
          conditions: [] as never
        })),
        skipDuplicates: true
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
    base.conditions = persistableConditions(participant, state.round);
    if (participant.summonExpiresAtRound !== null && participant.summonExpiresAtRound !== undefined) {
      const remaining = Math.max(0, participant.summonExpiresAtRound - state.round);
      if (remaining > 0) base.summonDurationTicks = remaining;
      else delete base.summonDurationTicks;
    }
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
            conditions: persistableConditions(participant, state.round) as never,
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
      // 同房间可能还有其它进行中的战斗：只有全部结束才回到 PLAYING。
      const remaining = await tx.combat.count({
        where: { roomId: combat.roomId, endedAt: null }
      });
      await tx.room.update({
        where: { id: combat.roomId },
        data: { status: remaining > 0 ? "COMBAT" : "PLAYING" }
      });
    }
  });

  if (state.phase === "ENDED") {
    emitCombatEnded(combat.roomId, combatId);
  }
}
