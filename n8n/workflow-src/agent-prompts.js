/**
 * 多 Agent 提示词与角色定义（按内容类型路由版本）。
 *
 * 这个文件会被 build-workflows.mjs 内联进：
 * - 分类与分块（生成 route 标记）
 * - 各分支的「构建请求」Code 节点
 * - 各分支的「解析结果」Code 节点
 *
 * 重要：不要在 schema 示例里要求模型输出 id；id 统一由聚合节点根据实体名生成，
 * 避免多个分块都输出 npc1 / scene1 导致应用侧按 id 合并时串实体。
 */

const STANDARD_SECTIONS = [
  "元信息", "真相与背景", "剧情梗概", "开场钩子", "关键NPC", "地点与场景",
  "线索", "遭遇与战斗", "道具与手书", "怪物与神话生物", "结局分支",
  "奖励与成长", "KP备注", "附录"
];

function routeLabel(route) {
  const labels = {
    narrative: "剧情与场景",
    npc: "NPC 数值",
    handout: "线索与手书",
    setting: "设定与规则",
    image: "图片与地图",
    general: "综合提取",
    noop: "无需校验"
  };
  return labels[route] || String(route || "未知分支");
}

function sectionSchema() {
  const parts = [];
  for (const name of STANDARD_SECTIONS) parts.push("\"" + name + "\":\"...\"");
  return "{" + parts.join(",") + "}";
}

function imageSchemaHint() {
  return "{\"images\":[{\"filename\":\"与输入完全一致\",\"kind\":\"MAP / SCENE / HANDOUT / CLUE / NPC / ITEM / TEXT / OTHER\",\"transcription\":\"图中可见文字逐字抄录，最多 2000 字\",\"description\":\"客观描述画面，不要脑补\",\"section\":\"标准章节名\",\"sectionText\":\"可直接写入章节的中文正文，最多 1200 字\",\"scene\":null,\"clue\":null,\"npc\":null,\"item\":null}]}";
}

function npcSchema() {
  return "{\"id\":\"不要输出 id\",\"name\":\"NPC 名\",\"tier\":\"MINION / STANDARD / ELITE / BOSS\",\"rarity\":\"COMMON\",\"race\":null,\"tags\":[],\"description\":\"...\",\"portrait\":\"\",\"statText\":\"原文属性行 / 数值块逐字复制\",\"attributes\":{\"str\":50,\"con\":50,\"siz\":50,\"dex\":50,\"app\":50,\"int\":50,\"pow\":50,\"edu\":50,\"luck\":50},\"db\":\"1d4\",\"build\":1,\"move\":8,\"skills\":[{\"skill_name\":\"...\",\"value\":40}],\"weapons\":[{\"weapon_name\":\"...\",\"damage\":\"1d6\",\"range\":\"MELEE\"}],\"maxHp\":12,\"maxMp\":10,\"maxSan\":50,\"maxDp\":0}";
}

