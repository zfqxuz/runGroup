import coc7OccupationSlots from "./data/coc7-occupation-slots.json";

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
  /** COC7 从「本职技能」矩阵解析出的结构化空位；TOUHOU / 未覆盖职业为 null。 */
  readonly skillProfile: OccupationSkillProfile | null;
}

export interface OccupationSlotCandidate {
  readonly skillId: string;
  readonly label: string;
}

export type OccupationSlotKind = "CHOICE" | "SOCIAL" | "MULTI" | "FREE";

export interface OccupationSlot {
  readonly id: string;
  readonly kind: OccupationSlotKind;
  readonly symbol: "☆" | "⊙" | "☯" | "※" | "ANY";
  readonly pick: number;
  readonly candidates: readonly OccupationSlotCandidate[];
}

export interface OccupationSkillProfile {
  readonly fixed: readonly OccupationSlotCandidate[];
  readonly slots: readonly OccupationSlot[];
}

export type OccupationSlotAssignments = Readonly<Record<string, readonly string[]>>;

const COC7_PROFILES = coc7OccupationSlots as unknown as Readonly<Record<string, OccupationSkillProfile>>;

export function occupationSkillProfile(occupation: {
  readonly system: string;
  readonly code: number;
}): OccupationSkillProfile | null {
  if (occupation.system !== "COC7") return null;
  return COC7_PROFILES[String(occupation.code)] ?? null;
}

/**
 * 某个职业在给定空位选择下，所有「实际本职」技能 id。
 * 包括：Excel 固定本职 + 玩家已放入空位的技能。
 */
export function profileOccupationalSkillIds(
  profile: OccupationSkillProfile,
  assignments: OccupationSlotAssignments
): Set<string> {
  const ids = new Set<string>();
  for (const item of profile.fixed) ids.add(item.skillId);
  for (const slot of profile.slots) {
    for (const skillId of assignments[slot.id] ?? []) {
      if (typeof skillId === "string" && skillId.length > 0) ids.add(skillId);
    }
  }
  return ids;
}

/** FREE 空位的候选池；其余空位直接使用 Excel 列出的候选。 */
export function occupationSlotCandidates(
  slot: OccupationSlot,
  allSkillIds: readonly string[]
): readonly OccupationSlotCandidate[] {
  if (slot.kind !== "FREE") return slot.candidates;
  return allSkillIds
    .filter((id) => id !== "CTHULHU_MYTHOS")
    .map((id) => ({ skillId: id, label: id }));
}

export interface OccupationSlotValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly assignedSkillIds: ReadonlySet<string>;
}

/**
 * 校验 Excel 空位分配：
 * - 空位可以不选（0 个）；一旦开始选，数量必须刚好等于 pick；
 * - 候选必须在 Excel 候选列表中；FREE 空位可选择除克苏鲁神话外的任意技能；
 * - 同一个技能不能占两个空位。
 */
export function validateOccupationSlotAssignments(
  profile: OccupationSkillProfile,
  assignments: OccupationSlotAssignments,
  allSkillIds: readonly string[]
): OccupationSlotValidation {
  const errors: string[] = [];
  const assigned = new Set<string>();
  const slotById = new Map(profile.slots.map((slot) => [slot.id, slot]));
  for (const key of Object.keys(assignments)) {
    if (slotById.has(key) === false) errors.push("未知职业空位：" + key);
  }
  for (const slot of profile.slots) {
    const raw = assignments[slot.id] ?? [];
    const picked = raw.filter((id) => typeof id === "string" && id.length > 0);
    if (picked.length === 0) continue;
    if (picked.length !== slot.pick) {
      errors.push(slot.symbol + " 空位需要选择 " + slot.pick + " 项，当前 " + picked.length + " 项");
      continue;
    }
    const allowed = new Set(occupationSlotCandidates(slot, allSkillIds).map((item) => item.skillId));
    for (const id of picked) {
      if (allowed.has(id) === false) {
        errors.push(slot.symbol + " 空位的候选不包含技能：" + id);
      }
      if (assigned.has(id)) {
        errors.push("同一个技能不能占用两个空位：" + id);
      }
      assigned.add(id);
    }
  }
  return { ok: errors.length === 0, errors, assignedSkillIds: assigned };
}

export const ERA_LABELS: Record<string, string> = {
  MODERN: "现代",
  CLASSIC: "1920 年代",
  BOTH: "通用"
};

