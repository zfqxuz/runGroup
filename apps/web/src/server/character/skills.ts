import { evaluate } from "@touhou/formula";
import { computeDerived, type AttributeSet, type CompiledRulePack } from "@touhou/rules";
import type { Character } from "@prisma/client";

type SkillCharacter = Pick<
  Character,
  "str" | "con" | "siz" | "dex" | "app" | "int" | "pow" | "edu" | "luck" | "race" | "skills"
>;

function attributesOf(character: SkillCharacter): AttributeSet {
  return {
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
}

/**
 * 按规则包补全所有基础技能，再叠加角色实际分配值与种族 / 派生加成。
 * 与战斗初始化保持同一套口径，避免成长检定用错基础值。
 */
export function buildEffectiveSkills(
  pack: CompiledRulePack,
  character: SkillCharacter
): Record<string, number> {
  const outcome = computeDerived(pack, { attributes: attributesOf(character), race: character.race ?? null });
  const skills: Record<string, number> = {};
  for (const skill of pack.skills) {
    skills[skill.id] = Math.floor(evaluate(skill.base, { vars: outcome.attributes, consts: pack.pack.const }));
  }
  const allocated = (character.skills ?? {}) as Record<string, number>;
  for (const [skillId, value] of Object.entries(allocated)) {
    if (typeof value === "number") skills[skillId] = value;
  }
  for (const [skillId, bonus] of Object.entries(outcome.skillBonuses)) {
    skills[skillId] = (skills[skillId] ?? 0) + bonus;
  }
  return skills;
}

export function effectiveSkillValue(
  pack: CompiledRulePack,
  character: SkillCharacter,
  skillId: string
): number {
  return buildEffectiveSkills(pack, character)[skillId] ?? 0;
}
