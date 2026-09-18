/**
 * COC7 入门版修复回归：
 * - 固定属性数组（40/50/50/50/60/60/70/80）
 * - 八项本职 + 信用评级的固定九值分配（70/60/60/50/50/50/40/40/40）
 * - 信用评级 40 不再被职业范围 9~30 拒绝
 * - 创建时禁止克苏鲁神话
 */
import { builtinRegistry, compileParsedRulePack, resolveRulePack } from "@touhou/rules";
import { validateCharacterDraft } from "../src/server/character/draft";

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("入门版车卡断言失败：" + message);
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  const pack = resolveRulePack("coc7-baseline", builtinRegistry());
  const compiled = compileParsedRulePack(pack);
  const attributes = { str: 40, con: 50, siz: 50, dex: 50, app: 60, int: 60, pow: 70, edu: 80, luck: 50 };
  const values = {
    FIGHTING_BRAWL: 70,
    DODGE: 60,
    SPOT_HIDDEN: 60,
    LISTEN: 50,
    STEALTH: 50,
    LIBRARY_USE: 50,
    PSYCHOLOGY: 40,
    LANGUAGE_OWN: 40,
    CREDIT_RATING: 40
  };
  const input = {
    system: "COC7" as const,
    name: "苏珊",
    race: null,
    attributes,
    chargenMethod: "starter-quickstart",
    occupationId: null,
    skillAllocation: null,
    slotAssignments: null,
    starterSkills: { values, interests: ["DRIVE_AUTO", "CHARM", "HISTORY", "LAW"] },
    era: "MODERN" as const,
    age: 30,
    ageAllocation: null,
    enforceAttributeMethod: true,
    applyAgeAdjustment: true,
    ...overrides
  };
  const result = validateCharacterDraft(input, {
    pack,
    compiled,
    occupation: null,
    era: "MODERN",
    existing: null,
    canEditSkills: true
  });
  return { result, pack, compiled };
}

function expectOk(value: ReturnType<typeof makeDraft>["result"]): void {
  ensure(value.ok === true, "应通过校验，实际：" + (value.ok ? "" : value.error));
}

function expectError(value: ReturnType<typeof makeDraft>["result"], keyword: string): void {
  ensure(value.ok === false, "应按错误拒绝");
  if (value.ok === false) ensure(value.error.includes(keyword), "错误信息应包含：" + keyword + "，实际：" + value.error);
}

function main(): void {
  // 1. 书中苏珊示例：信用评级 40 必须可用。
  expectOk(makeDraft().result);

  // 2. 属性数组不符。
  expectError(
    makeDraft({ attributes: { str: 40, con: 50, siz: 50, dex: 50, app: 60, int: 60, pow: 70, edu: 70, luck: 50 } }).result,
    "八项属性"
  );

  // 3. 九值与规则书不一致。
  expectError(
    makeDraft({
      starterSkills: {
        values: {
          FIGHTING_BRAWL: 70, DODGE: 60, SPOT_HIDDEN: 60, LISTEN: 50,
          STEALTH: 50, LIBRARY_USE: 50, PSYCHOLOGY: 40, LANGUAGE_OWN: 40, CREDIT_RATING: 50
        },
        interests: ["DRIVE_AUTO", "CHARM", "HISTORY", "LAW"]
      }
    }).result,
    "九个数字"
  );

  // 4. 克苏鲁神话不能在创建时分配。
  expectError(
    makeDraft({
      starterSkills: {
        values: {
          FIGHTING_BRAWL: 70, DODGE: 60, SPOT_HIDDEN: 60, LISTEN: 50,
          STEALTH: 50, LIBRARY_USE: 50, PSYCHOLOGY: 40, CTHULHU_MYTHOS: 40, CREDIT_RATING: 40
        },
        interests: ["DRIVE_AUTO", "CHARM", "HISTORY", "LAW"]
      }
    }).result,
    "克苏鲁神话"
  );

  console.log("PASS 入门版车卡：固定数组、九值分配、信用评级、克苏鲁神话门槛");
}

main();
