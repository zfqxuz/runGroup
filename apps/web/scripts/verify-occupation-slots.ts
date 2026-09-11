/**
 * COC7 Excel「本职技能」空位数据回归：
 * - 230 个职业都有 profile；
 * - 固定本职 / ☆ / ⊙ / ☯ / ※ / 任意特长 的核心语义；
 * - 空位分配校验（数量、候选范围、重复占用）。
 * 本脚本不依赖数据库，可直接 tsx 运行。
 */
import { builtinRegistry, compileParsedRulePack, resolveRulePack } from "@touhou/rules";
import profiles from "../src/shared/data/coc7-occupation-slots.json";
import {
  occupationSlotCandidates,
  profileOccupationalSkillIds,
  validateOccupationSlotAssignments,
  type OccupationSkillProfile,
  type OccupationSlot
} from "../src/shared/occupation";

const ALL = profiles as unknown as Readonly<Record<string, OccupationSkillProfile>>;

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("职业空位断言失败：" + message);
}

function profile(code: string): OccupationSkillProfile {
  const value = ALL[code];
  if (value === undefined) throw new Error("缺少职业空位数据：" + code);
  return value;
}

function slotOf(profileValue: OccupationSkillProfile, symbol: string): OccupationSlot {
  const slot = profileValue.slots.find((item) => item.symbol === symbol);
  if (slot === undefined) throw new Error("找不到符号 " + symbol + " 的空位");
  return slot;
}

const pack = resolveRulePack("coc7-baseline", builtinRegistry());
const compiled = compileParsedRulePack(pack);
const allSkillIds = compiled.skills.map((skill) => skill.id);

const architect = profile("12");
ensure(Object.keys(ALL).length === 230, "职业空位数据应为 230 个 COC7 职业");
ensure(architect.fixed.some((item) => item.skillId === "技艺（技术制图）"), "建筑师固定本职应包含技艺（技术制图）");
ensure(architect.fixed.some((item) => item.skillId === "数学"), "建筑师固定本职应包含数学");
const architectChoice = slotOf(architect, "☆");
ensure(architectChoice.pick === 1, "建筑师 ☆ 应为二选一");
ensure(
  architectChoice.candidates.some((item) => item.skillId === "COMPUTER_USE") &&
    architectChoice.candidates.some((item) => item.skillId === "LIBRARY_USE"),
  "建筑师 ☆ 候选应为计算机使用 / 图书馆使用"
);
ensure(validateOccupationSlotAssignments(architect, { "choice-1": ["COMPUTER_USE"] }, allSkillIds).ok, "建筑师 ☆ 选计算机使用应合法");
ensure(validateOccupationSlotAssignments(architect, { "choice-1": ["STEALTH"] }, allSkillIds).ok === false, "建筑师 ☆ 选潜行应被拒绝");
const architectOccupational = profileOccupationalSkillIds(architect, { "choice-1": ["COMPUTER_USE"] });
ensure(architectOccupational.has("COMPUTER_USE"), "空位选中的计算机使用应变为实际本职");
ensure(architectOccupational.has("ACCOUNTING"), "固定本职会计应始终为实际本职");

const secretary = profile("102");
ensure(slotOf(secretary, "☆").candidates.some((item) => item.skillId === "技艺（打字）"), "秘书 ☆ 应包含技艺（打字）");
ensure(slotOf(secretary, "☆").candidates.some((item) => item.skillId === "技艺（速记）"), "秘书 ☆ 应包含技艺（速记）");
ensure(slotOf(secretary, "⊙").pick === 1, "秘书 ⊙ 应为二选一");
ensure(slotOf(secretary, "☯").pick === 2, "秘书社交空位应为 2 项");
const secretaryFree = slotOf(secretary, "ANY");
ensure(secretaryFree.pick === 1, "秘书任意特长应为 1 项");
ensure(occupationSlotCandidates(secretaryFree, allSkillIds).some((item) => item.skillId === "STEALTH"), "任意特长应可选择潜行");
ensure(occupationSlotCandidates(secretaryFree, allSkillIds).some((item) => item.skillId === "CTHULHU_MYTHOS") === false, "任意特长不应包含克苏鲁神话");
const duplicate = validateOccupationSlotAssignments(secretary, { "social-3": ["CHARM", "CHARM"] }, allSkillIds);
ensure(duplicate.ok === false, "同一技能不能重复占用两个空位");

const soldier = profile("229");
ensure(soldier.fixed.some((item) => item.skillId === "FIREARMS_RIFLE"), "士兵固定本职应包含射击（来复）");
ensure(soldier.fixed.some((item) => item.skillId === "FIRST_AID"), "士兵固定本职应包含急救");
ensure(slotOf(soldier, "ANY").pick === 2, "士兵任意特长应为 2 项");

const hunter = profile("18");
ensure(hunter.fixed.some((item) => item.skillId === "生物学"), "猎人固定本职应包含科学（生物）");
ensure(hunter.fixed.some((item) => item.skillId === "植物学"), "猎人固定本职应包含科学（植物）");
ensure(slotOf(hunter, "☆").candidates.some((item) => item.skillId === "LISTEN"), "猎人 ☆ 应包含聆听");
ensure(slotOf(hunter, "⊙").candidates.some((item) => item.skillId === "SURVIVAL"), "猎人 ⊙ 应包含生存");

console.log("PASS 职业空位数据 E2E：230 职业 / 固定本职 / ☆ / ⊙ / ☯ / ※ / 任意特长 / 重复占用校验");
console.log("  建筑师 ☆=" + architectChoice.candidates.map((item) => item.label).join(" / "));
console.log("  秘书 ☆=" + slotOf(secretary, "☆").candidates.map((item) => item.label).join(" / "));
