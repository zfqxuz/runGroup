import type { ActionSubmission } from "@touhou/combat";
import { parseDice } from "@touhou/formula";
import { spellEffectsOf, spellTargeting, spendMagicPoints, type CompiledRulePack } from "@touhou/rules";
import { prisma } from "@/server/db/prisma";
import type { WeaponDamageBand, WeaponDamageType } from "@/shared/card";

export type CombatReactionType = "PASS" | "DEFEND" | "DODGE" | "COUNTER" | "SEEK_COVER" | "RESIST" | "COVER" | "FLEE";

export interface CombatOptionParticipant {
  readonly id: string;
  readonly kind: "PLAYER" | "NPC";
  readonly characterId: string | null;
  readonly skills: Readonly<Record<string, number>> | null;
}

export interface WeaponLike {
  readonly name: string;
  readonly stats: unknown;
}

export interface CombatAttackOption {
  readonly skillId: string;
  readonly damage: string;
  readonly damageType: WeaponDamageType;
  readonly damageBands: readonly WeaponDamageBand[];
  readonly shots?: readonly number[];
  readonly weaponName: string | null;
  /** 武器自带元素属性 id；没有时为 undefined。 */
  readonly element?: string;
  readonly source: "WEAPON" | "UNARMED" | "DEFAULT";
}

function parseDamageBands(weapon: WeaponLike): readonly WeaponDamageBand[] {
  const stats = (weapon.stats ?? {}) as {
    readonly damage?: unknown;
    readonly damageBands?: unknown;
    readonly range?: unknown;
  };
  const explicit = stats.damageBands;
  if (Array.isArray(explicit)) {
    const bands: WeaponDamageBand[] = [];
    for (const raw of explicit) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const record = raw as Record<string, unknown>;
      const label = nonEmptyString(record.label) ?? "伤害";
      const expression = nonEmptyString(record.expression);
      if (expression === null) continue;
      const rawMax = record.maxFeet;
      const maxFeet =
        rawMax === "DEX"
          ? "DEX"
          : typeof rawMax === "number" && Number.isFinite(rawMax)
            ? rawMax
            : null;
      try {
        parseDice(expression.replace(/db/gi, "0"));
      } catch {
        continue;
      }
      bands.push({ label, expression, maxFeet });
    }
    if (bands.length > 0) return bands;
  }

  const damage = nonEmptyString(stats.damage);
  if (damage === null) return [];
  const candidates = damage.split(/[/／;；|]/).map((part) => part.trim()).filter((part) => part.length > 0);
  const parsed = candidates.filter((candidate) => {
    try {
      parseDice(candidate.replace(/db/gi, "0"));
      return true;
    } catch {
      return false;
    }
  });
  if (parsed.length === 0) return [];
  if (parsed.length === 1) return [{ label: "普通", expression: parsed[0] as string, maxFeet: null }];
  return parsed.map((expression, index) => ({
    label: index === 0 ? "近距离" : index === 1 ? "普通" : "远距离",
    expression,
    maxFeet: index === 0 ? "DEX" : null
  }));
}

function inferWeaponDamageType(weapon: WeaponLike, skillId: string): WeaponDamageType {
  const stats = (weapon.stats ?? {}) as {
    readonly damageType?: unknown;
    readonly impale?: unknown;
    readonly type?: unknown;
  };
  const explicit = nonEmptyString(stats.damageType);
  if (explicit === "BLUNT" || explicit === "IMPALING" || explicit === "NONE") return explicit;
  if (stats.impale === true) return "IMPALING";
  const name = weapon.name.toLowerCase();
  if (skillId.startsWith("FIREARMS_")) {
    if (/霰弹|shotgun|鸟枪/.test(name)) return "NONE";
    return "IMPALING";
  }
  if (/剑|刀|匕首|矛|枪头|箭|blade|sword|knife|dagger|spear/.test(name)) return "IMPALING";
  return "BLUNT";
}

