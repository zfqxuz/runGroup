import type { MagicEffect, MagicSpell, MagicTargeting } from "./schema";

const OFFENSIVE_EFFECTS = new Set(["DAMAGE", "MP_DRAIN", "SAN_LOSS", "DOT", "STUN", "CONTROL", "POSSESS"]);
/** 战斗外不能直接结算的效果：依赖战斗轮次、对抗或目标对抗。 */
const OUT_OF_COMBAT_BLOCKED_EFFECTS = new Set(["DAMAGE", "DOT", "MP_DRAIN", "SAN_LOSS"]);
const SUPPORTIVE_EFFECTS = new Set(["HEAL", "MP_RESTORE", "SAN_RESTORE", "STATUS", "ARMOR", "SUMMON", "CLEANSE"]);

/** 兼容旧字段：damage 等价于一个 DAMAGE 指令。 */
export function spellEffectsOf(spell: MagicSpell): readonly MagicEffect[] {
  if (spell.effects.length > 0) return spell.effects;
  if (spell.damage !== undefined && spell.damage.length > 0 && spell.damage !== "0") {
    return [{ type: "DAMAGE", amount: spell.damage }];
  }
  return [];
}

export function spellTargeting(spell: MagicSpell): MagicTargeting {
  const types = spellEffectsOf(spell).map((effect) => effect.type);
  // 召唤类法术的目标是施法者自己；即使模型误标了 ENEMY，也按 SELF 处理。
  if (types.includes("SUMMON")) return "SELF";
  if (spell.target === "SELF") return "SELF";
  if (spell.targeting !== undefined) return spell.targeting;
  const offensive = types.some((type) => OFFENSIVE_EFFECTS.has(type));
  const supportive = types.some((type) => SUPPORTIVE_EFFECTS.has(type));
  if (offensive && supportive) return "ANY";
  if (offensive) return "ENEMY";
  if (supportive) return "ALLY";
  return "ANY";
}

export function isHostileSpell(spell: MagicSpell): boolean {
  const targeting = spellTargeting(spell);
  if (targeting === "SELF" || targeting === "ALLY") return false;
  return spellEffectsOf(spell).some((effect) => OFFENSIVE_EFFECTS.has(effect.type));
}

/**
 * 是否允许在战斗外施放。
 * 只排除依赖战斗结算的攻击性效果（伤害 / 持续伤害 / 吸 MP / 扣 SAN）；
 * 治疗、回 MP / SAN、护甲、状态、净化、召唤、夺舍都允许战斗外使用。
 */
export function canCastOutsideCombat(spell: MagicSpell): boolean {
  const effects = spellEffectsOf(spell);
  if (effects.length === 0) return false;
  return effects.every((effect) => OUT_OF_COMBAT_BLOCKED_EFFECTS.has(effect.type) === false);
}

/** 战斗外施法被阻止的原因；null 表示可以施放。 */
export function outOfCombatBlockReason(spell: MagicSpell): string | null {
  const blocked = spellEffectsOf(spell).filter((effect) => OUT_OF_COMBAT_BLOCKED_EFFECTS.has(effect.type));
  if (blocked.length === 0) return null;
  return "战斗外不能直接施放：「" + blocked.map((effect) => effect.type).join("、") + "」需要在战斗中结算";
}