function schemaHintForRoute(route) {
  if (route === "narrative") {
    return [
      "{\"meta\":{\"title\":\"...\",\"summary\":\"...\",\"background\":\"...\",\"occupationRecommendation\":\"...\"},",
      "\"sections\":" + sectionSchema() + ",",
      "\"structured\":{",
      "\"chapters\":[{\"name\":\"章节名\",\"summary\":\"...\"}],",
      "\"scenes\":[{\"name\":\"场景名\",\"description\":\"...\",\"width\":1600,\"height\":1000,\"gridType\":\"SQUARE\",\"bgColor\":\"#1a1a2e\",\"background\":\"\"}],",
      "\"clues\":[{\"title\":\"线索名\",\"content\":\"...\",\"discoveryMethod\":\"...\",\"relatedNpc\":\"\",\"relatedPc\":\"\",\"linkedItemName\":\"\"}],",
      "\"encounters\":[{\"name\":\"遭遇名\",\"sceneName\":\"场景名或留空\",\"chapterName\":\"章节名或留空\",\"trigger\":\"...\",\"setup\":{}}]",
      "}}"
    ].join("");
  }
  if (route === "npc") {
    return "{\"structured\":{\"npcs\":[" + npcSchema() + "]}}";
  }
  if (route === "handout") {
    return [
      "{\"meta\":{\"title\":\"...\",\"summary\":\"...\",\"background\":\"...\",\"occupationRecommendation\":\"\"},",
      "\"sections\":" + sectionSchema() + ",",
      "\"structured\":{",
      "\"scenes\":[{\"name\":\"场景名\",\"description\":\"...\",\"width\":1600,\"height\":1000,\"gridType\":\"SQUARE\",\"bgColor\":\"#1a1a2e\",\"background\":\"\"}],",
      "\"clues\":[{\"title\":\"线索名\",\"content\":\"...\",\"discoveryMethod\":\"...\",\"relatedNpc\":\"\",\"relatedPc\":\"\",\"linkedItemName\":\"\"}],",
      "\"items\":[{\"name\":\"道具名\",\"itemType\":\"WEAPON / ITEM / TOME / ARTIFACT / EVIDENCE\",\"description\":\"...\",\"rarity\":\"COMMON\",\"image\":\"\",\"quantity\":1,\"damage\":\"\",\"range\":\"\",\"skillName\":\"\",\"accuracyMod\":0}],",
      "\"magic\":[{\"name\":\"法术名\",\"skill\":\"MAGIC / OCCULT\",\"mpCost\":\"3\",\"sanCost\":\"1d3\",\"damage\":\"1d6\",\"target\":\"ONE\",\"targeting\":\"ENEMY\",\"effects\":[],\"description\":\"...\"}]",
      "}}"
    ].join("");
  }
  if (route === "setting") {
    return [
      "{\"meta\":{\"title\":\"...\",\"summary\":\"...\",\"background\":\"...\",\"occupationRecommendation\":\"\"},",
      "\"sections\":" + sectionSchema() + ",",
      "\"structured\":{",
      "\"chapters\":[{\"name\":\"章节名\",\"summary\":\"...\"}],",
      "\"scenes\":[{\"name\":\"场景名\",\"description\":\"...\",\"width\":1600,\"height\":1000,\"gridType\":\"SQUARE\",\"bgColor\":\"#1a1a2e\",\"background\":\"\"}],",
      "\"npcs\":[" + npcSchema() + "],",
      "\"clues\":[{\"title\":\"线索名\",\"content\":\"...\",\"discoveryMethod\":\"...\",\"relatedNpc\":\"\",\"relatedPc\":\"\",\"linkedItemName\":\"\"}],",
      "\"items\":[{\"name\":\"道具名\",\"itemType\":\"ITEM\",\"description\":\"...\",\"rarity\":\"COMMON\",\"image\":\"\",\"quantity\":1}],",
      "\"magic\":[{\"name\":\"法术名\",\"skill\":\"MAGIC\",\"mpCost\":\"\",\"sanCost\":\"\",\"damage\":\"\",\"target\":\"ONE\",\"targeting\":\"ENEMY\",\"effects\":[],\"description\":\"...\"}],",
      "\"endings\":[{\"name\":\"结局名\",\"condition\":\"...\",\"description\":\"...\"}],",
      "\"rewards\":[{\"name\":\"奖励名\",\"description\":\"...\"}]",
      "}}"
    ].join("");
  }
  if (route === "image") return imageSchemaHint();
  // general
  return [
    "{\"meta\":{\"title\":\"...\",\"summary\":\"...\",\"background\":\"...\",\"occupationRecommendation\":\"\"},",
    "\"sections\":" + sectionSchema() + ",",
    "\"structured\":{",
    "\"chapters\":[{\"name\":\"章节名\",\"summary\":\"...\"}],",
    "\"scenes\":[{\"name\":\"场景名\",\"description\":\"...\"}],",
    "\"encounters\":[{\"name\":\"遭遇名\",\"sceneName\":\"\",\"chapterName\":\"\",\"trigger\":\"...\",\"setup\":{}}],",
    "\"npcs\":[" + npcSchema() + "],",
    "\"clues\":[{\"title\":\"线索名\",\"content\":\"...\",\"discoveryMethod\":\"...\",\"linkedItemName\":\"\"}],",
    "\"items\":[{\"name\":\"道具名\",\"itemType\":\"ITEM\",\"description\":\"...\"}],",
    "\"magic\":[{\"name\":\"法术名\",\"skill\":\"MAGIC\",\"description\":\"...\"}],",
    "\"endings\":[{\"name\":\"结局名\",\"condition\":\"...\",\"description\":\"...\"}],",
    "\"rewards\":[{\"name\":\"奖励名\",\"description\":\"...\"}]",
    "}}"
  ].join("");
}

