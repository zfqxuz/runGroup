/**
 * 统一角色草稿规则测试：车卡与角色管理共用 validateCharacterDraft。
 * 重点验证 KP 权限：不能改技能熟练度；可改属性；换职业按规则重置加点。
 */
import { builtinRegistry, compileParsedRulePack, resolveRulePack } from "@touhou/rules";
import { prisma } from "../src/server/db/prisma";
import { validateCharacterDraft } from "../src/server/character/draft";

function check(condition: boolean, label: string, detail?: unknown): void {
  if (condition) console.log("PASS " + label);
  else throw new Error("断言失败：" + label + (detail === undefined ? "" : " :: " + JSON.stringify(detail)));
}

async function main(): Promise<void> {
  const pack = resolveRulePack("coc7-baseline", builtinRegistry());
  const compiled = compileParsedRulePack(pack);
  const occupation = await prisma.occupation.findFirstOrThrow({ where: { system: "COC7", name: "牧师" } });
  const attributes = { str: 55, con: 55, siz: 35, dex: 35, app: 75, int: 50, pow: 60, edu: 60, luck: 75 };
  const baseInput = {
    system: "COC7" as const,
    name: "KP 测试",
    race: null,
    chargenMethod: "manual",
    occupationId: occupation.id,
    era: "CLASSIC" as const,
    age: 18,
    ageAllocation: null,
    enforceAttributeMethod: false,
    applyAgeAdjustment: false
  };
  const existing = {
    occupationId: occupation.id,
    attributes,
    skills: { CHARM: 70, DODGE: 47, HISTORY: 40, LIBRARY_USE: 45, PSYCHOLOGY: 55, CREDIT_RATING: 30 },
    skillAllocation: {
      occupation: { CHARM: 55, DODGE: 30, HISTORY: 35, LIBRARY_USE: 25, PSYCHOLOGY: 45, CREDIT_RATING: 30 },
      interest: {},
      slots: { "social-1": ["CHARM"], "free-2": ["DODGE", "FIGHTING_AXE"] }
    }
  };

  // 1. KP 改技能点：必须被忽略，沿用旧加点
  const kpChangedSkills = validateCharacterDraft(
    {
      ...baseInput,
      attributes,
      skillAllocation: { occupation: { CHARM: 5 }, interest: {} },
      slotAssignments: { "social-1": ["CHARM"], "free-2": ["DODGE", "FIGHTING_AXE"] }
    },
    { pack, compiled, occupation, era: "CLASSIC", existing, canEditSkills: false }
  );
  check(kpChangedSkills.ok === true, "KP 提交的技能点改动被接受但不生效");
  if (kpChangedSkills.ok) {
    check(kpChangedSkills.skills.CHARM === 70 && kpChangedSkills.skills.DODGE === 47, "KP 不能改技能熟练度，总值保持旧值");
  }

  // 2. KP 改基础属性：允许，基础值按规则重算
  const kpChangedAttrs = validateCharacterDraft(
    { ...baseInput, attributes: { ...attributes, dex: 55 }, skillAllocation: null, slotAssignments: null },
    { pack, compiled, occupation, era: "CLASSIC", existing, canEditSkills: false }
  );
  check(kpChangedAttrs.ok === true, "KP 可以改基础属性");
  if (kpChangedAttrs.ok) {
    check(kpChangedAttrs.attributes.dex === 55, "KP 属性改动生效");
    // DODGE 基础值 = dex/2：35 -> 17，55 -> 27；职业点 30 保留。
    check((kpChangedAttrs.skills.DODGE ?? 0) === 57, "KP 改属性后技能基础值按规则重算（闪避 27+30）", kpChangedAttrs.skills.DODGE);
    check((kpChangedAttrs.skills.CHARM ?? 0) === 70, "KP 改属性不影响已分配的职业点");
  }

  // 3. KP 换职业：按规则重置职业/兴趣点
  const second = await prisma.occupation.findFirstOrThrow({ where: { system: "COC7", name: "建筑师" } });
  const kpChangedOccupation = validateCharacterDraft(
    { ...baseInput, occupationId: second.id, attributes, skillAllocation: null, slotAssignments: null },
    { pack, compiled, occupation: second, era: "CLASSIC", existing, canEditSkills: false }
  );
  check(kpChangedOccupation.ok === true, "KP 可以换职业");
  if (kpChangedOccupation.ok) {
    const occ = kpChangedOccupation.skillAllocation?.occupation ?? {};
    const int = kpChangedOccupation.skillAllocation?.interest ?? {};
    const occIds = Object.keys(occ);
    check(int === undefined || Object.keys(int).length === 0, "换职业后兴趣点被按规则重置");
    check(occIds.every((id) => id === "CREDIT_RATING"), "换职业后旧职业点被重置，仅系统补信用评级下限", occ);
  }

  // 4. 本人兴趣点超池：必须被拦
  const overPool = validateCharacterDraft(
    {
      ...baseInput,
      attributes,
      skillAllocation: { occupation: {}, interest: { FIGHTING_BRAWL: 999 } },
      slotAssignments: { "social-1": ["CHARM"], "free-2": ["DODGE", "FIGHTING_AXE"] }
    },
    { pack, compiled, occupation, era: "CLASSIC", existing: null, canEditSkills: true }
  );
  check(overPool.ok === false && overPool.error.includes("兴趣点"), "本人兴趣点超池被拦");

  console.log("PASS 统一角色草稿规则：KP 不能改技能熟练度 / 可改属性 / 换职业重置 / 超池拦截");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  void prisma.$disconnect();
});
