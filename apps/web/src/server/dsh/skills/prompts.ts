import type { DshHistoryMessage, DshSkillTask } from "@/server/dsh/types";
import type { DshSkillPromptInput, DshSkillSpec } from "./types";

const MAX_CONTEXT_CHARS = 120_000;

const COMMON_RULES = [
  "只允许读取当前工作目录下的 context.json 与 task.md；禁止访问网络、数据库、其它房间 / 团本。",
  "context.json 是本轮唯一事实来源。里面没有的信息就明确说「不确定」，禁止编造。",
  "你是只读助手：不要修改任何数据，不要试图执行写入操作。",
  "reply 只写结论与建议，不要包含思维链、推理过程或工具调用细节。",
  "用简体中文回答，简洁清晰，必要时用 Markdown 列表与链接。链接用 [文字](/路径) 形式。"
];

function historyBlock(history: readonly DshHistoryMessage[]): string {
  if (history.length === 0) return "（这是第一轮对话）";
  return history
    .slice(-12)
    .map((item) => (item.role === "user" ? "用户：" : "助手：") + item.content.slice(0, 2_000))
    .join("\n");
}

export function buildReadTask(input: DshSkillPromptInput & { readonly spec: DshSkillSpec }): DshSkillTask {
  const contextJson = JSON.stringify(input.context.pack, null, 2).slice(0, MAX_CONTEXT_CHARS);
  const rules = [...(input.spec.rules ?? []), ...COMMON_RULES];
  const task = [
    "# 角色",
    input.spec.role,
    "",
    "# 本轮目标",
    input.spec.goal,
    "",
    "# 数据来源",
    "- 当前目录的 context.json 描述了用户此刻所在的页面、可见资源与可跳转链接。",
    "- task.md（本文件）给出你的角色与输出要求。",
    "",
    "# 限制",
    ...rules.map((rule) => "- " + rule),
    "",
    "# 对话历史",
    historyBlock(input.history),
    "",
    "用户本次输入：" + input.message,
    "",
    "# 输出要求",
    "- 把给用户看的最终回答写入当前目录的 result.json。",
    '- result.json 结构：{ "reply": "中文 Markdown 回答" }。',
    "- 回答不要提及 context.json / result.json / task.md 这些内部文件名。",
    "- 如果用户的问题超出只读范围（例如要求改数值、改团本），在 reply 里说明当前技能不能写入，并告诉他应该切换到哪个技能或页面。"
  ].join("\n");

  return {
    task: "读取当前目录的 task.md，严格按照其中的要求执行，完成后只输出一句话结论。",
    files: {
      "context.json": contextJson,
      "task.md": task
    }
  };
}
