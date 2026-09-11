import { spellEffectsOf, type MagicEffect, type MagicSpell } from "@touhou/rules";

export function magicEffectLabel(effect: MagicEffect): string {
  if (effect.type === "DAMAGE") return "伤害 " + effect.amount;
  if (effect.type === "HEAL") return "治疗 " + effect.amount;
  if (effect.type === "MP_RESTORE") return "回 MP " + effect.amount;
  if (effect.type === "MP_DRAIN") return "吸 MP " + effect.amount;
  if (effect.type === "SAN_LOSS") return "SAN -" + effect.amount;
  if (effect.type === "SAN_RESTORE") return "SAN +" + effect.amount;
  if (effect.type === "STATUS") return "状态 " + effect.key;
  if (effect.type === "DOT") return "持续伤害 " + effect.amount + "×" + effect.durationTicks;
  if (effect.type === "STUN") return "眩晕 " + effect.durationActions + " 次行动";
  if (effect.type === "CONTROL") return "控制 " + effect.durationActions + " 次行动";
  return "净化";
}

export function magicSpellEffectLabels(spell: MagicSpell): readonly string[] {
  return spellEffectsOf(spell).map((effect) => magicEffectLabel(effect));
}
