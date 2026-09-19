/**
 * n8n 团本解析工作流：内容分类与分块。
 *
 * 这个节点只负责：
 * - 读取 webhook 输入；
 * - 按文件内容特征判断文档类型；
 * - 按场景边界切分为小段；
 * - 为每个分块决定 1-2 个内容分支（route）；
 * - 输出 route 标记，交给 Switch 选择器分流。
 *
 * 最终请求体由各分支的「构建请求」节点生成，这里不调用模型。
 */

const rawInput = (items && items[0] && items[0].json) ? items[0].json : {};
const input = (rawInput && rawInput.body && typeof rawInput.body === "object") ? rawInput.body : rawInput;
const env = (typeof $env === "object" && $env !== null) ? $env : {};
const deepseekBaseUrl = String((env.DEEPSEEK_BASE_URL || "https://api.deepseek.com")).replace(/\/+$/, "");
const model = String(input.model || env.DEEPSEEK_MODEL || "deepseek-flash").trim() || "deepseek-flash";
const visionModel = String(input.visionModel || model).trim() || model;
const configuredMaxTokens = Number(env.DEEPSEEK_MAX_TOKENS || 8192);
const maxTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0 ? Math.floor(configuredMaxTokens) : 8192;
const hints = {
  system: input.system === "TOUHOU" ? "TOUHOU" : "COC7",
  era: String(input.era || "MODERN"),
  instructions: String(input.instructions || "")
};
const context = { model, visionModel, maxTokens, deepseekBaseUrl, hints };
const sources = Array.isArray(input.sources) && input.sources.length > 0
  ? input.sources
  : (Array.isArray(input.chunks) ? input.chunks.map((chunk) => ({ filename: chunk.filename, text: chunk.text })) : []);
const images = Array.isArray(input.images) ? input.images : [];
const output = [];

function extensionOf(filename) {
  const match = /[.]([a-z0-9]+)$/i.exec(String(filename || ""));
  return match && match[1] ? match[1].toLowerCase() : "";
}

