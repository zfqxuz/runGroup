/**
 * D-5 专精候选：房间级维护「外语 / 科学 / 驾驶 / 生存 / 技艺 / 射击」的候选名称。
 * 数据存放在 Room.ruleOverride.specialtyCandidates（规则包会忽略未知键），
 * 车卡页读取后作为专精名称下拉候选，仍允许玩家自由输入。
 */

export const SPECIALTY_BASE_IDS = [
  "LANGUAGE_OTHER",
  "SCIENCE",
  "驾驶",
  "SURVIVAL",
  "ART_CRAFT",
  "FIREARMS_BOW"
] as const;

export type SpecialtyBaseId = (typeof SPECIALTY_BASE_IDS)[number];

export const SPECIALTY_BASE_LABELS: Record<string, string> = {
  LANGUAGE_OTHER: "外语",
  SCIENCE: "科学",
  "驾驶": "驾驶",
  SURVIVAL: "生存",
  ART_CRAFT: "技艺",
  FIREARMS_BOW: "射击"
};

export interface SpecialtyCandidate {
  readonly baseId: string;
  readonly name: string;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** 宽容清洗：限制数量 / 长度，去重，只接受已知基础技能 id。 */
export function sanitizeSpecialtyCandidates(value: unknown): SpecialtyCandidate[] {
  if (Array.isArray(value) === false) return [];
  const allowed = new Set<string>(SPECIALTY_BASE_IDS);
  const output: SpecialtyCandidate[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 200)) {
    const record = recordOf(item);
    const baseId = typeof record.baseId === "string" ? record.baseId : "";
    const name = typeof record.name === "string" ? record.name.trim().slice(0, 40) : "";
    if (allowed.has(baseId) === false || name.length === 0) continue;
    const key = baseId + "#" + name;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ baseId, name });
  }
  return output;
}

export function specialtyCandidatesOf(ruleOverride: unknown): SpecialtyCandidate[] {
  return sanitizeSpecialtyCandidates(recordOf(ruleOverride).specialtyCandidates);
}
