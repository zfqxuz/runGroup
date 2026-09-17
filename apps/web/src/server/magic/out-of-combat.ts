import type { SummonTemplate } from "@touhou/combat";
import { compile as compileExpr, createSeededRng, evaluate, parseDice, randomSeed, rollDice } from "@touhou/formula";
import {
  canCastOutsideCombat,
  makeCondition,
  parseConditions,
  spellEffectsOf,
  type CompiledRulePack,
  type GameCondition,
  type MagicSpell
} from "@touhou/rules";
import { prisma } from "@/server/db/prisma";
import { createPersistentSummonCard } from "@/server/magic/summons";
import { findSummonCard, summonTemplateFromCard, type SummonCardLike } from "@/server/combat/summon";

export interface MagicActorRef {
  readonly kind: "CHARACTER" | "CARD";
  readonly id: string;
}

export interface OutOfCombatCastInput {
  readonly roomId: string;
  readonly pack: CompiledRulePack;
  readonly spell: MagicSpell;
  readonly caster: MagicActorRef;
  readonly target: MagicActorRef;
  readonly sceneId?: string | null;
}

export interface OutOfCombatCastResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly log: string[];
}

interface ActorSnapshot {
  kind: "CHARACTER" | "CARD";
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  san: number;
  maxSan: number;
  conditions: GameCondition[];
  /** 仅 CHARACTER 使用：GameCharacter 行 id。 */
  gameCharacterId?: string;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function numberField(source: Record<string, unknown>, key: string, fallback = 0): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringField(source: Record<string, unknown>, key: string, fallback = ""): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

async function activeGameId(roomId: string): Promise<string | null> {
  const game = await prisma.game.findFirst({
    where: { roomId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  return game?.id ?? null;
}

async function loadActor(roomId: string, actor: MagicActorRef): Promise<ActorSnapshot | null> {
  if (actor.kind === "CHARACTER") {
    const gameId = await activeGameId(roomId);
    if (gameId === null) return null;
    const row = await prisma.gameCharacter.findUnique({
      where: { gameId_characterId: { gameId, characterId: actor.id } },
      include: { character: true }
    });
    if (row === null) return null;
    return {
      kind: "CHARACTER",
      id: row.characterId,
      gameCharacterId: row.id,
      name: row.character.name,
      hp: row.currentHp,
      maxHp: row.character.maxHp,
      mp: row.currentMp,
      maxMp: row.character.maxMp,
      san: row.currentSan,
      maxSan: row.character.maxSan,
      conditions: parseConditions(row.conditions)
    };
  }
  const card = await prisma.card.findUnique({ where: { id: actor.id } });
  if (card === null) return null;
  const stats = recordOf(card.stats);
  return {
    kind: "CARD",
    id: card.id,
    name: card.name,
    hp: numberField(stats, "currentHp", numberField(stats, "maxHp")),
    maxHp: numberField(stats, "maxHp"),
    mp: numberField(stats, "currentMp", numberField(stats, "maxMp")),
    maxMp: numberField(stats, "maxMp"),
    san: numberField(stats, "currentSan", numberField(stats, "maxSan")),
    maxSan: numberField(stats, "maxSan"),
    conditions: parseConditions(stats.conditions)
  };
}

async function saveActor(actor: ActorSnapshot): Promise<void> {
  if (actor.kind === "CHARACTER" && actor.gameCharacterId !== undefined) {
    await prisma.gameCharacter.update({
      where: { id: actor.gameCharacterId },
      data: {
        currentHp: Math.max(0, Math.floor(actor.hp)),
        currentMp: Math.max(0, Math.floor(actor.mp)),
        currentSan: Math.max(0, Math.floor(actor.san)),
        conditions: actor.conditions as never
      }
    });
    return;
  }
  const card = await prisma.card.findUnique({ where: { id: actor.id }, select: { stats: true } });
  if (card === null) return;
  const stats = recordOf(card.stats);
  stats.currentHp = Math.max(0, Math.floor(actor.hp));
  stats.currentMp = Math.max(0, Math.floor(actor.mp));
  stats.currentSan = Math.max(0, Math.floor(actor.san));
  stats.conditions = actor.conditions;
  await prisma.card.update({ where: { id: actor.id }, data: { stats: stats as never } });
}

function evalNumber(pack: CompiledRulePack, source: string, vars: Record<string, number>): number {
  try {
    const expression = compileExpr(source, { vars: Object.keys(vars), consts: pack.constantNames });
    return evaluate(expression, { vars, consts: pack.pack.const });
  } catch {
    const parsed = Number(source);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

function rollAmount(source: string): number {
  try {
    return rollDice(parseDice(source), createSeededRng(randomSeed())).total;
  } catch {
    const parsed = Number(source);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }
}

/** 通用兜底召唤物：找不到房间独立卡时使用。 */
function genericSummonTemplate(name: string): SummonTemplate {
  return {
    name,
    attributes: { str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50 },
    derived: { hp: 10, maxHp: 10, mp: 0, maxMp: 0, san: 0, maxSan: 0, dp: 0, maxDp: 0 },
    skills: {},
    spells: [],
    damageBonus: "0",
    weapons: [],
    armorExpression: "0"
  };
}

/** 按 cardId / key / 名称 / 别名匹配房间内独立 NPC 卡；匹配不到走通用兜底。 */
async function resolveSummonTemplate(
  roomId: string,
  pack: CompiledRulePack,
  effect: { readonly name: string; readonly key?: string; readonly cardId?: string }
): Promise<SummonTemplate> {
  const cards = await prisma.card.findMany({
    where: { roomId, scope: "ROOM", type: "NPC", system: pack.system },
    select: { id: true, name: true, stats: true }
  });
  const explicit = effect.cardId === undefined ? null : cards.find((card) => card.id === effect.cardId) ?? null;
  const card: SummonCardLike | null = explicit ?? findSummonCard(cards, effect.name, effect.key);
  const template = card === null ? null : summonTemplateFromCard(card, pack);
  if (template === null) return genericSummonTemplate(effect.name.length > 0 ? effect.name : "召唤物");
  return {
    name: template.name,
    attributes: { ...template.attributes },
    derived: { ...template.derived },
    skills: { ...(template.skills ?? {}) },
    spells: [...(template.spells ?? [])],
    damageBonus: template.damageBonus ?? "0",
    weapons: [...(template.weapons ?? [])],
    armorExpression: template.armorExpression ?? "0"
  };
}

/** 战斗外施法的通用入口：先付代价，再按 effects 顺序结算。 */
export async function castOutsideCombat(input: OutOfCombatCastInput): Promise<OutOfCombatCastResult> {
  const log: string[] = [];
  if (canCastOutsideCombat(input.spell) === false) {
    return { ok: false, error: "这个法术包含只能战斗中结算的效果，不能在战斗外使用", log };
  }
  const [caster, target] = await Promise.all([
    loadActor(input.roomId, input.caster),
    loadActor(input.roomId, input.target)
  ]);
  if (caster === null) return { ok: false, error: "施法者不存在", log };
  if (target === null) return { ok: false, error: "目标不存在", log };

  const vars: Record<string, number> = {
    hp: caster.hp,
    maxHp: caster.maxHp,
    mp: caster.mp,
    maxMp: caster.maxMp,
    san: caster.san,
    maxSan: caster.maxSan
  };

  const mpCost = Math.max(0, Math.floor(evalNumber(input.pack, input.spell.mpCost, vars)));
  const sanCost = Math.max(0, Math.floor(evalNumber(input.pack, input.spell.sanCost, vars)));
  if (mpCost > 0 && caster.mp < mpCost) return { ok: false, error: "MP 不足", log };
  if (sanCost > 0 && caster.san < sanCost) return { ok: false, error: "SAN 不足", log };
  const nextCaster: ActorSnapshot = { ...caster, mp: caster.mp - mpCost, san: caster.san - sanCost };
  const sameActor = caster.kind === target.kind && caster.id === target.id;
  const nextTarget: ActorSnapshot = sameActor
    ? nextCaster
    : { ...target, conditions: [...target.conditions] };
  const effects = spellEffectsOf(input.spell);
  for (const effect of effects) {
    if (effect.type === "HEAL") {
      const amount = rollAmount(effect.amount);
      const before = nextTarget.hp;
      nextTarget.hp = Math.min(nextTarget.maxHp, nextTarget.hp + amount);
      log.push("恢复 " + (nextTarget.hp - before) + " HP");
    } else if (effect.type === "MP_RESTORE") {
      const amount = Math.max(0, Math.floor(evalNumber(input.pack, effect.amount, vars)));
      const before = nextTarget.mp;
      nextTarget.mp = Math.min(nextTarget.maxMp, nextTarget.mp + amount);
      log.push("恢复 " + (nextTarget.mp - before) + " MP");
    } else if (effect.type === "SAN_RESTORE") {
      const amount = Math.max(0, Math.floor(evalNumber(input.pack, effect.amount, vars)));
      const before = nextTarget.san;
      nextTarget.san = Math.min(nextTarget.maxSan, nextTarget.san + amount);
      log.push("恢复 " + (nextTarget.san - before) + " SAN");
    } else if (effect.type === "ARMOR") {
      const amount = rollAmount(effect.amount);
      const rounds = Math.max(0, Math.floor(evalNumber(input.pack, effect.durationTicks, vars)));
      nextTarget.conditions = nextTarget.conditions.filter((condition) => condition.type !== "ARMOR");
      nextTarget.conditions.push(
        makeCondition({
          type: "ARMOR",
          sourceActorId: caster.id,
          unit: "ROUND",
          remaining: rounds,
          visibility: "PUBLIC",
          data: { armor: amount }
        })
      );
      log.push("获得护甲 " + amount + (rounds > 0 ? "（" + rounds + " 轮）" : ""));
    } else if (effect.type === "STATUS") {
      const rule = input.pack.pack.statusEffects[effect.key];
      if (rule === undefined) {
        return { ok: false, error: "规则包未定义状态 key：" + effect.key, log };
      }
      const stacks = Math.max(1, Math.floor(evalNumber(input.pack, effect.stacks, vars)));
      const parsedRounds = Number(rule.durationTicks);
      const rounds = Number.isFinite(parsedRounds) ? Math.max(0, Math.floor(parsedRounds)) : 0;
      nextTarget.conditions = nextTarget.conditions.filter((condition) => condition.type !== "STATUS:" + effect.key);
      nextTarget.conditions.push(
        makeCondition({
          type: "STATUS:" + effect.key,
          sourceActorId: caster.id,
          unit: rounds > 0 ? "ROUND" : "NARRATIVE",
          remaining: rounds,
          note: rounds > 0 ? undefined : "由规则包状态持续时间 / KP 裁定",
          visibility: "PUBLIC",
          data: { key: effect.key, stacks }
        })
      );
      log.push("获得状态 " + effect.key + (stacks > 1 ? " x" + stacks : ""));
    } else if (effect.type === "CLEANSE") {
      const keys = effect.keys;
      const before = nextTarget.conditions.length;
      nextTarget.conditions =
        keys.length === 0
          ? nextTarget.conditions.filter((condition) => ["DOT", "STUN", "CONTROL"].includes(condition.type) === false)
          : nextTarget.conditions.filter((condition) => keys.includes(condition.type) === false && keys.includes(String(condition.data.key ?? "")) === false);
      log.push("净化了 " + (before - nextTarget.conditions.length) + " 个状态");
    } else if (effect.type === "POSSESS") {
      const charges = Math.max(1, Math.floor(evalNumber(input.pack, effect.durationTurns, vars)));
      nextTarget.conditions = nextTarget.conditions.filter((condition) => condition.type !== "POSSESS");
      nextTarget.conditions.push(
        makeCondition({
          type: "POSSESS",
          sourceActorId: caster.id,
          controllerId: caster.id,
          sceneId: input.sceneId ?? null,
          unit: "CHARGE",
          remaining: charges,
          visibility: "KP",
          data: { targetId: target.id }
        })
      );
      log.push("夺舍充能 " + charges + " 格（战斗轮次 + Token 移动共用）");
    } else if (effect.type === "SUMMON") {
      const count = Math.max(1, Math.min(8, Math.floor(evalNumber(input.pack, effect.count, vars))));
      const rounds = Math.max(0, Math.floor(evalNumber(input.pack, effect.durationTicks, vars)));
      const template = await resolveSummonTemplate(input.roomId, input.pack, effect);
      for (let index = 0; index < count; index += 1) {
        const cardId = "summon-" + input.caster.id + "-" + Date.now().toString(36) + "-" + index;
        await createPersistentSummonCard({
          id: cardId,
          roomId: input.roomId,
          ownerId: null,
          pack: input.pack,
          template,
          durationTicks: rounds,
          origin: { spellId: input.spell.id, spellName: input.spell.name, casterId: input.caster.id, casterName: caster.name }
        });
        log.push("召唤了「" + template.name + "」" + (rounds > 0 ? "（" + rounds + " 轮）" : ""));
      }
    }
  }

  if (sameActor) {
    await saveActor(nextCaster);
  } else {
    await saveActor(nextCaster);
    await saveActor(nextTarget);
  }
  return { ok: true, log };
}

export interface MagicUnitOption {
  readonly ref: string;
  readonly name: string;
  readonly subtitle: string | null;
  readonly hp: number;
  readonly maxHp: number;
  readonly isOwn: boolean;
  readonly isSummon: boolean;
}

export interface MagicSpellOption {
  readonly id: string;
  readonly name: string;
  readonly mpCost: string;
  readonly sanCost: string;
  readonly summary: string;
}

function unitRef(kind: "CHARACTER" | "CARD", id: string): string {
  return (kind === "CHARACTER" ? "character:" : "card:") + id;
}

export function parseMagicRef(ref: string): MagicActorRef | null {
  if (ref.startsWith("character:")) return { kind: "CHARACTER", id: ref.slice(10) };
  if (ref.startsWith("card:")) return { kind: "CARD", id: ref.slice(5) };
  return null;
}

/** 列出战斗外施法可选的角色 / NPC / 召唤物 / 可用法术。 */
export async function listOutOfCombatMagic(input: {
  readonly roomId: string;
  readonly userId: string;
  readonly isKP: boolean;
  readonly pack: CompiledRulePack;
}): Promise<{ casters: MagicUnitOption[]; targets: MagicUnitOption[]; spells: MagicSpellOption[] }> {
  const gameId = await activeGameId(input.roomId);
  const [rows, cards] = await Promise.all([
    gameId === null
      ? Promise.resolve([])
      : prisma.gameCharacter.findMany({
          where: { gameId },
          include: { character: true },
          orderBy: { id: "asc" }
        }),
    prisma.card.findMany({ where: { roomId: input.roomId, scope: "ROOM", type: "NPC" }, orderBy: { createdAt: "asc" } })
  ]);
  const casters: MagicUnitOption[] = [];
  for (const row of rows) {
    if (input.isKP === false && row.userId !== input.userId) continue;
    casters.push({
      ref: unitRef("CHARACTER", row.characterId),
      name: row.character.name,
      subtitle: row.character.occupation,
      hp: row.currentHp,
      maxHp: row.character.maxHp,
      isOwn: row.userId === input.userId,
      isSummon: false
    });
  }
  for (const card of cards) {
    if (input.isKP === false) continue;
    const stats = recordOf(card.stats);
    casters.push({
      ref: unitRef("CARD", card.id),
      name: card.name,
      subtitle: card.subtitle,
      hp: numberField(stats, "currentHp", numberField(stats, "maxHp")),
      maxHp: numberField(stats, "maxHp"),
      isOwn: false,
      isSummon: stats.summoned === true
    });
  }
  const targets = [...casters];
  const spells: MagicSpellOption[] = (input.pack.pack.magic?.spells ?? [])
    .filter((spell) => canCastOutsideCombat(spell))
    .map((spell) => ({
      id: spell.id,
      name: spell.name,
      mpCost: spell.mpCost,
      sanCost: spell.sanCost,
      summary: spellEffectsOf(spell).map((effect) => effect.type).join(" + ")
    }));
  return { casters, targets, spells };
}