const SOCIAL_NAMES = ["魅惑", "取笑", "取悦", "话术", "恐吓", "说服"];
const FREE_TOKENS = ["任意", "自选"];
const CATEGORY_TOKENS = [
  "格斗",
  "射击",
  "科学",
  "技艺",
  "外语",
  "语言",
  "驾驶",
  "学问",
  "艺术",
  "社交技能"
];

export type OccupationSkillAccessKind = "FIXED" | "CATEGORY" | "SOCIAL" | "FREE" | "NONE";

export interface OccupationSkillAccess {
  readonly kind: OccupationSkillAccessKind;
  /** CATEGORY 时的分类名，例如「格斗」「技艺」「外语」。 */
  readonly group: string | null;
}

export interface OccupationChoiceLimits {
  readonly free: number;
  readonly social: number;
  readonly categories: Readonly<Record<string, number>>;
}

function compact(value: string): string {
  return value.replace(/[（(].*?[)）]/g, "").replace(/\s+/g, "").trim();
}

function chineseNumber(value: string): number {
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digits[value[1] ?? ""] ?? 0);
  if (value.endsWith("十")) return (digits[value[0] ?? ""] ?? 0) * 10;
  return digits[value] ?? 1;
}

function countFromText(text: string, keyword: string, fallback: number): number {
  const match = new RegExp("([一二两三四五六七八九十0-9]+)\\s*项[^。；，,]*?" + keyword).exec(text);
  return match?.[1] === undefined ? fallback : Math.max(1, chineseNumber(match[1]));
}

export function occupationChoiceLimits(occupation: Pick<OccupationView, "skillNames" | "skillsText">): OccupationChoiceLimits {
  const text = occupation.skillsText;
  const hasSocial = occupation.skillNames.some((token) => token.includes("社交")) || text.includes("社交技能");
  const hasFree = occupation.skillNames.some((token) => FREE_TOKENS.some((free) => token.includes(free)));
  const freeMatch = /(?:任意|自选)\s*([一二两三四五六七八九十0-9]+)?\s*项?/.exec(text);
  const freeCount = freeMatch?.[1] === undefined ? 1 : Math.max(1, chineseNumber(freeMatch[1]));
  const socialCount = countFromText(text, "社交技能", hasSocial ? 1 : 0);
  const categories: Record<string, number> = {};
  for (const token of occupation.skillNames) {
    const base = compact(token);
    if (base.length === 0 || FREE_TOKENS.some((free) => token.includes(free)) || token.includes("社交")) continue;
    if (CATEGORY_TOKENS.includes(base)) categories[base] = categories[base] ?? 1;
  }
  return { free: hasFree ? freeCount : 0, social: socialCount, categories };
}

/** 把「射击（手枪/步枪）」这类 token 展开成多个具体技能名。 */
function tokenAlternatives(token: string): string[] {
  const alternatives = new Set<string>([compact(token)]);
  const match = /[（(]([^）)]*)[）)]/.exec(token);
  if (match?.[1] !== undefined) {
    const base = compact(token);
    for (const part of match[1].split(/[/、,，]/)) {
      const suffix = compact(part);
      if (suffix.length > 0) alternatives.add(base + "（" + suffix + "）");
    }
  }
  return [...alternatives];
}

function normalizeName(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
    .trim();
}

function parentheticalOf(value: string): string | null {
  const match = /[（(]([^）)]*)[）)]/.exec(value);
  return match?.[1] === undefined ? null : normalizeName(match[1]);
}

function fixedMatch(name: string, token: string): boolean {
  const normalizedName = normalizeName(name);
  const normalizedToken = normalizeName(token);
  if (normalizedName === normalizedToken) return true;
  if (tokenAlternatives(token).map(normalizeName).includes(normalizedName)) return true;

  // 「射击（步枪/霰弹枪）」这类：基础名相同、括号里的选项有交集也算固定本职。
  const tokenBase = compact(token);
  const nameBase = compact(name);
  if (tokenBase.length === 0 || tokenBase !== nameBase) return false;
  const tokenInner = parentheticalOf(token);
  const nameInner = parentheticalOf(name);
  if (tokenInner === null || nameInner === null) return false;
  const tokenParts = tokenInner.split(/[/、,，]/).map(normalizeName);
  const nameParts = nameInner.split(/[/、,，]/).map(normalizeName);
  return tokenParts.some((part) => nameParts.includes(part));
}

