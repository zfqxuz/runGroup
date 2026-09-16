/**
 * NPC 技能 / 武器持久化回归：
 * n8n 结构化数组 -> NpcTemplate 归一化 -> NPC Card.stats.weapons -> 战斗攻击选项。
 *
 * 运行：npm run verify:npc-weapons --workspace @touhou/web
 */
import { builtinRegistry, compileRulePack, resolveRulePack } from "@touhou/rules";
import { normalizedSkills, normalizedWeapons } from "@/server/modules/templates";
import { attackOptionsForParticipant, npcWeaponsFromStats } from "@/server/combat/options";

let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) console.log("PASS " + label);
  else {
    failed += 1;
    console.error("FAIL " + label);
  }
}

const pack = compileRulePack(resolveRulePack("coc7-baseline", builtinRegistry()));
const warnings: string[] = [];

const skills = normalizedSkills(
  [
    { skill_name: "斗殴", value: 60 },
    { skill_name: "战斗", value: 50 },
    { skill_name: "闪避", value: 40 },
    { skill_name: "潜行", value: 45 }
  ],
  pack,
  warnings,
  "测试 NPC"
);
check(skills.FIGHTING_BRAWL === 60, "数组格式技能映射到 FIGHTING_BRAWL");
check(skills.FIGHTING_BRAWL === 60, "战斗 / 斗殴别名映射到 FIGHTING_BRAWL");
check(skills.DODGE === 40, "数组格式技能映射到 DODGE");
check(skills.STEALTH === 45, "数组格式技能映射到 STEALTH");

const weapons = normalizedWeapons(
  [
    { weapon_name: "测试长枪", damage: "1d10", range: "MELEE" },
    { name: "徒手攻击", damage: "1d3+1d4", range: "近战", skillId: "斗殴" }
  ],
  pack,
  warnings,
  "测试 NPC"
);
check(weapons.length === 2, "武器数组被保留");
check(weapons[0]?.name === "测试长枪" && weapons[0]?.damage === "1d10" && weapons[0]?.range === "MELEE", "武器名称 / 伤害 / 距离正确");
check(weapons[1]?.skillId === "FIGHTING_BRAWL", "武器技能名映射到规则包技能 id");

const fromStats = npcWeaponsFromStats({ weapons });
check(fromStats.length === 2 && fromStats[0]?.name === "测试长枪", "NPC 卡 stats.weapons 可读回武器");
const options = attackOptionsForParticipant(
  pack,
  { id: "npc-test", kind: "NPC", characterId: null, skills: { FIGHTING_BRAWL: 60 } },
  fromStats
);
check(
  options.some((option) => option.weaponName === "测试长枪" && option.damage === "1d10"),
  "NPC 武器进入战斗攻击选项"
);
check(
  options.some((option) => option.skillId === "FIGHTING_BRAWL" && option.source === "WEAPON"),
  "NPC 攻击选项保留武器技能与 WEAPON 来源"
);

if (failed > 0) {
  console.error("verify-npc-weapons: " + String(failed) + " failure(s)");
  process.exitCode = 1;
} else {
  console.log("verify-npc-weapons: all checks passed");
}
