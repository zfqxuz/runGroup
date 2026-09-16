/**
 * n8n 「团本解析」工作流：解析 HTTP Request 返回的 DeepSeek JSON，并用确定性规则回填 NPC 数值。
 *
 * 这个节点运行在 runOnceForAllItems 模式，输入是 HTTP Request 节点的所有响应。
 * 工作流前置节点会先发 chunk 请求，再发 image 请求，顺序固定，因此这里按顺序还原。
 */

/*__NPC_STATS_CORE__*/

const rawRoot = $("Webhook 团本解析").first().json;
const root = (rawRoot && rawRoot.body && typeof rawRoot.body === "object") ? rawRoot.body : rawRoot;
const chunks = Array.isArray(root.chunks) ? root.chunks : [];
const images = Array.isArray(root.images) ? root.images : [];
const sources = Array.isArray(root.sources) ? root.sources : [];
const chunkItems = chunks.filter((chunk) => chunk && String(chunk.text || "").trim().length > 0);
const imageBatchSize = 2;
const imageBatches = [];
for (let offset = 0; offset < images.length; offset += imageBatchSize) {
  imageBatches.push(images.slice(offset, offset + imageBatchSize));
}

const SECTION_SET = new Set([
  "元信息", "真相与背景", "剧情梗概", "开场钩子", "关键NPC", "地点与场景", "线索", "遭遇与战斗", "道具与手书", "怪物与神话生物", "结局分支", "奖励与成长", "KP备注", "附录"
]);

function asRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function asString(value, fallback) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return fallback === undefined ? "" : fallback;
}

function asObjectArray(value) {
  if (Array.isArray(value)) return value.map(asRecord);
  if (value !== null && typeof value === "object") return [asRecord(value)];
  return [];
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch (error) {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw error;
  }
}

function normalizeChunkExtraction(raw, label) {
  const rootNode = asRecord(raw);
  const metaRaw = asRecord(rootNode.meta ?? rootNode.frontMatter ?? {});
  const meta = {};
  for (const key of ["title", "summary", "background", "occupationRecommendation"]) {
    const value = asString(metaRaw[key]);
    if (value.length > 0) meta[key] = value;
  }
  const sectionsRaw = asRecord(rootNode.sections ?? rootNode["章节"] ?? {});
  const sections = {};
  for (const section of SECTION_SET) {
    const value = asString(sectionsRaw[section] ?? sectionsRaw[section.replace(/与/g, "")] ?? "");
    if (value.length > 0) sections[section] = value;
  }
  const structuredRaw = asRecord(rootNode.structured ?? rootNode["结构化数据"] ?? {});
  const structured = {};
  const pluralMap = {
    chapters: "chapter", scenes: "scene", encounters: "encounter", npcs: "npc",
    clues: "clue", items: "item", endings: "ending", rewards: "reward", magic: "magic", spells: "magic"
  };
  for (const [rawKind, value] of Object.entries(structuredRaw)) {
    const plural = rawKind === "spells" ? "magic" : rawKind;
    const kind = pluralMap[plural] || pluralMap[plural.replace(/s$/, "")];
    if (kind === undefined) continue;
    const entries = asObjectArray(value);
    if (entries.length > 0) structured[kind] = entries;
  }
  return { label, meta, sections, structured };
}

function normalizeImageExtractions(raw, batch) {
  const records = asObjectArray(asRecord(raw).images);
  const results = [];
  for (let index = 0; index < batch.length; index += 1) {
    const image = batch[index];
    const record = records.find((item) => asString(item.filename) === image.filename) || records[index] || {};
    const kindRaw = asString(record.kind).toUpperCase();
    const kinds = ["MAP", "SCENE", "HANDOUT", "CLUE", "NPC", "ITEM", "TEXT", "OTHER"];
    const kind = kinds.includes(kindRaw) ? kindRaw : "OTHER";
    const rawSection = asString(record.section);
    const section = SECTION_SET.has(rawSection) ? rawSection : "附录";
    results.push({
      filename: image.filename,
      relativePath: image.relativePath,
      kind,
      transcription: asString(record.transcription).slice(0, 4000),
      description: asString(record.description).slice(0, 3000),
      section,
      sectionText: asString(record.sectionText).slice(0, 3000),
      scene: record.scene && typeof record.scene === "object" && !Array.isArray(record.scene) ? record.scene : null,
      clue: record.clue && typeof record.clue === "object" && !Array.isArray(record.clue) ? record.clue : null,
      npc: record.npc && typeof record.npc === "object" && !Array.isArray(record.npc) ? record.npc : null,
      item: record.item && typeof record.item === "object" && !Array.isArray(record.item) ? record.item : null
    });
  }
  return results;
}

const extractions = [];
const imageExtractions = [];
const warnings = [];
let aiCalls = 0;
let cursor = 0;

for (let index = 0; index < items.length; index += 1) {
  const response = items[index] && items[index].json ? items[index].json : {};
  const choice = Array.isArray(response.choices) ? response.choices[0] : null;
  const finishReason = choice ? choice.finish_reason : "";
  const content = choice && choice.message ? choice.message.content : "";
  const isChunk = cursor < chunkItems.length;
  const chunk = isChunk ? chunkItems[cursor] : null;
  const batch = isChunk ? null : imageBatches[cursor - chunkItems.length];

  if (finishReason === "length") {
    const label = isChunk && chunk
      ? "文本段 " + chunk.filename + " " + String(chunk.fileIndex) + "/" + String(chunk.fileTotal)
      : "图片分析 " + (batch || []).map((image) => image.filename).join("、");
    throw new Error(label + " 触发 max_tokens 截断；请拆分素材后重试");
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    warnings.push("模型第 " + String(cursor + 1) + " 次调用没有返回正文，已跳过");
    cursor += 1;
    continue;
  }

  aiCalls += 1;
  if (isChunk && chunk) {
    const label = "文本段 " + chunk.filename + " " + String(chunk.fileIndex) + "/" + String(chunk.fileTotal);
    extractions.push(normalizeChunkExtraction(extractJsonObject(content), label));
  } else if (batch && batch.length > 0) {
    imageExtractions.push(...normalizeImageExtractions(extractJsonObject(content), batch));
  }
  cursor += 1;
}

const npcEntries = [];
for (const extraction of extractions) {
  const npcs = extraction && extraction.structured ? extraction.structured.npcs : null;
  if (Array.isArray(npcs)) for (const entry of npcs) npcEntries.push(entry);
}
const npcStats = buildNpcStats({ entries: npcEntries, sources });

return [{
  json: {
    ok: true,
    extractions,
    images: imageExtractions,
    npcStats,
    warnings,
    stats: {
      aiCalls,
      attempts: 1,
      chunks: chunkItems.length,
      chunksCompleted: extractions.length,
      imagesAnalyzed: imageExtractions.length,
      imagesUsed: images.length,
      npcStatsParsed: npcStats.length
    }
  }
}];