export function occupationSkillAccess(
  occupation: Pick<OccupationView, "skillNames">,
  skillName: string
): OccupationSkillAccess {
  const name = compact(skillName);
  if (name.length === 0) return { kind: "NONE", group: null };
  let hasFree = false;
  for (const raw of occupation.skillNames) {
    const token = compact(raw);
    if (token.length === 0) continue;
    if (FREE_TOKENS.some((free) => raw.includes(free))) {
      hasFree = true;
      continue;
    }
    if (raw.includes("社交") || token === "社交技能") {
      if (SOCIAL_NAMES.includes(name)) return { kind: "SOCIAL", group: "社交技能" };
      continue;
    }
    // skillsText 里写明「X 项社交技能」时，职业数据可能把候选项也平铺进 skillNames；
    // 此时社交技能应按「选择」处理，而不是当成固定本职。
    if (
      SOCIAL_NAMES.includes(token) &&
      (occupation.skillNames.some((item) => item.includes("社交")) ||
        (occupation as { readonly skillsText?: string }).skillsText?.includes("社交技能") === true)
    ) {
      if (SOCIAL_NAMES.includes(name)) return { kind: "SOCIAL", group: "社交技能" };
      continue;
    }
    if (CATEGORY_TOKENS.includes(token) && (name.startsWith(token) || name.includes(token))) {
      return { kind: "CATEGORY", group: token };
    }
    if (fixedMatch(skillName, raw)) return { kind: "FIXED", group: null };
    if (token.length >= 2 && name.includes(token)) {
      return { kind: "CATEGORY", group: token };
    }
  }
  return hasFree ? { kind: "FREE", group: null } : { kind: "NONE", group: null };
}

/** 职业数据里明确点名的固定本职技能（不包含分类 / 社交 / 任意等可选位）。 */
export function isOccupationSkill(
  occupation: Pick<OccupationView, "skillNames">,
  skillName: string
): boolean {
  return occupationSkillAccess(occupation, skillName).kind === "FIXED";
}

export type SkillPointUsageIssue =
  | "OCCUPATION_NOT_ALLOWED"
  | "INTEREST_NOT_ALLOWED"
  | "MIXED_POINTS";

/**
 * 实际本职技能：
 * - 职业数据明确指定的固定本职；
 * - 用户在分类 / 社交 / 任意可选位里投入职业点、正式选中的技能。
 * 仅仅是“可选本职”但还没选中的技能，不算本职，车卡时按兴趣技能处理。
 */
export function isActualOccupationSkill(input: {
  readonly access: OccupationSkillAccess;
  readonly occupation: number;
}): boolean {
  return input.access.kind === "FIXED" || input.occupation > 0;
}

/**
 * 车卡加点规则：
 * - 职业固定本职 + 用户自行选中的本职（分类 / 社交 / 任意）只能用职业点；
 * - 其余技能一律视为兴趣，只能用兴趣点；
 * - 同一技能不能同时使用职业点和兴趣点。
 */
export function skillPointUsageIssue(input: {
  readonly access: OccupationSkillAccess;
  readonly occupation: number;
  readonly interest: number;
}): SkillPointUsageIssue | null {
  if (input.occupation > 0 && input.access.kind === "NONE") return "OCCUPATION_NOT_ALLOWED";
  if (input.interest > 0 && input.access.kind === "FIXED") return "INTEREST_NOT_ALLOWED";
  if (input.occupation > 0 && input.interest > 0) return "MIXED_POINTS";
  return null;
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
  return { ...row, skillNames, skillProfile: occupationSkillProfile(row) };
}

export function availableEra(era: string | null): readonly string[] {
  if (era === "CLASSIC") return ["BOTH", "CLASSIC"];
  if (era === "MODERN") return ["BOTH", "MODERN"];
  return ["BOTH", "CLASSIC", "MODERN"];
}

export interface SkillCreationCapInput {
  readonly base: number;
  readonly occupation: number;
  readonly interest: number;
  readonly occupationMax: number;
  readonly interestMax: number;
}

/**
 * 车卡最终上限：
 * - 使用了职业点的技能按本职上限（默认 80）。
 * - 只用兴趣点的技能按兴趣上限（默认 70）。
 * - 基础值天然高于上限时（例如高 EDU 的母语），上限至少为基础值，加点不会让总值超过基础值上限。
 */
export function skillCreationCap(input: SkillCreationCapInput): number {
  return input.occupation > 0
    ? Math.max(input.occupationMax, input.base)
    : Math.max(input.interestMax, input.base);
}

export function skillCreationTotal(input: Pick<SkillCreationCapInput, "base" | "occupation" | "interest">): number {
  return input.base + input.occupation + input.interest;
}

export function isSkillCreationWithinCap(input: SkillCreationCapInput): boolean {
  return skillCreationTotal(input) <= skillCreationCap(input);
}
