/**
 * NPC 数值读取 + 去重回归验证（纯函数，不访问数据库 / DeepSeek）。
 * 运行：npm run verify:npc-extract --workspace @touhou/web
 */
import { dedupeNpcRecords, npcRecordsLikelySame } from "@/server/ai/npc-dedupe";
import { enrichNpcStatsFromSources, parseNpcStatsText } from "@/server/ai/npc-stats";

let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log("PASS " + label);
  } else {
    failed += 1;
    console.error("FAIL " + label);
  }
}

const inline = parseNpcStatsText("STR 60 CON 70 SIZ 65 DEX 50 APP 45 INT 80 POW 75 EDU 90 LUCK 55 HP 13 MP 15 SAN 80");
check(inline.matchedAttributes === 9, "读取英文一行属性");
check(inline.attributes.str === 60 && inline.attributes.edu === 90, "英文属性值正确");
check(inline.maxHp === 13 && inline.maxMp === 15 && inline.maxSan === 80, "读取 HP / MP / SAN");

const chinese = parseNpcStatsText("力量为60，体质是70，体型65，敏捷为50，外貌45，智力为80，意志70，教育90，幸运55；HP 12 MP 14 SAN 70");
check(chinese.matchedAttributes === 9, "读取中文属性（含 为 / 是 / 逗号）");
check(chinese.attributes.pow === 70 && chinese.maxSan === 70, "中文属性值与 SAN 正确");

const aligned = parseNpcStatsText("STR CON SIZ DEX APP INT POW EDU\n50 60 65 70 55 80 70 75");
check(aligned.matchedAttributes === 8 && aligned.attributes.edu === 75, "读取标签行 + 数值行表格");

const dice = parseNpcStatsText("STR 3d6 CON 70 SIZ 65 DEX 50");
check(dice.attributes.str === undefined, "不会把 3d6 误读成属性 3");
check(dice.attributes.con === 70, "同一行其他属性仍可读取");

const redMist = { id: "a", name: "博丽灵梦", description: "短", attributes: { str: 40 } };
const redMistShort = { id: "b", name: "灵梦", description: "更完整的描述", attributes: { con: 50 }, skills: { DODGE: 50 } };
check(npcRecordsLikelySame(redMist, redMistShort), "全名 / 简称判定为同一角色");
const smallDemon = { id: "c", name: "小恶魔" };
const demon = { id: "d", name: "恶魔" };
check(npcRecordsLikelySame(smallDemon, demon) === false, "通用名词不会误合并（小恶魔 / 恶魔）");

const deduped = dedupeNpcRecords([redMist, redMistShort, smallDemon, demon]);
check(deduped.length === 3, "重复 NPC 合并");
type CheckRecord = { name?: unknown; description?: unknown; attributes?: Record<string, unknown> };
const merged = deduped.find((item) => typeof item.name === "string" && item.name.includes("灵梦")) as CheckRecord | undefined;
check(merged?.attributes?.str === 40 && merged?.attributes?.con === 50 && merged?.description === "更完整的描述", "合并后属性 / 描述不丢失");

const entries: Record<string, unknown>[] = [{ name: "测试角色", description: "..." }];
const fixed = enrichNpcStatsFromSources(entries, [
  { filename: "story.md", text: "测试角色\nSTR 60 CON 70 SIZ 65 DEX 50 APP 45 INT 80 POW 75 EDU 90 LUCK 55\nHP 13 MP 15 SAN 80" }
]);
const baseStats = entries[0]?.attributes as Record<string, unknown> | undefined;
check(fixed === 1, "按角色名从原文回填数值");
check(baseStats?.str === 60 && entries[0]?.maxHp === 13, "回填属性与 HP 正确");

if (failed > 0) {
  console.error("verify-npc-extract: " + String(failed) + " failure(s)");
  process.exitCode = 1;
} else {
  console.log("verify-npc-extract: all checks passed");
}
