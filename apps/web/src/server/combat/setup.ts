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
  collectAbilityPassiveMods,
  computeAtbMax,
  computeBaseSpeed,
  computeDerived,
  effectiveAbilityLevels,
  parseConditions,
  spellcardBattleDeclarationRules,
  spellcardSideUsableCount,
  type AbilityPassiveMods,
  type AttributeSet,
  type CompiledRulePack,
  type DerivedStats,
  type GameCondition
} from "@touhou/rules";
import type { Card, Character, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { EffectivePack } from "@/server/rules/loader";
import { NpcStatsSchema } from "@/shared/npc";
import { SpellCardStatsSchema } from "@/shared/card";
import { currentChapterIdOfRoom, loadUsedSpellcardKeys } from "@/server/combat/spellcard-usage";
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

export interface SelectableSpellcard {
  readonly cardId: string;
  readonly name: string;
  readonly mode: "DECLARATION" | "CONSUMPTION";
  readonly mpCost: number;
}

/**
 * 列出每个候选单位（角色）已装备的 SC，供战前宣言 UI 使用。
 * 只处理 CHARACTER 引用；NPC 暂不参与符卡宣言。
 */
export async function listSelectableSpellcards(
  roomId: string,
  units: readonly SelectableUnit[]
): Promise<Record<string, readonly SelectableSpellcard[]>> {
  const characterIds = units
    .map((unit) => (unit.ref.startsWith("character:") ? unit.ref.slice("character:".length) : null))
    .filter((id): id is string => id !== null && id.length > 0);
  if (characterIds.length === 0) return {};
  const chapterId = await currentChapterIdOfRoom(roomId);
  const usedKeys = await loadUsedSpellcardKeys(roomId, characterIds, chapterId);
  const cards = await prisma.card.findMany({
    where: {
      characterId: { in: [...new Set(characterIds)] },
      type: "SPELLCARD",
      isEquipped: true,
      system: "TOUHOU"
    },
    select: { id: true, name: true, characterId: true, stats: true },
    orderBy: { createdAt: "asc" }
  });
  const byCharacter = new Map<string, SelectableSpellcard[]>();
  for (const card of cards) {
    if (typeof card.characterId !== "string" || card.characterId.length === 0) continue;
    if (usedKeys.has(card.characterId + ":" + card.id)) continue;
    const parsed = SpellCardStatsSchema.safeParse(card.stats);
    if (parsed.success === false) continue;
    const list = byCharacter.get(card.characterId) ?? [];
    list.push({
      cardId: card.id,
      name: card.name,
      mode: parsed.data.mode,
      mpCost: parsed.data.mpCost
    });
    byCharacter.set(card.characterId, list);
  }
  const output: Record<string, readonly SelectableSpellcard[]> = {};
  for (const unit of units) {
    if (unit.ref.startsWith("character:") === false) continue;
    const list = byCharacter.get(unit.ref.slice("character:".length));
    if (list === undefined) continue;
    output[unit.ref] = list;
  }
  return output;
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
  /**
   * 千幻抄战前 SC 宣言：双方各自选定的符卡卡 id。
   * 提供时卡片会被校验归属与数量上限，并限制本场只能使用已宣言的卡。
   */
  readonly spellcardDeclarations?: {
    readonly ALLY?: readonly string[];
    readonly ENEMY?: readonly string[];
  };
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
/** 千幻抄 HP 系数：优先读成长记录 sourceData.touhouGrowth.hpCoefficient，缺省 4。 */
export function characterHpCoefficientOf(character: Character): number {
  const sourceData = (character.sourceData ?? {}) as Record<string, unknown>;
  const growth = sourceData.touhouGrowth;
  if (growth === null || typeof growth !== "object" || Array.isArray(growth)) return 4;
  const value = (growth as Record<string, unknown>).hpCoefficient;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 4;
}

export function characterAbilityLevelsOf(character: Character): Record<string, number> {
  // 车卡编辑器把能力写进 backstory.abilities；导入角色可能只有 sourceData.abilities。
  // backstory 优先，保证编辑器的修改生效。
  const backstory = (character.backstory ?? {}) as Record<string, unknown>;
  const fromBackstory = numberRecordOf(backstory.abilities);
  if (Object.keys(fromBackstory).length > 0) return fromBackstory;
  const sourceData = (character.sourceData ?? {}) as Record<string, unknown>;
  return numberRecordOf(sourceData.abilities);
}

/** 千幻抄能力实例的发动特性值（如属性使 {知性}/{感觉}）；缺省为空。 */
export function characterAbilityAttributesOf(character: Character): Record<string, string> {
  const backstory = (character.backstory ?? {}) as Record<string, unknown>;
  const sourceData = (character.sourceData ?? {}) as Record<string, unknown>;
  const raw =
    backstory.abilityAttributes !== undefined && backstory.abilityAttributes !== null
      ? backstory.abilityAttributes
      : sourceData.abilityAttributes;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && (value === "int" || value === "dex" || value === "pow" || value === "str" || value === "con" || value === "app" || value === "edu" || value === "luck" || value === "siz")) {
      output[key] = value;
    }
  }
  return output;
}

