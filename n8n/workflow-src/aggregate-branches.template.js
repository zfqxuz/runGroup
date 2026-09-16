/**
 * 最终聚合节点：合并所有分支结果，统一生成稳定实体 id，并构建返回给应用的结构。
 *
 * build-workflows.mjs 会替换：
 * - __BRANCH_READS__    每个分支解析节点读取代码
 * - __INITIAL_CALL_COUNTS__ 每个分支初始调用计数
 */

const rawRoot = $("Webhook 团本解析").first().json;
const root = (rawRoot && rawRoot.body && typeof rawRoot.body === "object") ? rawRoot.body : rawRoot;
const sources = Array.isArray(root.sources) ? root.sources : [];
const inputImages = Array.isArray(root.images) ? root.images : [];

const stage1Items = [];
/*__BRANCH_READS__*/

const pendingRequests = $("汇总待校验").all().map((item) => (item && item.json) ? item.json : {});
const validationResponses = items.map((item) => (item && item.json) ? item.json : {});
const warnings = [];
const extractions = [];
const imageExtractions = [];
const completedChunkGroups = new Set();

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

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function slugify(value) {
  const text = String(value || "").trim().toLowerCase();
  const slug = text
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug;
}

function entryName(kind, entry) {
  if (kind === "clue") return asString(entry.title) || asString(entry.name);
  return asString(entry.name) || asString(entry.title);
}

function stabilizeExtractionIds(extraction, sourceKey) {
  const nameFields = {
    chapter: "name",
    scene: "name",
    encounter: "name",
    npc: "name",
    clue: "title",
    item: "name",
    ending: "name",
    reward: "name",
    magic: "name"
  };
  const structured = extraction && extraction.structured ? extraction.structured : {};
  for (const [kind, entries] of Object.entries(structured)) {
    if (!Array.isArray(entries)) continue;
    const field = nameFields[kind] || "name";
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const name = asString(entry[field]) || asString(entry.name) || asString(entry.title);
      const slug = slugify(name) || hashString(String(sourceKey || "") + ":" + kind + ":" + String(index));
      entry.id = kind + "-" + slug;
      if (kind === "encounter") {
        if (asString(entry.sceneName).length > 0) entry.sceneId = "scene-" + slugify(entry.sceneName);
        if (asString(entry.chapterName).length > 0) entry.chapterId = "chapter-" + slugify(entry.chapterName);
      }
      if (kind === "clue") {
        const linkedName = asString(entry.linkedItemName);
        if (linkedName.length > 0) entry.linkedItemId = "item-" + slugify(linkedName);
        else if (asString(entry.linkedItemId).length > 0) entry.linkedItemId = "item-" + slugify(entry.linkedItemId);
      }
    }
  }
}

function addTextParsed(item, parsed) {
  const sourceKey = item.chunkGroupId || item.originId || item.label || "unknown";
  const extraction = normalizeChunkExtraction(parsed, item.label || "未命名分块");
  stabilizeExtractionIds(extraction, sourceKey);
  const hasContent =
    Object.keys(extraction.meta).length > 0 ||
    Object.keys(extraction.sections).length > 0 ||
    Object.keys(extraction.structured).length > 0;
  if (hasContent) {
    extractions.push(extraction);
  }
  if (item.chunkGroupId) completedChunkGroups.add(item.chunkGroupId);
  return hasContent;
}

function addImageParsed(item, parsed) {
  const batch = Array.isArray(item.imageBatch) ? item.imageBatch : [];
  if (batch.length === 0) return false;
  const records = normalizeImageExtractions(parsed, batch);
  if (records.length === 0) return false;
  imageExtractions.push(...records);
  return true;
}

const pendingGroups = new Map();
for (const item of stage1Items) {
  if (item.needsStage2 === true) {
    const key = item.originId || item.stage2Id || "unknown";
    const list = pendingGroups.get(key) || [];
    list.push(item);
    pendingGroups.set(key, list);
  } else if (item.parsed !== undefined && item.parsed !== null) {
    if (item.kind === "image") addImageParsed(item, item.parsed);
    else addTextParsed(item, item.parsed);
  }
}

const stage2ByStage2Id = new Map();
for (let index = 0; index < pendingRequests.length; index += 1) {
  const request = pendingRequests[index] || {};
  const response = validationResponses[index] || {};
  stage2ByStage2Id.set(String(request.stage2Id || ("s2-" + String(index))), { request, response });
}

for (const group of pendingGroups.values()) {
  let success = false;
  const hadRetry = group.some((item) => item.stage2Kind === "retry");
  const hadValidate = group.some((item) => item.stage2Kind === "validate");

  for (const pending of group) {
    const pair = stage2ByStage2Id.get(String(pending.stage2Id || ""));
    if (pair === undefined) continue;
    const response = pair.response || {};
    const request = pair.request || {};
    if (request.stage2Kind === "noop") continue;
    const choice = Array.isArray(response.choices) ? response.choices[0] : null;
    const finishReason = choice ? choice.finish_reason : "";
    const content = choice && choice.message && typeof choice.message.content === "string" ? choice.message.content : "";
    if (response.error || finishReason === "length" || content.trim().length === 0) continue;
    const parsed = extractJsonObject(content);
    if (parsed === null) continue;
    const ok = pending.kind === "image" ? addImageParsed(pending, parsed) : addTextParsed(pending, parsed);
    if (ok) success = true;
  }

  const first = group[0] || {};
  const label = first.originLabel || first.label || first.originId || "未命名分块";
  if (success) {
    if (hadRetry) warnings.push(label + " 初次输出被 max_tokens 截断，已拆分为更小片段重试成功");
    else if (hadValidate) warnings.push(label + " JSON 格式异常，已由格式校验 Agent 修复并通过");
    continue;
  }

  if (first.fallbackText && String(first.fallbackText).trim().length > 0) {
    extractions.push({
      label: label + "（原文回退）",
      meta: {},
      sections: {},
      structured: {},
      fallbackText: String(first.fallbackText).slice(0, 4000)
    });
    if (first.chunkGroupId) completedChunkGroups.add(first.chunkGroupId);
    warnings.push(label + " 的所有分支均未产出合法 JSON，已把原文片段放入附录");
  } else {
    warnings.push(label + " 的所有分支均失败，已跳过");
  }
}

const npcEntries = [];
for (const extraction of extractions) {
  const npcs = extraction && extraction.structured ? extraction.structured.npcs : null;
  if (Array.isArray(npcs)) for (const entry of npcs) npcEntries.push(entry);
}
const npcStats = buildNpcStats({ entries: npcEntries, sources });

const chunkGroups = new Set();
for (const item of stage1Items) {
  if (item && item.kind === "chunk" && item.chunkGroupId) chunkGroups.add(item.chunkGroupId);
}
const realStage2Requests = pendingRequests.filter((request) => request && request.stage2Kind !== "noop");
let initialCalls = 0;
/*__INITIAL_CALL_COUNTS__*/

return [{
  json: {
    ok: true,
    extractions,
    images: imageExtractions,
    npcStats,
    warnings,
    stats: {
      aiCalls: initialCalls + realStage2Requests.length,
      attempts: realStage2Requests.length > 0 ? 2 : 1,
      chunks: chunkGroups.size,
      chunksCompleted: completedChunkGroups.size,
      imagesAnalyzed: imageExtractions.length,
      imagesUsed: inputImages.length,
      npcStatsParsed: npcStats.length
    }
  }
}];
