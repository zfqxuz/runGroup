const rawInput = (items && items[0] && items[0].json) ? items[0].json : {};
const input = (rawInput && rawInput.body && typeof rawInput.body === "object") ? rawInput.body : rawInput;
const env = (typeof $env === "object" && $env !== null) ? $env : {};
const deepseekBaseUrl = String((env.DEEPSEEK_BASE_URL || "https://api.deepseek.com")).replace(/\/+$/, "");
const model = String(input.model || env.DEEPSEEK_MODEL || "deepseek-flash").trim() || "deepseek-flash";
const visionModel = String(input.visionModel || model).trim() || model;
const hints = {
  system: input.system === "TOUHOU" ? "TOUHOU" : "COC7",
  era: String(input.era || "MODERN"),
  instructions: String(input.instructions || "")
};
const chunks = Array.isArray(input.chunks) ? input.chunks : [];
const images = Array.isArray(input.images) ? input.images : [];
const requests = [];

function structuredSchemaHint() {
  return [
    "structured 可用字段（只输出本段中出现的，没有就省略）。注意：下面的值只是字段格式示例，禁止把示例值当成素材内容照抄；未知字段一律省略。",
    '{"chapters":[{"id":"ch1","name":"章节名","summary":"..."}],',
    '"scenes":[{"id":"scene1","name":"场景名","description":"...","width":1600,"height":1000,"gridType":"SQUARE 或 HEX","bgColor":"#1a1a2e","background":"assets/images/xxx.png 或留空"}],',
    '"encounters":[{"id":"enc1","name":"遭遇名","sceneId":"scene1","sceneName":"场景名","chapterId":"ch1","chapterName":"章节名","trigger":"...","setup":{}}],',
    '"npcs":[{"id":"npc1","name":"NPC 名","tier":"MINION 或 STANDARD 或 ELITE 或 BOSS","rarity":"COMMON","race":null,"tags":[],"description":"...","portrait":"assets/images/xxx.png 或留空","statText":"原文中的属性行 / 数值块，逐字复制，例如 STR 50 CON 60 SIZ 65 DEX 70 APP 55 INT 80 POW 70 EDU 75 HP 12 MP 14 SAN 70；没有就省略","attributes":{"str":50,"con":50,"siz":50,"dex":50,"app":50,"int":50,"pow":50,"edu":50,"luck":50},"skills":{"DODGE":40},"maxHp":12,"maxMp":10,"maxSan":50,"maxDp":0}],',
    '"clues":[{"id":"clue1","title":"线索名","content":"线索正文","image":"assets/clues/xxx.png 或留空","isPublic":false,"linkedItemId":"item1 或留空"}],',
    '"items":[{"id":"item1","name":"道具名","itemType":"WEAPON 或 ITEM 或 TOME 或 ARTIFACT 或 EVIDENCE","description":"...","rarity":"COMMON","image":"assets/images/xxx.png 或留空","quantity":1,"damage":"1d6 或留空","range":"MELEE 或 NEAR 或 FAR 或留空","skillId":"FIGHTING_BRAWL 等或留空","accuracyMod":0}],',
    '"endings":[{"id":"end1","name":"结局名","condition":"...","description":"..."}],',
    '"rewards":[{"id":"reward1","name":"奖励名","description":"..."}],',
    '"magic":[{"id":"spell1","name":"法术名","skill":"MAGIC 或 OCCULT","mpCost":"3","sanCost":"1d3","damage":"1d6","target":"ONE","targeting":"ENEMY","effects":[{"type":"DAMAGE","amount":"1d6"}],"description":"..."}]}'
  ].join("\n");
}