export function characterSpellsOf(character: Character): string[] {
  const sourceData = (character.sourceData ?? {}) as Record<string, unknown>;
  const sourceSpells = stringArrayOf(sourceData.spells);
  if (sourceSpells.length > 0) return sourceSpells;
  const backstory = (character.backstory ?? {}) as Record<string, unknown>;
  return stringArrayOf(backstory.spells);
}

/** 角色已习得的常时能力条目等级（妖力 / 特技）；backstory 优先。 */
export function characterAbilityDefinitionsOf(character: Character): Record<string, number> {
  const backstory = (character.backstory ?? {}) as Record<string, unknown>;
  const fromBackstory = numberRecordOf(backstory.abilityDefinitions);
  if (Object.keys(fromBackstory).length > 0) return fromBackstory;
  const sourceData = (character.sourceData ?? {}) as Record<string, unknown>;
  return numberRecordOf(sourceData.abilityDefinitions);
}

/** 规则包里可直接作为被动表达式常量的数值 const。 */
function numericConstsOf(pack: CompiledRulePack): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(pack.pack.const)) {
    if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
  }
  return output;
}

const ZERO_PASSIVE_MODS: AbilityPassiveMods = {
  attributeMods: {},
  skillMods: {},
  derivedMods: {},
  damageBonus: 0,
  reactionBonus: 0,
  accuracyBonus: 0,
  movementBonus: 0,
  grazeBonusPer: 0,
  danmakuDpReduction: 0,
  danmakuDamageReduction: 0,
  sources: []
};

/** 把被动数值修正叠加到属性 / 技能记录上（不修改原对象）。 */
function applyRecordMods<T extends Record<string, number>>(
  base: T,
  mods: Readonly<Record<string, number>>
): T {
  const output: Record<string, number> = { ...base };
  for (const [key, value] of Object.entries(mods)) {
    if (!Number.isFinite(value)) continue;
    output[key] = Math.max(0, (output[key] ?? 0) + value);
  }
  return output as T;
}

/** 把被动衍生值修正叠加到 DerivedStats 已知键上。 */
function applyDerivedPassives(
  derived: DerivedStats,
  mods: Readonly<Record<string, number>>
): DerivedStats {
  const output: DerivedStats = { ...derived };
  for (const [key, value] of Object.entries(mods)) {
    if (!Number.isFinite(value)) continue;
    const typedKey = key as keyof DerivedStats;
    const current = output[typedKey];
    if (typeof current === "number") {
      output[typedKey] = Math.max(0, current + value) as never;
    }
  }
  return output;
}

