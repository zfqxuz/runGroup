/**
 * CoC7 车卡规则回归：
 * - 本职 / 分类 / 社交 / 任意 的选择判定不再把所有技能标成本职。
 * - 本职上限 80、兴趣上限 70。
 * - 基础值天然高于上限（如高 EDU 的母语）不报错、也不能再加点。
 */
import { builtinRegistry, compileParsedRulePack, resolveRulePack } from "@touhou/rules";
import { prisma } from "../src/server/db/prisma";
import {
  isActualOccupationSkill,
  isSkillCreationWithinCap,
  isOccupationSkill,
  occupationChoiceLimits,
  occupationSkillAccess,
  skillCreationCap,
  skillCreationTotal,
  skillPointUsageIssue,
  toOccupationView
} from "../src/shared/occupation";

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("车卡规则断言失败：" + message);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error("车卡规则断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

async function loadOccupation(name: string) {
  const row = await prisma.occupation.findFirst({ where: { system: "COC7", name } });
  if (row === null) throw new Error("找不到职业：" + name);
  return toOccupationView(row);
}

async function main(): Promise<void> {
  // 1. 固定本职 / 分类 / 非本职。
  const architect = await loadOccupation("建筑师");
  expectEqual(occupationSkillAccess(architect, "法律").kind, "FIXED", "建筑师·法律应为本职");
  expectEqual(occupationSkillAccess(architect, "母语").kind, "FIXED", "建筑师·母语应为本职");
  expectEqual(occupationSkillAccess(architect, "科学（生物学）").kind, "CATEGORY", "建筑师·科学（生物学）应属于科学分类");
  expectEqual(occupationSkillAccess(architect, "潜行").kind, "NONE", "建筑师·潜行不应是本职");
  ensure(isOccupationSkill(architect, "潜行") === false, "建筑师·潜行不应标成本职");
  ensure(isOccupationSkill(architect, "法律") === true, "建筑师·法律应视为固定本职");

  // 2. 带「任意」「社交技能」的职业：任意技能是可选项，不是本职；社交有数量上限。
  const magician = await loadOccupation("魔术师");
  expectEqual(occupationSkillAccess(magician, "精神分析").kind, "FIXED", "魔术师·精神分析应为本职");
  expectEqual(occupationSkillAccess(magician, "恐吓").kind, "SOCIAL", "魔术师·恐吓应为社交选项");
  expectEqual(occupationSkillAccess(magician, "潜行").kind, "FREE", "魔术师·潜行应为任意可选项");
  ensure(isOccupationSkill(magician, "潜行") === false, "任意可选项不应标成本职");
  const magicianLimits = occupationChoiceLimits(magician);
  expectEqual(magicianLimits.social, 1, "魔术师社交技能数量应为 1");
  expectEqual(magicianLimits.free, 2, "魔术师任意技能数量应为 2");

  // 3. 车卡上限：本职 80、兴趣 70；基础值天然超上限时按基础值保留。
  ensure(isSkillCreationWithinCap({ base: 70, occupation: 10, interest: 0, occupationMax: 80, interestMax: 70 }), "本职 70+10=80 应允许");
  ensure(isSkillCreationWithinCap({ base: 70, occupation: 11, interest: 0, occupationMax: 80, interestMax: 70 }) === false, "本职 70+11=81 应拒绝");
  ensure(isSkillCreationWithinCap({ base: 50, occupation: 0, interest: 20, occupationMax: 80, interestMax: 70 }), "兴趣 50+20=70 应允许");
  ensure(isSkillCreationWithinCap({ base: 50, occupation: 0, interest: 21, occupationMax: 80, interestMax: 70 }) === false, "兴趣 50+21=71 应拒绝");
  expectEqual(skillCreationCap({ base: 85, occupation: 0, interest: 0, occupationMax: 80, interestMax: 70 }), 85, "基础 85 的母语上限应至少为 85");
  ensure(isSkillCreationWithinCap({ base: 85, occupation: 0, interest: 0, occupationMax: 80, interestMax: 70 }), "高 EDU 母语不应因超过 70/80 报错");
  ensure(isSkillCreationWithinCap({ base: 85, occupation: 0, interest: 5, occupationMax: 80, interestMax: 70 }) === false, "母语基础 85 时不应再加兴趣点");
  expectEqual(skillCreationTotal({ base: 85, occupation: 0, interest: 0 }), 85, "总技能值计算");

  // 4. 加点规则：本职只能用职业点；非本职只能用兴趣点；同一技能不能混用。
  expectEqual(
    skillPointUsageIssue({ access: occupationSkillAccess(architect, "法律"), occupation: 0, interest: 10 }),
    "INTEREST_NOT_ALLOWED",
    "本职技能不能用兴趣点"
  );
  expectEqual(
    skillPointUsageIssue({ access: occupationSkillAccess(architect, "潜行"), occupation: 10, interest: 0 }),
    "OCCUPATION_NOT_ALLOWED",
    "非本职不能使用职业点"
  );
  expectEqual(
    skillPointUsageIssue({ access: occupationSkillAccess(magician, "潜行"), occupation: 10, interest: 10 }),
    "MIXED_POINTS",
    "同一技能不能同时用职业点和兴趣点"
  );
  expectEqual(
    skillPointUsageIssue({ access: occupationSkillAccess(magician, "潜行"), occupation: 10, interest: 0 }),
    null,
    "自选本职技能应允许职业点"
  );
  expectEqual(
    skillPointUsageIssue({ access: occupationSkillAccess(magician, "潜行"), occupation: 0, interest: 10 }),
    null,
    "未选为本职的技能应允许兴趣点"
  );

  // 5. 可选本职未选中时，分类上仍算兴趣。
  ensure(
    isActualOccupationSkill({ access: occupationSkillAccess(magician, "潜行"), occupation: 0 }) === false,
    "任意可选技能在未投入职业点前不应算本职"
  );
  ensure(
    isActualOccupationSkill({ access: occupationSkillAccess(magician, "潜行"), occupation: 10 }) === true,
    "任意可选技能投入职业点后应算本职"
  );
  ensure(
    isActualOccupationSkill({ access: occupationSkillAccess(architect, "法律"), occupation: 0 }) === true,
    "职业固定本职即使还没加点也应算本职"
  );
  ensure(
    isActualOccupationSkill({ access: occupationSkillAccess(magician, "精神分析"), occupation: 0 }) === true,
    "职业固定本职（魔术师·精神分析）应算本职"
  );

  // 4. 规则包默认上限为 80 / 70。
  const pack = resolveRulePack("coc7-baseline", builtinRegistry());
  const compiled = compileParsedRulePack(pack);
  const vars = { str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50 };
  const { evaluate } = await import("@touhou/formula");
  const occupationMax = Math.floor(evaluate(compiled.skillPoints.occupationMax, { vars, consts: pack.const }));
  const interestMax = Math.floor(evaluate(compiled.skillPoints.interestMax, { vars, consts: pack.const }));
  expectEqual(occupationMax, 80, "规则包本职上限默认应为 80");
  expectEqual(interestMax, 70, "规则包兴趣上限默认应为 70");

  console.log("PASS 车卡规则 E2E：本职判定 / 本职 80 / 兴趣 70 / 母语基础值 / 职业点与兴趣点互斥 / 可选本职默认算兴趣");
  console.log("  建筑师=潜行 NONE，魔术师=潜行 FREE，社交上限 " + magicianLimits.social + "，任意上限 " + magicianLimits.free);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