function agentSystemPrompt(route, hints, opts) {
  const lines = [];
  lines.push("你是严谨的中文 TRPG 团本解析 Agent，当前分支身份：" + routeLabel(route) + "。");
  lines.push("目标系统：" + hints.system + "；年代：" + hints.era + "。");
  if (opts && opts.retry) lines.push("本次是上一次截断或失败后的压缩重试调用。");
  lines.push("只依据用户消息中的素材片段输出严格 JSON；不要续写、不要解释、不要输出思维过程或 markdown。");
  lines.push("输出必须是单个合法 JSON 对象，并且必须完整闭合。");
  return lines.join("\n");
}

function agentCommonRequirements(route, hints, opts) {
  const lines = [];
  lines.push("当前分支只负责：" + routeLabel(route) + "。不要输出本分支之外的结构。");
  lines.push("只处理下面这一小段素材，不要参考其他段落或历史任务。");
  if (hints.instructions && String(hints.instructions).trim().length > 0) {
    lines.push("用户额外要求：" + String(hints.instructions).trim().slice(0, 2000));
  }
  lines.push("没有在原文明确定出现的字段直接省略；禁止编造、禁止用示例值补全。");
  lines.push("标题、编号、专有名词、数字、判定值必须与原文完全一致；NPC 数值必须逐字保留在 statText。");
  lines.push("禁止输出 id 字段；id 由系统根据名称自动生成。sceneId / chapterId / linkedItemId 等引用字段请填对应名称，不要填机器 id。");
  lines.push("只输出一个合法 JSON 对象，不要 markdown 代码围栏，不要解释；JSON 必须完整闭合。");
  lines.push("尽量短：sections 只写一句话摘要，structured 每个数组最多 8 条，description 压缩到一句话。");
  if (opts && opts.retry) {
    lines.push("这是截断/失败后的重试，请进一步压缩：只保留最重要的 1-3 条记录，总长度控制在 800 个中文字符以内，并务必闭合 JSON。");
  }
  return lines;
}

function agentUserPrompt(route, chunk, hints, opts) {
  const lines = agentCommonRequirements(route, hints, opts);
  lines.push("来源：" + String(chunk.filename || "素材") + "，本文件第 " + String(chunk.fileIndex || 1) + "/" + String(chunk.fileTotal || 1) + " 段" + (chunk.heading ? "，最近标题：" + chunk.heading : ""));
  if (opts && opts.splitIndex !== undefined && opts.splitTotal !== undefined) {
    lines.push("这是原失败片段的第 " + String(opts.splitIndex + 1) + "/" + String(opts.splitTotal) + " 部分，只提取本部分内容。");
  }
  lines.push("只允许输出以下结构（示例值只是格式说明，不是素材内容；不要输出 id 字段）：");
  lines.push(schemaHintForRoute(route));
  lines.push("");
  lines.push("本段原文：");
  lines.push(String(chunk.text || ""));
  return lines.join("\n");
}

function buildAgentMessages(route, chunk, hints, opts) {
  return [
    { role: "system", content: agentSystemPrompt(route, hints, opts) },
    { role: "user", content: agentUserPrompt(route, chunk, hints, opts) }
  ];
}

