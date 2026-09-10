export interface OccupationView {
  readonly id: string;
  readonly system: string;
  readonly code: number;
  readonly name: string;
  readonly era: string;
  readonly creditText: string | null;
  readonly pointsText: string | null;
  readonly pointsFormula: string;
  readonly skillsText: string;
  readonly skillNames: readonly string[];
  readonly relations: string | null;
  readonly description: string | null;
}

export const ERA_LABELS: Record<string, string> = {
  MODERN: "现代",
  CLASSIC: "1920 年代",
  BOTH: "通用"
};

const SOCIAL_NAMES = ["魅惑", "取悦", "话术", "恐吓", "说服"];
const FREE_TOKENS = ["任意", "自选"];

function compact(value: string): string {
  return value.replace(/[（(].*?[)）]/g, "").replace(/\s+/g, "").trim();
}

export function isOccupationSkill(
  occupation: Pick<OccupationView, "skillNames">,
  skillName: string
): boolean {
  const name = compact(skillName);
  if (name.length === 0) return false;
  for (const raw of occupation.skillNames) {
    const token = compact(raw);
    if (token.length === 0) continue;
    if (name === token) return true;
    if (name.includes(token) || token.includes(name)) return true;
    if (token.includes("社交") && SOCIAL_NAMES.includes(name)) return true;
    if (FREE_TOKENS.some((free) => token.includes(free))) return true;
  }
  return false;
}

export function hasFreeSkillChoice(
  occupation: Pick<OccupationView, "skillNames">
): boolean {
  return occupation.skillNames.some((token) =>
    FREE_TOKENS.some((free) => token.includes(free))
  );
}

export function toOccupationView(row: {
  readonly id: string;
  readonly system: string;
  readonly code: number;
  readonly name: string;
  readonly era: string;
  readonly creditText: string | null;
  readonly pointsText: string | null;
  readonly pointsFormula: string;
  readonly skillsText: string;
  readonly skillNames: unknown;
  readonly relations: string | null;
  readonly description: string | null;
}): OccupationView {
  const skillNames = Array.isArray(row.skillNames)
    ? row.skillNames.filter((item): item is string => typeof item === "string")
    : [];
  return { ...row, skillNames };
}

export function availableEra(era: string | null): readonly string[] {
  if (era === "CLASSIC") return ["BOTH", "CLASSIC"];
  if (era === "MODERN") return ["BOTH", "MODERN"];
  return ["BOTH", "CLASSIC", "MODERN"];
}
