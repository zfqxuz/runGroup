import type { ActionSubmission } from "@touhou/combat";
import { spellTargeting, type CompiledRulePack } from "@touhou/rules";
import { prisma } from "@/server/db/prisma";

export type CombatReactionType = "PASS" | "DEFEND" | "DODGE" | "COUNTER";

export interface CombatOptionParticipant {
  readonly id: string;
  readonly kind: "PLAYER" | "NPC";
  readonly characterId: string | null;
  readonly skills: Readonly<Record<string, number>> | null;
}

interface WeaponLike {
  readonly name: string;
  readonly stats: unknown;
}

function hasSkill(participant: CombatOptionParticipant, skillId: string): boolean {
  return Object.prototype.hasOwnProperty.call(participant.skills ?? {}, skillId);
}

function knownSkillIds(pack: CompiledRulePack): Set<string> {
  return new Set(pack.skills.map((skill) => skill.id));
}

function isDefensiveSkill(skillId: string): boolean {
  return skillId === "DODGE" || skillId === "GRAZE";
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function inferWeaponSkillId(pack: CompiledRulePack, weapon: WeaponLike): string | null {
  const known = knownSkillIds(pack);
  const stats = (weapon.stats ?? {}) as { skillId?: unknown; range?: unknown };
  const explicit = nonEmptyString(stats.skillId);
  if (explicit === null ? false : known.has(explicit)) return explicit;
  const range = nonEmptyString(stats.range);
  if (pack.system === "COC7") {
    if (range === "MELEE") {
      const name = weapon.name.toLowerCase();
      if (name.includes("斧") || name.includes("axe")) {
        return known.has("FIGHTING_AXE") ? "FIGHTING_AXE" : null;
      }
      return known.has("FIGHTING_BRAWL") ? "FIGHTING_BRAWL" : null;
    }
    if (range === "NEAR") return known.has("FIREARMS_HANDGUN") ? "FIREARMS_HANDGUN" : null;
    if (range === "FAR") {
      const name = weapon.name.toLowerCase();
      if (name.includes("弓") || name.includes("bow")) {
        return known.has("FIREARMS_BOW") ? "FIREARMS_BOW" : null;
      }
      return known.has("FIREARMS_RIFLE") ? "FIREARMS_RIFLE" : null;
    }
    return known.has("FIGHTING_BRAWL") ? "FIGHTING_BRAWL" : null;
  }
  if (range === "MELEE") return known.has("MELEE") ? "MELEE" : null;
  return known.has("DANMAKU") ? "DANMAKU" : null;
}

function offensiveSkillIds(pack: CompiledRulePack, participant: CombatOptionParticipant): string[] {
  return pack.skills
    .filter((skill) => skill.category === "COMBAT" && isDefensiveSkill(skill.id) === false)
    .map((skill) => skill.id)
    .filter((skillId) => hasSkill(participant, skillId));
}

function fallbackAttackSkills(pack: CompiledRulePack, participant: CombatOptionParticipant): string[] {
  if (pack.system === "COC7") {
    // COC7 所有角色都有基础技能；斗殴基础值 25，没写在卡上也必须能用。
    if (knownSkillIds(pack).has("FIGHTING_BRAWL")) return ["FIGHTING_BRAWL"];
    return offensiveSkillIds(pack, participant).slice(0, 1);
  }
  const preferred = ["DANMAKU", "MELEE", "THROW"];
  const available = preferred.filter((skillId) => hasSkill(participant, skillId));
  return available.length > 0 ? available : offensiveSkillIds(pack, participant);
}

export function allowedAttackSkills(
  pack: CompiledRulePack,
  participant: CombatOptionParticipant,
  equippedWeapons: readonly WeaponLike[]
): readonly string[] {
  const known = knownSkillIds(pack);
  const addCoc7BrawlBase = (ids: string[]): string[] => {
    if (pack.system !== "COC7") return ids;
    if (known.has("FIGHTING_BRAWL") === false) return ids;
    return ids.includes("FIGHTING_BRAWL") ? ids : [...ids, "FIGHTING_BRAWL"];
  };

  if (participant.kind === "NPC") {
    return addCoc7BrawlBase(offensiveSkillIds(pack, participant));
  }
  const skillIds: string[] = [];
  for (const weapon of equippedWeapons) {
    const inferred = inferWeaponSkillId(pack, weapon);
    if (inferred === null) continue;
    if (known.has(inferred) === false) continue;
    if (hasSkill(participant, inferred) === false) continue;
    skillIds.push(inferred);
  }
  const unique = [...new Set(skillIds)];
  return unique.length > 0 ? unique : fallbackAttackSkills(pack, participant);
}

export async function loadAttackSkillsByParticipant(
  pack: CompiledRulePack,
  participants: readonly CombatOptionParticipant[]
): Promise<Map<string, readonly string[]>> {
  const characterIds = participants
    .map((participant) => participant.characterId)
    .filter((id): id is string => typeof id === "string");
  const rows = characterIds.length === 0
    ? []
    : await prisma.card.findMany({
        where: {
          characterId: { in: characterIds },
          type: "WEAPON",
          isEquipped: true
        },
        select: { characterId: true, name: true, stats: true }
      });
  const weaponsByCharacter = new Map<string, WeaponLike[]>();
  for (const row of rows) {
    if (row.characterId === null) continue;
    const list = weaponsByCharacter.get(row.characterId) ?? [];
    list.push({ name: row.name, stats: row.stats });
    weaponsByCharacter.set(row.characterId, list);
  }
  const result = new Map<string, readonly string[]>();
  for (const participant of participants) {
    const equipped =
      participant.kind === "PLAYER" && participant.characterId !== null
        ? weaponsByCharacter.get(participant.characterId) ?? []
        : [];
    result.set(participant.id, allowedAttackSkills(pack, participant, equipped));
  }
  return result;
}

export function allowedReactionTypes(pack: CompiledRulePack): readonly CombatReactionType[] {
  const counter = pack.combat.events.COUNTER;
  if (pack.system === "COC7") {
    // COC7：闪避或反击，没有「防御姿态」。
    const types: CombatReactionType[] = ["PASS", "DODGE"];
    if (counter !== undefined && counter.defaultEnabled === true) types.push("COUNTER");
    return types;
  }
  const types: CombatReactionType[] = ["PASS", "DEFEND", "DODGE"];
  if (counter === undefined) return types;
  if (counter.defaultEnabled === true) types.push("COUNTER");
  return types;
}

/**
 * 某个具体单位可用的应对选项。
 * COC7 反击是格斗（斗殴）检定，所有角色都有斗殴基础值 25；
 * 因此只要规则包定义了 FIGHTING_BRAWL，就始终下发 COUNTER。
 * 东方包仍按单位实际拥有的攻击技能过滤，避免出现无技能可选的反击。
 */
export function allowedReactionTypesForParticipant(
  pack: CompiledRulePack,
  attackSkills: ReadonlyMap<string, readonly string[]>,
  participantId: string
): readonly CombatReactionType[] {
  const types = allowedReactionTypes(pack);
  if (types.includes("COUNTER") === false) return types;
  if (pack.system === "COC7") {
    const hasBrawlBase = pack.skills.some((skill) => skill.id === "FIGHTING_BRAWL");
    return hasBrawlBase ? types : types.filter((type) => type !== "COUNTER");
  }
  const counterSkills = attackSkills.get(participantId) ?? [];
  if (counterSkills.length === 0) {
    return types.filter((type) => type !== "COUNTER");
  }
  return types;
}

export interface CombatFeatureFlags {
  readonly canCounter: boolean;
  readonly canOutOfRule: boolean;
  readonly canCastMagic: boolean;
}

export function combatFeatureFlags(pack: CompiledRulePack): CombatFeatureFlags {
  const counter = pack.combat.events.COUNTER;
  const outOfRule = pack.combat.events.OUT_OF_RULE_SPELL;
  return {
    canCounter: counter === undefined ? false : counter.defaultEnabled === true,
    canOutOfRule:
      pack.pack.spellcard === undefined
        ? false
        : outOfRule === undefined
          ? false
          : outOfRule.defaultEnabled === true,
    canCastMagic:
      pack.pack.magic === undefined
        ? false
        : pack.pack.magic.enabled && pack.pack.magic.spells.length > 0
  };
}

export interface CombatActionContext {
  readonly pack: CompiledRulePack;
  readonly state: {
    readonly participants: readonly { readonly id: string; readonly defeated: boolean; readonly faction?: string }[];
  };
  readonly attackSkills: ReadonlyMap<string, readonly string[]>;
}

export function validateCombatAction(
  context: CombatActionContext,
  action: ActionSubmission
): string | null {
  const events = context.pack.combat.events;
  if (action.kind === "SPELLCARD" && context.pack.pack.spellcard === undefined) {
    return "本规则包不支持符卡";
  }
  if (action.kind === "MAGIC") {
    const magic = context.pack.pack.magic;
    if (magic === undefined || magic.enabled === false) return "本规则包未启用魔法规则";
    const spell = magic.spells.find(
      (item) => item.id === action.spellId || item.name === action.name
    );
    if (spell === undefined) return "没有找到这个法术";
    const targeting = spellTargeting(spell);
    if (targeting === "SELF" || spell.target === "SELF") return null;
    // ALL 由服务端按阵营选择目标；ONE 需要玩家指定合法目标。
    if (spell.target === "ALL") return null;
    const targetId = action.targetId ?? null;
    if (targetId === null) return "施法需要目标";
    const target = context.state.participants.find((item) => item.id === targetId);
    if (target === undefined || target.defeated) return "目标已不在场";
    const actor = context.state.participants.find((item) => item.id === action.actorId);
    if (actor === undefined) return "施法者不在场";
    if (targeting === "ENEMY" && target.id === actor.id) return "这个法术不能对自己使用";
    if (
      targeting === "ENEMY" &&
      target.faction !== undefined &&
      actor.faction !== undefined &&
      target.faction === actor.faction
    ) {
      return "这个法术只能对敌方使用";
    }
    if (
      targeting === "ALLY" &&
      target.faction !== undefined &&
      actor.faction !== undefined &&
      target.faction !== actor.faction &&
      target.id !== actor.id
    ) {
      return "这个法术只能对友方使用";
    }
  }
  if (action.kind === "OUT_OF_RULE") {
    if (context.pack.pack.spellcard === undefined) return "本规则包不支持规则外施法";
    const event = events.OUT_OF_RULE_SPELL;
    if (event === undefined || event.defaultEnabled === false) return "本房已禁用规则外施法";
  }
  if (action.kind === "COUNTER") {
    const event = events.COUNTER;
    if (event === undefined || event.defaultEnabled === false) {
      return context.pack.system === "COC7" ? "本规则包不支持反击" : "本规则包不支持消弹";
    }
  }
  if (action.kind === "DANMAKU") {
    const targetId = action.targetId ?? null;
    if (targetId === null) return "攻击需要目标";
    const target = context.state.participants.find((item) => item.id === targetId);
    if (target === undefined || target.defeated) return "目标已不在场";
    if (target.id === action.actorId) return "不能攻击自己";
    const allowed = context.attackSkills.get(action.actorId) ?? [];
    if (action.skill === undefined || allowed.includes(action.skill) === false) {
      return "该单位不能使用这个技能攻击";
    }
  }
  return null;
}