function chunkExtractionPrompt(chunk) {
  const lines = [];
  lines.push("请从下面这一小段团本素材中做“分块提取”。只处理这一段，不要参考其他段落或历史任务。");
  lines.push("目标系统：" + hints.system + "；年代：" + hints.era + "。");
  if (hints.instructions.trim().length > 0) lines.push("用户额外要求：" + hints.instructions.trim().slice(0, 2000));
  lines.push("来源：" + chunk.filename + "，本文件第 " + String(chunk.fileIndex) + "/" + String(chunk.fileTotal) + " 段" + (chunk.heading.length === 0 ? "" : "，最近标题：" + chunk.heading));
  lines.push("要求：");
  lines.push("- 只提取本段明确出现的事实、剧情、NPC、场景、线索、道具、法术；没有的字段直接省略，不要编造，也不要输出其他段落的内容。");
  lines.push("- 如果本段出现大量乱码、替换字符或明显编码损坏，不要猜测原文内容；meta.title 填来源文件名，sections 只写一条「本段原文不可读，未生成结构化数据」说明，structured 留空。");
  lines.push("- JSON 示例里的 50、1d6、场景名、NPC 名等都只是格式示例，不是素材内容；任何字段没有在原文中明确出现就不要输出，禁止用默认值 / 猜测值补全。");
  lines.push("- NPC 的属性、技能、HP / MP / SAN 等数值只有原文明确给出时才输出对应字段；原文没写就省略，系统会按规则包处理，不要自行编数值。");
  lines.push("- NPC 如果原文有属性行 / 数值块（STR 50、力量 60、HP 12、MP 14、SAN 70 等），必须把该行原样放进 statText，同时尽量拆进 attributes / maxHp / maxMp / maxSan；数字必须与原文完全一致。");
  lines.push("- 原文中的标题、编号 / 标记、专有名词、NPC / 场景 / 道具 / 技能 / 法术名、数字与判定值必须原样保留；压缩时只能压缩形容词，不能删除任何条目。");
  lines.push("- 叙事 / 设定按语义归入 sections 中最贴切的标准章节；实在无法归类就放入 附录。只要本段有正文，就至少输出一个 sections 字段，并尽量保留所有小节标题。");
  lines.push("- 结构化实体放入 structured；字段 id 用 slug，同一实体在不同段落请用同名 / 同 id，方便合并。");
  lines.push("- 输出必须是单个合法 JSON 对象，不要 markdown 代码围栏，不要解释。");
  lines.push("- 总长度控制在 4000 个中文字符以内，JSON 必须完整闭合。");
  lines.push("JSON 结构：");
  lines.push('{"meta":{"title":"...","summary":"...","background":"...","occupationRecommendation":"..."},');
  lines.push('"sections":{"元信息":"...","真相与背景":"...","剧情梗概":"...","开场钩子":"...","关键NPC":"...","地点与场景":"...","线索":"...","遭遇与战斗":"...","道具与手书":"...","怪物与神话生物":"...","结局分支":"...","奖励与成长":"...","KP备注":"...","附录":"..."},');
  lines.push('"structured":{...}}');
  lines.push(structuredSchemaHint());
  lines.push("");
  lines.push("本段原文：");
  lines.push(String(chunk.text || ""));
  return lines.join("\n");
}

function imageAnalysisPrompt(batch) {
  const lines = [];
  lines.push("请逐张分析下面的图片素材，并把结果整理成 JSON。");
  lines.push("目标系统：" + hints.system + "；年代：" + hints.era + "。");
  lines.push("要求：");
  lines.push("- 每张图片必须返回一条 images 记录，filename 与输入完全一致。");
  lines.push("- kind 只能是 MAP / SCENE / HANDOUT / CLUE / NPC / ITEM / TEXT / OTHER 之一。");
  lines.push("- transcription：逐字抄录图中可见文字（保留原文，可附中文翻译）；最多 2000 字。");
  lines.push("- description：客观描述画面内容、人物、地图结构、房间 / 地点标记，不要脑补素材中不存在的设定。");
  lines.push("- section：选一个最贴切的标准章节；sectionText：可直接写进该章节的中文正文（最多 1200 字）。");
  lines.push("- 如果图片是地图，尽量给出 scene（name / description / width / height / gridType）；是手书 / 文件就给 clue；是人物立绘就给 npc；是物品就给 item；否则对应字段返回 null。");
  lines.push("- 只返回单个合法 JSON 对象，不要解释、不要 markdown 代码围栏。");
  lines.push('JSON 结构：{"images":[{"filename":"...","kind":"MAP","transcription":"...","description":"...","section":"地点与场景","sectionText":"...","scene":{"id":"scene1","name":"...","description":"...","width":1600,"height":1000,"gridType":"SQUARE"},"clue":null,"npc":null,"item":null}]}');
  lines.push("");
  lines.push("图片清单：");
  for (const image of batch) {
    lines.push("- filename：" + image.filename + "；引用路径：" + image.relativePath);
    if (image.pageNumber !== undefined && image.pageNumber !== null) {
      lines.push("  来源：PDF 第 " + String(image.pageNumber) + " 页" + (image.origin === "PAGE_RENDER" ? "（整页渲染）" : "（内嵌图）"));
    }
    if (image.pageText !== undefined && String(image.pageText).trim().length > 0) {
      lines.push("  同页文字（可能不完整）：" + String(image.pageText).trim().slice(0, 1200));
    }
  }
  return lines.join("\n");
}

for (const chunk of chunks) {
  if (!chunk || String(chunk.text || "").trim().length === 0) continue;
  requests.push({
    json: {
      url: deepseekBaseUrl + "/chat/completions",
      body: {
        model,
        temperature: 0.15,
        max_tokens: 8192,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是严谨的中文 TRPG 团本编辑。当前任务是分块提取素材，每次调用都是完全独立的导入任务，不继承任何历史上下文；只依据本次用户消息中的素材片段输出严格 JSON，不要续写、不要解释。" },
          { role: "user", content: chunkExtractionPrompt(chunk) }
        ]
      }
    }
  });
}

const batchSize = 2;
for (let offset = 0; offset < images.length; offset += batchSize) {
  const batch = images.slice(offset, offset + batchSize);
  const content = [{ type: "text", text: imageAnalysisPrompt(batch) }];
  for (const image of batch) content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  requests.push({
    json: {
      url: deepseekBaseUrl + "/chat/completions",
      body: {
        model: visionModel,
        temperature: 0.1,
        max_tokens: 8192,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是 TRPG 素材视觉分析助手。每次调用都是独立任务，只依据当前图片与随图文字输出严格 JSON；看不清或不确定的内容必须如实说明，不得脑补。" },
          { role: "user", content }
        ]
      }
    }
  });
}

return requests;
