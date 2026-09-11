/**
 * COC 7e 伤害加值（Damage Bonus，DB）。
 * 根据 STR + SIZ 查表，返回可直接拼进伤害表达式的字符串。
 */
export function coc7DamageBonus(strPlusSiz: number): string {
  if (strPlusSiz <= 64) return "-2";
  if (strPlusSiz <= 84) return "-1";
  if (strPlusSiz <= 124) return "0";
  if (strPlusSiz <= 164) return "1d4";
  if (strPlusSiz <= 204) return "1d6";
  if (strPlusSiz <= 284) return "2d6";
  if (strPlusSiz <= 364) return "3d6";
  if (strPlusSiz <= 444) return "4d6";
  return "5d6";
}
