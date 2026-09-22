import type { DshContextKind } from "@/shared/dsh-context";
import type { DshResolvedContext } from "@/server/dsh/context";
import { toSkillMeta, type DshSkillDefinition, type DshSkillMeta } from "./types";

const ALL_KINDS: readonly DshContextKind[] = [
  "MODULE",
  "ROOM",
  "CHARACTER",
  "COMBAT",
  "GAME",
  "CARD",
  "GLOBAL"
];

/**
 * 技能注册表。
 *
 * 只读技能在这里声明提示词模板；`module.edit` 是写入技能，实际执行在
 * `server/dsh/turn.ts` 里委托给已有的 `runModuleDshTurn`，避免这里引入 prisma。
 */
export const DSH_SKILLS: readonly DshSkillDefinition[] = [
  {
    id: "assistant.chat",
    title: "通用助手",
    description: "基于当前页面上下文回答问题；只读，不改数据。",
    effect: "READ",
    audience: "ALL",
    kinds: ALL_KINDS,
    isDefault: true,
    spec: {
      role: "你是「幽暗之门」东方 TRPG 平台的通用 ai 助手，常驻在页面右下角。",
      goal:
        "结合用户当前所在页面与可见资源，回答他关于平台用法、当前角色 / 房间 / 战斗 / 规则 / 团本的问题。" +
        "如果用户要求修改数据，说明当前是只读模式，并告诉他应该切换到哪个技能（例如团本页的「修改团本」）。",
      rules: [
        "优先结合 context.json 里的 page / resource / navigation 回答，不要问用户「你现在在哪个页面」。",
        "不知道就说不确定，并建议去哪个页面查看。"
      ],
      progressLabel: "ai 正在了解当前页面…"
    }
  },
  {
    id: "nav.guide",
    title: "页面导航",
    description: "告诉我「想做什么」，我告诉你点哪里，并给出直达链接。",
    effect: "READ",
    audience: "ALL",
    kinds: ALL_KINDS,
    spec: {
      role: "你是平台向导，专门帮玩家 / KP 找到操作入口。",
      goal:
        "根据 context.json 里的 navigation.siteMap 与 navigation.deepLinks，并结合用户当前页面，给出 1-3 步操作路径。" +
        "每个入口都要附上 Markdown 链接，例如「打开 [准备页](/rooms/xxx/prepare)」。",
      rules: [
        "只推荐 context.json 里确实存在的链接，不要凭记忆编造路径。",
        "如果站内确实没有对应入口，直接说明，并给出最接近的页面。",
        "回答控制在 5 行以内，先给结论链接，再补一句说明。"
      ],
      progressLabel: "ai 正在查找操作入口…"
    }
  },
  {
    id: "kp.rule",
    title: "规则速查",
    description: "查 CoC7 / 东方千幻抄规则与当前规则包数值。",
    effect: "READ",
    audience: "ALL",
    kinds: ["ROOM", "COMBAT", "MODULE", "CHARACTER", "GLOBAL"],
    spec: {
      role: "你熟悉《克苏鲁的呼唤 7th》与东方「千幻抄 DP」双模式规则的跑团裁判助手。",
      goal: "回答规则问题：判定方式、难度等级、战斗流程、DP 消耗、符卡 / 妖力 / 特技、常用表格等。",
      rules: [
        "优先引用 context.json 中房间 / 团本的 system 与规则信息；不确定的规则数值不要编造。",
        "涉及平台内的具体数值时，以 context.json 中该角色的 attributes / skills / vitals 为准。",
        "给出规则结论时，尽量用「判定技能 + 目标值 + 成功等级」这种可执行的形式。"
      ],
      progressLabel: "ai 正在查规则…"
    }
  },
  {
    id: "module.explain",
    title: "团本解读",
    description: "解释团本的章节、场景、NPC、线索、道具与节奏。",
    effect: "READ",
    audience: "ALL",
    kinds: ["MODULE"],
    spec: {
      role: "你是团本策划与带团助手，负责帮 KP / 作者读懂一本团本。",
      goal: "解释当前团本的结构与内容，指出节奏、线索闭合、NPC 动机、可能的坑与改进点。",
      rules: [
        "以 context.json 中 module.structured 的结构与名字为准；不要脑补未出现的剧情。",
        "可以按「章节 → 场景 → 遭遇」的顺序梳理，并标注哪一段适合放战斗 / 解谜。",
        "如果用户想直接改团本，提醒他切换到「修改团本」技能。"
      ],
      progressLabel: "ai 正在阅读团本…"
    }
  },
  {
    id: "combat.explain",
    title: "战斗解读",
    description: "解释当前战斗的轮次、双方状态、可选行动与规则后果。",
    effect: "READ",
    audience: "ALL",
    kinds: ["COMBAT"],
    spec: {
      role: "你是战斗裁判助手，负责帮玩家 / KP 看懂当前战斗局面。",
      goal: "解释当前轮次与阶段、双方存活单位与状态、轮到你时有哪些行动、每个行动的规则后果。",
      rules: [
        "只依据 context.json 中 combat.participants 与 combat.recentActions 分析。",
        "如果某单位数值显示为「？？」，说明它未公开 / 未识破，不要猜测具体数字。",
        "给出建议时按「当前行动者 → 可选行动 → 预期后果」组织。"
      ],
      progressLabel: "ai 正在分析战斗局面…"
    }
  },
  {
    id: "module.edit",
    title: "修改团本",
    description: "用自然语言修改团本正文与结构化数据；会写入并 +1 小版本。",
    effect: "WRITE",
    audience: "OWNER",
    kinds: ["MODULE"]
  }
];

export function allSkills(): readonly DshSkillDefinition[] {
  return DSH_SKILLS;
}

export function skillById(skillId: string): DshSkillDefinition | null {
  return DSH_SKILLS.find((skill) => skill.id === skillId) ?? null;
}

export function defaultSkillForContext(context: DshResolvedContext): DshSkillDefinition {
  const match = DSH_SKILLS.find((skill) => skill.isDefault === true && audienceAllowed(skill, context) && skill.kinds.includes(context.kind));
  return match ?? DSH_SKILLS[0]!;
}

function audienceAllowed(skill: DshSkillDefinition, context: DshResolvedContext): boolean {
  if (skill.audience === "ALL") return true;
  if (skill.audience === "OWNER") return context.canEditModule;
  if (skill.audience === "KP") return context.isKp || context.canEditModule;
  return false;
}

export function listSkillsForContext(context: DshResolvedContext): readonly DshSkillMeta[] {
  return DSH_SKILLS
    .filter((skill) => skill.kinds.includes(context.kind) && audienceAllowed(skill, context))
    .map(toSkillMeta);
}

export type DshSkillResolution =
  | { readonly ok: true; readonly skill: DshSkillDefinition }
  | { readonly ok: false; readonly error: string };

export function resolveSkillForContext(skillId: string | null | undefined, context: DshResolvedContext): DshSkillResolution {
  if (skillId === null || skillId === undefined || skillId.trim().length === 0) {
    return { ok: true, skill: defaultSkillForContext(context) };
  }
  const skill = skillById(skillId.trim());
  if (skill === null) return { ok: false, error: "未知的技能：" + skillId };
  if (skill.kinds.includes(context.kind) === false) {
    return { ok: false, error: "「" + skill.title + "」不能在当前页面使用" };
  }
  if (audienceAllowed(skill, context) === false) {
    return { ok: false, error: "你没有使用「" + skill.title + "」的权限" };
  }
  return { ok: true, skill };
}