function buildVisionMessages(batch, hints) {
  const lines = [];
  lines.push("你是图片视觉分析 Agent（分支身份：" + routeLabel("image") + "）。");
  lines.push("目标系统：" + hints.system + "；年代：" + hints.era + "。");
  lines.push("请逐张分析下面的图片素材，并把结果整理成单个合法 JSON 对象：{\"images\":[...]}。");
  lines.push("每张图片必须返回一条 images 记录，filename 与输入完全一致。");
  lines.push("kind 只能是 MAP / SCENE / HANDOUT / CLUE / NPC / ITEM / TEXT / OTHER 之一。");
  lines.push("transcription 逐字抄录图中可见文字（最多 2000 字）；description 只客观描述画面，不要脑补。");
  lines.push("section 选一个标准章节；sectionText 可直接写进该章节的中文正文，最多 1200 字。");
  lines.push("如果是地图尽量给出 scene；是手书/文件给 clue；是人物立绘给 npc；是物品给 item；否则对应字段返回 null。");
  lines.push("只返回单个合法 JSON 对象，不要解释、不要 markdown 代码围栏，数组最多 " + String(batch.length) + " 条。");
  lines.push("");
  lines.push("图片清单：");
  for (const image of batch) {
    lines.push("- filename：" + String(image.filename || "") + "；引用路径：" + String(image.relativePath || ""));
    if (image.pageNumber !== undefined && image.pageNumber !== null) {
      lines.push("  来源：PDF 第 " + String(image.pageNumber) + " 页" + (image.origin === "PAGE_RENDER" ? "（整页渲染）" : "（内嵌图）"));
    }
    if (image.pageText !== undefined && String(image.pageText).trim().length > 0) {
      lines.push("  同页文字（可能不完整）：" + String(image.pageText).trim().slice(0, 1200));
    }
  }
  const userContent = [{ type: "text", text: lines.join("\n") }];
  for (const image of batch) {
    if (image && typeof image.dataUrl === "string" && image.dataUrl.length > 0) {
      userContent.push({ type: "image_url", image_url: { url: image.dataUrl } });
    }
  }
  return [
    { role: "system", content: "你是 TRPG 素材视觉分析助手。每次调用都是独立任务，只依据当前图片与随图文字输出严格 JSON；看不清或不确定的内容必须如实说明，不得脑补。" },
    { role: "user", content: userContent }
  ];
}

function validatorSystemPrompt() {
  return [
    "你是严格的 JSON 格式校验与修复 Agent。",
    "你的唯一职责是把用户提供的模型原始输出修复为单个合法 JSON 对象。",
    "禁止新增、删除或编造事实；只允许调整格式、补齐括号、去掉解释文字、合并重复顶层对象、丢弃不完整字段。",
    "输出必须是可直接 JSON.parse 的单个对象，不要 markdown，不要解释。",
    "不要输出 id 字段；id 由系统根据名称自动生成。"
  ].join("");
}

function validatorUserPrompt(rawContent, route, label) {
  const lines = [];
  lines.push("来源标签：" + String(label || "未命名"));
  lines.push("原始分支：" + routeLabel(route));
  lines.push("期望字段形状（只作为校验参考，不要照抄示例值）：");
  lines.push(schemaHintForRoute(route));
  lines.push("要求：");
  lines.push("1) 如果原文里有多个 JSON 对象，选择字段最完整的一个，不要拼接无关内容。");
  lines.push("2) 如果 JSON 被截断，只保留已经完整闭合的字段，丢弃未完成部分，输出合法 JSON。");
  lines.push("3) 如果原文夹杂解释文字，删除解释文字，只保留 JSON。");
  lines.push("4) 不要新增原文没有的事实，不要输出 id。");
  lines.push("");
  lines.push("原始输出：");
  lines.push(String(rawContent || ""));
  return lines.join("\n");
}

function buildValidatorMessages(rawContent, route, label) {
  return [
    { role: "system", content: validatorSystemPrompt() },
    { role: "user", content: validatorUserPrompt(rawContent, route, label) }
  ];
}