function shotsForWeapon(weapon: WeaponLike, skillId: string): readonly number[] | undefined {
  const stats = (weapon.stats ?? {}) as { readonly shots?: unknown; readonly attacks?: unknown };
  if (Array.isArray(stats.shots)) {
    const shots = stats.shots.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0);
    if (shots.length > 0) return [...new Set(shots)].sort((a, b) => a - b);
  }
  if (skillId === "FIREARMS_HANDGUN") return [1, 2, 3];
  if (typeof stats.attacks === "number" && Number.isInteger(stats.attacks) && stats.attacks > 1) {
    return Array.from({ length: stats.attacks }, (_item, index) => index + 1);
  }
  return undefined;
}

function defaultDamageFor(pack: CompiledRulePack, skillId: string): string {
  // COC7 徒手攻击按规则书为 1D3+DB；其余无武器数据时沿用旧的 1D6 保底。
  if (pack.system === "COC7" && skillId === "FIGHTING_BRAWL") return "1d3+db";
  return "1d6";
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

function weaponElement(weapon: WeaponLike): string | undefined {
  const stats = (weapon.stats ?? {}) as { readonly element?: unknown };
  return nonEmptyString(stats.element) ?? undefined;
}

function inferWeaponSkillId(pack: CompiledRulePack, weapon: WeaponLike): string | null {
  const known = knownSkillIds(pack);
  const stats = (weapon.stats ?? {}) as { skillId?: unknown; range?: unknown };
  const explicit = nonEmptyString(stats.skillId);
  if (explicit === null ? false : known.has(explicit)) return explicit;
  const range = nonEmptyString(stats.range);
  if (pack.system === "COC7") {
    const name = weapon.name.toLowerCase();
    if (range === "MELEE") {
      if (/剑|sword/.test(name) && known.has("格斗（剑）")) return "格斗（剑）";
      if (/斧|axe/.test(name) && known.has("FIGHTING_AXE")) return "FIGHTING_AXE";
      if (/矛|spear/.test(name) && known.has("格斗（矛）")) return "格斗（矛）";
      if (/鞭|whip/.test(name) && known.has("格斗（鞭子）")) return "格斗（鞭子）";
      return known.has("FIGHTING_BRAWL") ? "FIGHTING_BRAWL" : null;
    }
    if (range === "NEAR") return known.has("FIREARMS_HANDGUN") ? "FIREARMS_HANDGUN" : null;
    if (range === "FAR") {
      if (/弓|弩|bow|crossbow/.test(name) && known.has("FIREARMS_BOW")) return "FIREARMS_BOW";
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
    const inferred = equippedWeapons
      .map((weapon) => inferWeaponSkillId(pack, weapon))
      .filter((skillId): skillId is string => skillId !== null);
    return addCoc7BrawlBase([...new Set([...offensiveSkillIds(pack, participant), ...inferred])]);
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

/** 把可用技能与实际装备武器合并成可结算的攻击选项（纯函数，便于测试）。 */
export function attackOptionsForParticipant(
  pack: CompiledRulePack,
  participant: CombatOptionParticipant,
  equipped: readonly WeaponLike[]
): readonly CombatAttackOption[] {
  const allowedSkills = allowedAttackSkills(pack, participant, equipped);
  const weaponBySkill = new Map<string, WeaponLike>();
  for (const weapon of equipped) {
    const skillId = inferWeaponSkillId(pack, weapon);
    if (skillId === null) continue;
    if (weaponBySkill.has(skillId)) continue;
    weaponBySkill.set(skillId, weapon);
  }
  return allowedSkills.map((skillId) => {
    const weapon = weaponBySkill.get(skillId) ?? null;
    const unarmed = weapon === null && pack.system === "COC7" && skillId === "FIGHTING_BRAWL";
    const fallbackDamage = defaultDamageFor(pack, skillId);
    const parsedBands = weapon === null ? [] : parseDamageBands(weapon);
    const bands: readonly WeaponDamageBand[] =
      parsedBands.length > 0 ? parsedBands : [{ label: "普通", expression: fallbackDamage, maxFeet: null }];
    const damage = bands[0]?.expression ?? fallbackDamage;
    const damageType = weapon === null
      ? (skillId === "FIGHTING_BRAWL" ? "BLUNT" : "NONE")
      : inferWeaponDamageType(weapon, skillId);
    const shots = weapon === null ? undefined : shotsForWeapon(weapon, skillId);
    const element = weapon === null ? undefined : weaponElement(weapon);
    return {
      skillId,
      damage,
      damageType,
      damageBands: bands,
      ...(shots === undefined ? {} : { shots }),
      ...(element === undefined ? {} : { element }),
      weaponName: weapon?.name ?? (unarmed ? "徒手" : null),
      source: weapon === null ? (unarmed ? ("UNARMED" as const) : ("DEFAULT" as const)) : ("WEAPON" as const)
    };
  });
}

export function npcWeaponsFromStats(value: unknown): readonly WeaponLike[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = (value as Record<string, unknown>).weapons;
  if (Array.isArray(raw) === false) return [];
  const output: WeaponLike[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = nonEmptyString(record.name) ?? nonEmptyString(record.weapon_name) ?? nonEmptyString(record.weaponName);
    if (name === null) continue;
    output.push({ name, stats: record });
  }
  return output.slice(0, 30);
}

/** 从 CombatParticipant.npcData 中读取团本 NPC 自带的武器 / 攻击方式。 */
export async function loadNpcWeaponsByParticipant(
  combatId: string,
  participants: readonly { readonly id: string; readonly kind: "PLAYER" | "NPC" }[]
): Promise<Map<string, readonly WeaponLike[]>> {
  const npcIds = new Set(
    participants.filter((participant) => participant.kind === "NPC").map((participant) => participant.id)
  );
  if (npcIds.size === 0) return new Map();
  const rows = await prisma.combatParticipant.findMany({
    where: { combatId, isNPC: true },
    select: { id: true, npcData: true }
  });
  const output = new Map<string, readonly WeaponLike[]>();
  for (const row of rows) {
    const data =
      row.npcData !== null && typeof row.npcData === "object" && Array.isArray(row.npcData) === false
        ? (row.npcData as Record<string, unknown>)
        : {};
    const participantId = typeof data.__participantId === "string" ? data.__participantId : row.id;
    if (npcIds.has(participantId) === false) continue;
    const weapons = npcWeaponsFromStats(row.npcData);
    if (weapons.length > 0) output.set(participantId, weapons);
  }
  return output;
}

/**
 * 加载每个单位可用的攻击技能与实际伤害。
 *
 * 玩家角色：优先读取已装备武器卡；没有装备时按规则包决定徒手 / 默认攻击。
 * 团本 NPC：优先读取卡片 stats.weapons；没有武器时按已有战斗技能 / 徒手。
 * 武器上的 damage 就是实际伤害，战斗页面只读展示，服务端结算时也以此为准。
 */
export async function loadAttackOptionsByParticipant(
  pack: CompiledRulePack,
  participants: readonly CombatOptionParticipant[],
  npcWeaponsByParticipant: ReadonlyMap<string, readonly WeaponLike[]> = new Map()
): Promise<Map<string, readonly CombatAttackOption[]>> {
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
        select: { characterId: true, name: true, stats: true },
        orderBy: { createdAt: "asc" }
      });
  const weaponsByCharacter = new Map<string, WeaponLike[]>();
  for (const row of rows) {
    if (row.characterId === null) continue;
    const list = weaponsByCharacter.get(row.characterId) ?? [];
    list.push({ name: row.name, stats: row.stats });
    weaponsByCharacter.set(row.characterId, list);
  }

  const result = new Map<string, readonly CombatAttackOption[]>();
  for (const participant of participants) {
    const equipped =
      participant.kind === "PLAYER" && participant.characterId !== null
        ? weaponsByCharacter.get(participant.characterId) ?? []
        : participant.kind === "NPC"
          ? npcWeaponsByParticipant.get(participant.id) ?? []
          : [];
    result.set(participant.id, attackOptionsForParticipant(pack, participant, equipped));
  }
  return result;
}

/** @deprecated 新代码请使用 loadAttackOptionsByParticipant，以便同时获得实际伤害。 */
export async function loadAttackSkillsByParticipant(
  pack: CompiledRulePack,
  participants: readonly CombatOptionParticipant[]
): Promise<Map<string, readonly string[]>> {
  const options = await loadAttackOptionsByParticipant(pack, participants);
  return new Map(
    [...options.entries()].map(([participantId, list]) => [
      participantId,
      list.map((option) => option.skillId)
    ])
  );
}

/**
 * DP（千幻抄）应对选项：不应对 / 回避 / 防御 / 掩护队友；
 * 能力 / 法术目标额外得到抵抗选项（抵抗由引擎按 DP 骰消耗结算）。
 */
export function dpReactionTypesForParticipant(includeResist = false): readonly CombatReactionType[] {
  return includeResist
    ? ["PASS", "DODGE", "DEFEND", "RESIST", "COVER"]
    : ["PASS", "DODGE", "DEFEND", "COVER"];
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
/** COC7 里只有近战（FIGHTING_*）可以被反击；射击 / 投掷 / 远程只能闪避。 */
export function isMeleeAttackSkill(skillId: string | null | undefined): boolean {
  if (skillId === null || skillId === undefined) return false;
  return skillId.startsWith("FIGHTING_");
}

/**
 * 按本次攻击的类型过滤应对选项：
 * - COC7 火器/投掷：不能被闪避或反击，只能不应对或寻找掩体；
 * - 其他远程攻击：移除「反击」；
 * - 近战：保留闪避/反击。
 */
export function reactionTypesForAttack(
  types: readonly CombatReactionType[],
  attackSkill: string | null | undefined,
  system: "COC7" | "TOUHOU" = "COC7"
): CombatReactionType[] {
  if (attackSkill === null || attackSkill === undefined || attackSkill.length === 0) return [...types];
  const isRanged = attackSkill.startsWith("FIREARMS_") || attackSkill === "THROW";
  if (system === "COC7" && isRanged) {
    const result: CombatReactionType[] = ["PASS", "SEEK_COVER"];
    if (types.includes("FLEE")) result.push("FLEE");
    return result;
  }
  if (isMeleeAttackSkill(attackSkill)) return [...types];
  return types.filter((type) => type !== "COUNTER");
}

export function allowedReactionTypesForParticipant(
  pack: CompiledRulePack,
  attackSkills: ReadonlyMap<string, readonly string[]>,
  participantId: string,
  canFlee = false,
  attackSkill: string | null = null
): readonly CombatReactionType[] {
  const types: CombatReactionType[] = reactionTypesForAttack(allowedReactionTypes(pack), attackSkill, pack.system);
  if (types.includes("COUNTER")) {
    const counterSkills =
      pack.system === "COC7"
        ? (attackSkills.get(participantId) ?? []).filter((skillId) => skillId.startsWith("FIGHTING_"))
        : attackSkills.get(participantId) ?? [];
    if (counterSkills.length === 0) {
      return canFlee ? types.filter((type) => type !== "COUNTER").concat("FLEE") : types.filter((type) => type !== "COUNTER");
    }
  }
  if (canFlee && types.includes("FLEE") === false) types.push("FLEE");
  return types;
}

export interface CombatFeatureFlags {
  readonly canCounter: boolean;
  readonly canOutOfRule: boolean;
  readonly canCastMagic: boolean;
  readonly canCastSpellcard: boolean;
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
        : pack.pack.magic.enabled && pack.pack.magic.spells.length > 0,
    canCastSpellcard: pack.system === "TOUHOU" && pack.pack.spellcard !== undefined
  };
}

export interface CombatActionContext {
  readonly pack: CompiledRulePack;
  readonly state: {
    readonly participants: readonly {
      readonly id: string;
      readonly defeated: boolean;
      readonly faction?: string;
      readonly spells?: readonly string[];
      readonly mp?: number;
      readonly hp?: number;
      readonly dp?: number;
      readonly grazePoints?: number;
      readonly disarmed?: boolean;
    }[];
  };
  readonly attackSkills: ReadonlyMap<string, readonly string[]>;
}

export function validateCombatAction(
  context: CombatActionContext,
  action: ActionSubmission
): string | null {
  const events = context.pack.combat.events;
  if (action.grazeSpend !== undefined) {
    if (context.pack.system !== "TOUHOU") return "只有东方拓展房间可以消费擦弹点";
    const actor = context.state.participants.find((item) => item.id === action.actorId);
    if (actor === undefined) return "行动单位不在场";
    if ((actor.grazePoints ?? 0) <= 0) return "没有擦弹点数可以消费";
  }
  // DP（千幻抄）：行动种类由 dpAction 决定，弹幕无目标、无技能；射击 / 追击 / 近战需要敌方目标。
  if (action.kind === "DANMAKU" && action.dpAction !== undefined) {
    const actor = context.state.participants.find((item) => item.id === action.actorId);
    if (actor === undefined) return "行动单位不在场";
    if (action.dpAction === "DANMAKU" || action.dpAction === "SKILL") return null;
    const targetIds =
      action.dpAction === "CHASE"
        ? [...(action.dpTargetIds ?? [])]
        : action.targetId === undefined || action.targetId === null
          ? []
          : [action.targetId];
    if (targetIds.length === 0) return "行动需要目标";
    for (const id of targetIds) {
      const target = context.state.participants.find((item) => item.id === id);
      if (target === undefined || target.defeated) return "目标已不在场";
      if (target.id === actor.id) return "不能攻击自己";
      if (target.faction !== undefined && actor.faction !== undefined && target.faction === actor.faction) {
        return "只能攻击敌方";
      }
    }
    return null;
  }
  if (action.kind === "SPELLCARD") {
    if (context.pack.system !== "TOUHOU") return "只有東方拓展房间可以使用符卡";
    if (context.pack.pack.spellcard === undefined) return "本规则包不支持符卡";
  }
  if (action.kind === "MAGIC") {
    const magic = context.pack.pack.magic;
    if (magic === undefined || magic.enabled === false) return "本规则包未启用魔法规则";
    const spell = magic.spells.find(
      (item) => item.id === action.spellId || item.name === action.name
    );
    if (spell === undefined) return "没有找到这个法术";
    const actor = context.state.participants.find((item) => item.id === action.actorId);
    if (actor === undefined) return "施法者不在场";
    const actorSpells = actor.spells ?? [];
    if (actorSpells.includes(spell.id) === false) {
      return "该单位没有学会这个法术";
    }
    for (const effect of spellEffectsOf(spell)) {
      if (effect.type === "STATUS" && context.pack.statusEffects[effect.key] === undefined) {
        return "法术「" + spell.name + "」使用了规则包未定义的状态 key：「" + effect.key + "」";
      }
    }
    const targeting = spellTargeting(spell);
    if (targeting === "SELF" || spell.target === "SELF") return null;
    // ALL 由服务端按阵营选择目标；ONE 需要玩家指定合法目标。
    if (spell.target === "ALL") return null;
    const targetId = action.targetId ?? null;
    if (targetId === null) return "施法需要目标";
    const target = context.state.participants.find((item) => item.id === targetId);
    if (target === undefined || target.defeated) return "目标已不在场";
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
  if (action.kind === "ITEM") {
    const effects = action.effects ?? [];
    if (effects.length === 0) return "这个道具没有可结算效果";
    const actor = context.state.participants.find((item) => item.id === action.actorId);
    if (actor === undefined) return "使用者不在场";
    if (context.pack.system === "COC7") {
      const spend = spendMagicPoints(
        actor.mp ?? 0,
        actor.hp ?? 0,
        action.mpCost ?? 0,
        context.pack.pack.magicPoint
      );
      if (spend.allowed === false) return "灵力不足";
    } else if ((action.mpCost ?? 0) > (actor.mp ?? 0)) {
      return "灵力不足";
    }
    for (const effect of effects) {
      if (effect.type === "STATUS" && context.pack.statusEffects[effect.key] === undefined) {
        return "道具使用了规则包未定义的状态 key：「" + effect.key + "」";
      }
    }
    const targeting = action.targeting ?? "ENEMY";
    const scope = action.targetScope ?? "ONE";
    if (scope === "SELF" || targeting === "SELF") return null;
    if (scope === "ALL") return null;
    const targetId = action.targetId ?? null;
    if (targetId === null) return "使用道具需要目标";
    const target = context.state.participants.find((item) => item.id === targetId);
    if (target === undefined || target.defeated) return "目标已不在场";
    if (targeting === "ENEMY" && target.id === actor.id) return "这个道具不能对自己使用";
    if (targeting === "ENEMY" && target.faction !== undefined && actor.faction !== undefined && target.faction === actor.faction) {
      return "这个道具只能对敌方使用";
    }
    if (targeting === "ALLY" && target.faction !== undefined && actor.faction !== undefined && target.faction !== actor.faction && target.id !== actor.id) {
      return "这个道具只能对友方使用";
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
    const allowed = context.attackSkills.get(action.actorId) ?? [];
    const actor = context.state.participants.find((item) => item.id === action.actorId);
    // U-3：多目标 / 多技能 routine 逐步骤校验。
    if (action.routine !== undefined && action.routine.length > 0) {
      for (const step of action.routine) {
        const target = context.state.participants.find((item) => item.id === step.targetId);
        if (target === undefined || target.defeated) return "目标已不在场";
        if (target.id === action.actorId) return "不能攻击自己";
        const skill = step.skill ?? action.skill;
        if (skill === undefined || allowed.includes(skill) === false) {
          return "该单位不能使用这个技能攻击";
        }
        if (actor?.disarmed === true && skill !== "FIGHTING_BRAWL") {
          return "该单位已被缴械，只能徒手攻击";
        }
      }
      return null;
    }
    const targetId = action.targetId ?? null;
    if (targetId === null) return "攻击需要目标";
    const target = context.state.participants.find((item) => item.id === targetId);
    if (target === undefined || target.defeated) return "目标已不在场";
    if (target.id === action.actorId) return "不能攻击自己";
    if (action.skill === undefined || allowed.includes(action.skill) === false) {
      return "该单位不能使用这个技能攻击";
    }
    if (actor?.disarmed === true && action.skill !== "FIGHTING_BRAWL") {
      return "该单位已被缴械，只能徒手攻击";
    }
  }
  if (action.kind === "MANEUVER") {
    if (context.pack.system !== "COC7") return "只有 COC7 支持战技";
    const targetId = action.targetId ?? null;
    if (targetId === null) return "战技需要目标";
    const target = context.state.participants.find((item) => item.id === targetId);
    if (target === undefined || target.defeated) return "目标已不在场";
    if (target.id === action.actorId) return "不能对自己使用战技";
    const allowed = context.attackSkills.get(action.actorId) ?? [];
    if (allowed.includes("FIGHTING_BRAWL") === false) return "该单位不会格斗（斗殴）";
  }
  return null;
}