/** 计算 TOUHOU 单位的常时被动；其他系统返回空。 */
function passiveModsFor(
  pack: CompiledRulePack,
  abilityLevels: Readonly<Record<string, number>>,
  definitionLevels: Readonly<Record<string, number>>
): AbilityPassiveMods {
  if (pack.system !== "TOUHOU") return ZERO_PASSIVE_MODS;
  return collectAbilityPassiveMods(pack.pack.abilities, {
    abilityLevels,
    definitionLevels,
    constants: numericConstsOf(pack)
  });
}

/** 计算种族免费能力后的有效等级。 */
function effectiveLevelsFor(
  pack: CompiledRulePack,
  abilityLevels: Readonly<Record<string, number>>,
  raceKey: string | null
): Record<string, number> {
  if (pack.system !== "TOUHOU" || raceKey === null) return { ...abilityLevels };
  const race = pack.pack.races[raceKey] ?? null;
  return effectiveAbilityLevels(abilityLevels, race);
}

function buildCharacterInit(
  pack: CompiledRulePack,
  character: Character,
  faction: string,
  conditions: readonly GameCondition[] = [],
  vitals?: ParticipantInit["vitals"]
): ParticipantInit {
  const raceKey = character.race ?? null;
  const baseAttributes: AttributeSet = {
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
  // 种族免费能力（如妖怪 3 级妖术）+ 常时被动（妖力 / 特技）。
  const abilityLevels = effectiveLevelsFor(pack, characterAbilityLevelsOf(character), raceKey);
  const passiveMods = passiveModsFor(pack, abilityLevels, characterAbilityDefinitionsOf(character));
  const attributes = applyRecordMods(baseAttributes, passiveMods.attributeMods);
  const baseSkills = buildEffectiveSkills(pack, character);
  const skills = applyRecordMods(baseSkills, passiveMods.skillMods);
  const hpCoefficient = pack.system === "TOUHOU" ? characterHpCoefficientOf(character) : undefined;
  const outcome = computeDerived(pack, {
    attributes,
    race: raceKey,
    skills,
    constOverrides: hpCoefficient === undefined ? undefined : { HP_COEFFICIENT: hpCoefficient }
  });
  const derived = applyDerivedPassives(outcome.derived, passiveMods.derivedMods);
  const vars: Record<string, number> = { ...outcome.attributes, ...derived };
  return {
    id: character.id,
    name: character.name,
    kind: "PLAYER",
    characterId: character.id,
    faction,
    attributes: outcome.attributes,
    derived,
    race: raceKey,
    raceFlags: outcome.flags,
    elements:
      raceKey === null
        ? []
        : [...(pack.pack.races[raceKey]?.elements ?? [])],
    abilityLevels,
    abilityAttributes: characterAbilityAttributesOf(character),
    passiveMods: {
      damageBonus: passiveMods.damageBonus,
      reactionBonus: passiveMods.reactionBonus,
      accuracyBonus: passiveMods.accuracyBonus,
      movementBonus: passiveMods.movementBonus,
      grazeBonusPer: passiveMods.grazeBonusPer,
      danmakuDpReduction: passiveMods.danmakuDpReduction,
      danmakuDamageReduction: passiveMods.danmakuDamageReduction
    },
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
  const raceKey = parsed.data.race ?? null;
  const abilityLevels = effectiveLevelsFor(pack, parsed.data.abilities, raceKey);
  const passiveMods = passiveModsFor(pack, abilityLevels, parsed.data.abilityDefinitions);
  const attributes = applyRecordMods(parsed.data.attributes as AttributeSet, passiveMods.attributeMods);
  const skills = applyRecordMods(parsed.data.skills, passiveMods.skillMods);
  const baseDerived: DerivedStats = {
    hp: parsed.data.maxHp,
    maxHp: parsed.data.maxHp,
    mp: parsed.data.maxMp,
    maxMp: parsed.data.maxMp,
    san: parsed.data.maxSan,
    maxSan: parsed.data.maxSan,
    dp: parsed.data.maxDp,
    maxDp: parsed.data.maxDp
  };
  const derived = applyDerivedPassives(baseDerived, passiveMods.derivedMods);
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
    race: raceKey,
    raceFlags: raceKey === null ? [] : [...(pack.races[raceKey]?.flags ?? [])],
    elements:
      raceKey === null
        ? []
        : [...(pack.pack.races[raceKey]?.elements ?? [])],
    abilityLevels,
    abilityAttributes: { ...parsed.data.abilityAttributes },
    passiveMods: {
      damageBonus: passiveMods.damageBonus,
      reactionBonus: passiveMods.reactionBonus,
      accuracyBonus: passiveMods.accuracyBonus,
      movementBonus: passiveMods.movementBonus,
      grazeBonusPer: passiveMods.grazeBonusPer,
      danmakuDpReduction: passiveMods.danmakuDpReduction,
      danmakuDamageReduction: passiveMods.danmakuDamageReduction
    },
    // 持久召唤卡再次参战时仍标记为召唤物，便于到期 / 击杀后清理卡与 Token。
    summonedBy: isPersistentSummon ? originCasterId ?? card.id : null,
    summonedName: isPersistentSummon ? card.name : null,
    skills,
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
  // 千幻抄符卡战斗：按「能使用 SC 的人数」算出每一方本场可用 SC 总数。
  if (pack.system === "TOUHOU" && pack.pack.spellcard !== undefined && characterIds.length > 0) {
    const equippedSpellcards = await prisma.card.findMany({
      where: {
        characterId: { in: [...new Set(characterIds)] },
        type: "SPELLCARD",
        isEquipped: true,
        system: "TOUHOU"
      },
      select: { id: true, characterId: true }
    });
    const chapterId = await currentChapterIdOfRoom(roomId);
    const usedKeys = await loadUsedSpellcardKeys(
      roomId,
      equippedSpellcards
        .map((card) => card.characterId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
      chapterId
    );
    const cardOwnerById = new Map<string, string>();
    for (const card of equippedSpellcards) {
      if (typeof card.characterId !== "string" || card.characterId.length === 0) continue;
      // 章节内已使用的 SC 不再进入本场候选 / 宣言池。
      if (usedKeys.has(card.characterId + ":" + card.id)) continue;
      cardOwnerById.set(card.id, card.characterId);
    }
    const usableCharacterIds = new Set(cardOwnerById.values());
    const rules = spellcardBattleDeclarationRules(pack.pack.spellcard);
    const sideUsable: Record<string, number> = {};
    for (const faction of ["ALLY", "ENEMY"]) {
      const usableMembers = state.participants.filter(
        (participant) =>
          participant.faction === faction &&
          participant.characterId !== null &&
          usableCharacterIds.has(participant.characterId)
      ).length;
      sideUsable[faction] = spellcardSideUsableCount(usableMembers, rules);
    }

    const requested = options.spellcardDeclarations;
    if (requested === undefined) {
      state.spellcardBattle = { sideUsable };
    } else {
      const declaredCardIds: Record<string, string[]> = {};
      for (const faction of ["ALLY", "ENEMY"] as const) {
        if (requested[faction] === undefined) continue;
        const unique = [...new Set(requested[faction] ?? [])];
        const valid = unique.filter((cardId) => {
          const owner = cardOwnerById.get(cardId);
          if (owner === undefined) return false;
          return state.participants.some(
            (participant) => participant.characterId === owner && participant.faction === faction
          );
        });
        const cap = sideUsable[faction] ?? 0;
        if (valid.length > cap) {
          return {
            ok: false,
            error:
              (faction === "ALLY" ? "我方" : "敌方") +
              "宣言的符卡数（" +
              valid.length +
              "）超过本场上限（" +
              cap +
              "）"
          };
        }
        declaredCardIds[faction] = valid;
      }
      state.spellcardBattle = { sideUsable, declaredCardIds };
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