function contentScores(text) {
  const value = String(text || "");
  const statHits = (value.match(/(?:STR|CON|SIZ|DEX|APP|INT|POW|EDU|LUCK|HP|MP|SAN|DP|DB|Build|Move|力量|体质|体型|敏捷|外貌|智力|意志|教育|幸运|生命值|魔法值|理智值|耐久|伤害加值|体格|移动)/gi) || []).length;
  const narrativeHits = (value.match(/(场景|章节|第\s*[一二三四五六七八九十百0-9]+\s*[章幕节]|调查员|剧情|背景|遭遇|钩子|结局)/g) || []).length;
  const clueHits = (value.match(/(线索|手书|笔记|日记|信件|记录|档案|资料|证物)/g) || []).length;
  const itemMagicHits = (value.match(/(道具|物品|法术|魔法|咒文|魔导书|仪式|武器|装备|宝物|神器)/g) || []).length;
  const settingHits = (value.match(/(设定|规则|附录|背景|历史|地理|组织|参考|说明|时间线|年表)/g) || []).length;
  const sceneHeadings = (value.match(/^(#{1,6}\s*)?(场景|第\s*[一二三四五六七八九十百0-9]+\s*[幕章节]|chapter|act\b)/gim) || []).length;
  const commentaryHits = (value.match(/(相比|为什么不|能否|能不能|是否|建议|如果|问题|新手|KP|玩家|此模组|本模组|改进|调整|设计)/gi) || []).length;
  const endingHits = (value.match(/(结局|结尾|收尾|最终|胜利|失败|存活|死亡|逃出|解决)/g) || []).length;
  const rewardHits = (value.match(/(奖励|成长|报酬|酬金|SAN\s*值|理智值|技能成长|恢复)/gi) || []).length;
  return { statHits, narrativeHits, clueHits, itemMagicHits, settingHits, sceneHeadings, commentaryHits, endingHits, rewardHits };
}

function classifySource(source) {
  const filename = String(source && source.filename ? source.filename : "material");
  const lower = filename.toLowerCase();
  const extension = extensionOf(filename);
  const text = String(source && source.text ? source.text : "");
  const scores = contentScores(text);

  if (["csv", "tsv", "xlsx", "xls", "json", "yaml", "yml"].includes(extension)) return "NPC_SHEET";
  if (/(npc|npc数据|stat|数据表|属性表|数值表|怪物表|bestiary|monster)/i.test(lower)) return "NPC_SHEET";
  if (/(手书|线索|handout|clue|玩家材料)/i.test(lower)) return "HANDOUT";
  if (/(设定|规则|附录|参考资料|reference|rules?|setting|appendix)/i.test(lower)) return "SETTING";

  const density = text.length > 0 ? scores.statHits / Math.max(1, text.length / 1000) : 0;
  if (text.length > 0 && text.length <= 3500 && scores.sceneHeadings === 0 && scores.statHits < 2 && scores.commentaryHits >= 4) return "COMMENTARY";
  if (text.length > 0 && text.length <= 4000 && scores.statHits >= 12 && density >= 5 && scores.narrativeHits <= 3) return "NPC_SHEET";
  if (text.length > 0 && text.length <= 2500 && scores.statHits < 2 && scores.clueHits + scores.itemMagicHits >= 2) return "HANDOUT";
  return "MODULE";
}

function chooseRoutes(docType, chunk) {
  const text = String(chunk && chunk.text ? chunk.text : "");
  const scores = contentScores(text);
  if (docType === "NPC_SHEET") return ["npc"];
  if (docType === "COMMENTARY") return ["notes"];
  if (docType === "HANDOUT") return ["handout"];
  if (docType === "SETTING") {
    if (scores.statHits >= 4 && scores.narrativeHits <= 1) return ["npc"];
    return ["setting"];
  }

  const routes = [];
  const narrativeCue = scores.narrativeHits >= 1 || scores.sceneHeadings >= 1 || text.length > 900;
  const structuredCue = scores.statHits >= 2 || scores.itemMagicHits >= 1 || scores.endingHits >= 1 || scores.rewardHits >= 1;
  const handoutCue = scores.clueHits + scores.itemMagicHits >= 2;

  if (narrativeCue) routes.push("narrative");
  if (structuredCue) routes.push("npc");
  if (handoutCue && routes.length === 0) routes.push("handout");
  if (routes.length === 0) routes.push("general");
  return Array.from(new Set(routes)).slice(0, 2);
}

function isSceneBoundary(text) {
  const firstLine = String(text || "").split("\n")[0].trim();
  if (firstLine.length === 0) return false;
  if (/^(#{1,6}\s*)?(场景|第\s*[一二三四五六七八九十百0-9]+\s*[幕章节]|chapter|act\b)/i.test(firstLine)) return true;
  if (/^[-=—]{3,}$/.test(firstLine)) return true;
  if (/^\[\d{1,2}:\d{2}(?::\d{2})?\]/.test(firstLine)) return true;
  if (/^【[^】]*(场景|第\s*[一二三四五六七八九十百0-9]+\s*[幕章节])[^】]*】/.test(firstLine)) return true;
  return false;
}

function chunkSourceByScene(filename, rawText) {
  const target = 3000;
  const max = 4200;
  const normalized = String(rawText || "").replace(/\r\n?/g, "\n").trim();
  if (normalized.length === 0) return [];

  const paragraphs = [];
  let heading = "";
  for (const block of normalized.split(/\n{2,}/)) {
    const text = block.trim();
    if (text.length === 0) continue;
    const firstLine = text.split("\n")[0].trim();
    if (/^(#{1,6}\s+|【[^】]{1,40}】\s*$)/.test(firstLine)) {
      heading = firstLine.replace(/^#{1,6}\s+/, "").replace(/^【|】$/g, "").trim() || heading;
    }
    paragraphs.push({ text, heading });
  }
  if (paragraphs.length === 0) paragraphs.push({ text: normalized, heading });

  const expanded = [];
  for (const paragraph of paragraphs) {
    if (paragraph.text.length <= max) {
      expanded.push(paragraph);
      continue;
    }
    const pieces = paragraph.text.split(/(?<=[。！？!?；;])\s*/).filter((piece) => piece.trim().length > 0);
    let buffer = "";
    const flush = () => {
      if (buffer.trim().length > 0) expanded.push({ text: buffer.trim(), heading: paragraph.heading });
      buffer = "";
    };
    for (const piece of pieces) {
      if (piece.length > max) {
        flush();
        for (let offset = 0; offset < piece.length; offset += target) {
          expanded.push({ text: piece.slice(offset, offset + target), heading: paragraph.heading });
        }
        continue;
      }
      if (buffer.length + piece.length > target) flush();
      buffer += piece;
    }
    flush();
  }

  const chunks = [];
  let buffer = "";
  let bufferHeading = expanded[0] ? expanded[0].heading : "";
  let forceHeading = "";
  const pushChunk = () => {
    const text = buffer.trim();
    if (text.length === 0) return;
    chunks.push({ text, heading: forceHeading || bufferHeading, charCount: text.length });
    buffer = "";
  };

  for (const paragraph of expanded) {
    const startsScene = isSceneBoundary(paragraph.text);
    if (buffer.length > 0 && startsScene) pushChunk();
    if (buffer.length === 0) {
      bufferHeading = paragraph.heading;
      forceHeading = paragraph.heading;
    } else if (paragraph.heading.length > 0 && paragraph.heading !== bufferHeading) {
      if (buffer.length >= 1000) pushChunk();
      forceHeading = paragraph.heading;
    }
    if (buffer.length > 0 && buffer.length + paragraph.text.length + 2 > target) pushChunk();
    if (buffer.length > 0) buffer += "\n\n";
    buffer += paragraph.text;
    if (buffer.length >= target) pushChunk();
  }
  pushChunk();

  return chunks.map((chunk, index) => ({
    filename,
    fileIndex: index + 1,
    fileTotal: chunks.length,
    heading: chunk.heading,
    text: chunk.text,
    charCount: chunk.charCount
  }));
}

for (const source of sources) {
  const filename = String(source && source.filename ? source.filename : "material");
  const docType = classifySource(source);
  const chunks = chunkSourceByScene(filename, source ? source.text : "");
  for (const chunk of chunks) {
    const routes = chooseRoutes(docType, chunk);
    const chunkGroupId = "text:" + filename + ":" + String(chunk.fileIndex) + "/" + String(chunk.fileTotal);
    for (const route of routes) {
      output.push({
        json: {
          route,
          docType,
          kind: "chunk",
          chunk,
          chunkGroupId,
          originId: chunkGroupId + ":" + route,
          label: "场景段 " + filename + " " + String(chunk.fileIndex) + "/" + String(chunk.fileTotal) + " · " + routeLabel(route),
          context
        }
      });
    }
  }
}

const batchSize = 2;
for (let offset = 0; offset < images.length; offset += batchSize) {
  const batch = images.slice(offset, offset + batchSize);
  const chunkGroupId = "image:" + String(offset / batchSize + 1);
  output.push({
    json: {
      route: "image",
      docType: "IMAGE",
      kind: "image",
      imageBatch: batch.map((image) => ({
        filename: image.filename,
        relativePath: image.relativePath,
        mime: image.mime,
        dataUrl: image.dataUrl,
        pageNumber: image.pageNumber,
        pageText: image.pageText,
        origin: image.origin
      })),
      chunkGroupId,
      originId: chunkGroupId + ":image",
      label: "图片分析 " + batch.map((image) => image.filename).join("、").slice(0, 80),
      context
    }
  });
}

return output;
