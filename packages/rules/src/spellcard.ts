import type { SpellCardRules } from "./schema";

export interface SpellcardBattleDeclarationRules {
  readonly perMember: number;
  readonly rounding: "CEIL" | "ROUND" | "FLOOR";
  readonly min: number;
}

/**
 * 符卡战斗开始前，一方本场可用的 SC 总数。
 *
 * 千幻抄 6.1.2：一方的 SC 数大约为「能使用 SC 的人数 × 2~2.5」；
 * 不能使用 SC 的成员（无 SC 卡 / 雑鱼）不计入人数。
 */
export function spellcardSideUsableCount(
  usableMemberCount: number,
  rules: SpellcardBattleDeclarationRules
): number {
  const members = Math.max(0, Math.floor(Number.isFinite(usableMemberCount) ? usableMemberCount : 0));
  if (members <= 0) return 0;
  const perMember = Number.isFinite(rules.perMember) ? Math.max(0, rules.perMember) : 0;
  const raw = members * perMember;
  const rounded =
    rules.rounding === "ROUND" ? Math.round(raw) : rules.rounding === "FLOOR" ? Math.floor(raw) : Math.ceil(raw);
  return Math.max(rules.min, rounded);
}

/** 从规则包字段读取宣言配置；缺省时按 2.5 / CEIL / 1 处理。 */
export function spellcardBattleDeclarationRules(
  spellcard: SpellCardRules | undefined
): SpellcardBattleDeclarationRules {
  return (
    spellcard?.battleDeclaration ?? {
      perMember: 2.5,
      rounding: "CEIL",
      min: 1
    }
  );
}
