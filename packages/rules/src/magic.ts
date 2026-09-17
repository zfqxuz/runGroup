import type { MagicEffect, MagicSpell, MagicTargeting } from "./schema";

const OFFENSIVE_EFFECTS = new Set(["DAMAGE", "MP_DRAIN", "SAN_LOSS", "DOT", "STUN", "CONTROL"]);
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
