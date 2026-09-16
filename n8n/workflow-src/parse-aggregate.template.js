/**
 * n8n 「团本解析」工作流：解析 HTTP Request 返回的 DeepSeek JSON，并用确定性规则回填 NPC 数值。
 *
 * 这个节点运行在 runOnceForAllItems 模式，输入是 HTTP Request 节点的所有响应。
 * 工作流前置节点会先发 chunk 请求，再发 image 请求，顺序固定，因此这里按顺序还原。
 */

/*__NPC_STATS_CORE__*/

const rawRoot = $("Webhook 团本解析").first().json;
const root = (rawRoot && rawRoot.body && typeof rawRoot.body === "object") ? rawRoot.body : rawRoot;
const sources = Array.isArray(root.sources) ? root.sources : [];
const images = Array.isArray(root.images) ? root.images : [];
const requestItems = $("按场景分块").all().map((item) => (item && item.json) ? item.json : {});
const chunkRequestCount = requestItems.filter((item) => item.kind !== "image").length;

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

function repairJsonText(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }
      if (char === '"') {
        let lookahead = index + 1;
        while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1;
        const next = text[lookahead];
        const isClosing = next === undefined || next === "," || next === "}" || next === "]" || next === ":";
        if (isClosing) {
          output += char;
          inString = false;
        } else {
          // 模型经常在字符串内部输出未转义的双引号，例如 the "morgue"；
          // 这里按“下一个结构字符”判断是不是字符串结束，不是就补转义。
          output += '\\"';
        }
        continue;
      }
      if (char === "\n") {
        output += "\\n";
        continue;
      }
      if (char === "\r") {
        output += "\\r";
        continue;
      }
      if (char === "\t") {
        output += "\\t";
        continue;
      }
      output += char;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    output += char;
  }
  // 去掉对象 / 数组结尾前多余的逗号
  return output.replace(/,\s*([}\]])/g, "$1");
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [];
  candidates.push(withoutFence);
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(withoutFence.slice(start, end + 1));

  let lastError = null;
  for (const candidate of candidates) {
    if (typeof jsonrepairLib === "function") {
      try {
        return JSON.parse(jsonrepairLib(candidate));
      } catch (error) {
        lastError = error;
      }
    }
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
    const repaired = repairJsonText(candidate);
    if (repaired !== candidate) {
      try {
        return JSON.parse(repaired);
      } catch (error) {
        lastError = error;
      }
    }
  }
  const prefix = withoutFence.slice(0, 1200);
  throw new Error("模型返回 JSON 无法解析：" + (lastError instanceof Error ? lastError.message : String(lastError)) + "；内容开头：" + prefix);
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

for (let index = 0; index < items.length; index += 1) {
  const response = items[index] && items[index].json ? items[index].json : {};
  const request = requestItems[index] || {};
  const isImage = request.kind === "image";
  const label = String(request.label || (isImage ? "图片分析" : "文本场景段"));
  const batch = Array.isArray(request.imageBatch) ? request.imageBatch : [];
  const choice = Array.isArray(response.choices) ? response.choices[0] : null;
  const finishReason = choice ? choice.finish_reason : "";
  const content = choice && choice.message ? choice.message.content : "";

  if (finishReason === "length") {
    throw new Error(label + " 触发 max_tokens 截断；请拆分素材后重试");
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    warnings.push("模型第 " + String(index + 1) + " 次调用没有返回正文，已跳过");
    continue;
  }

  aiCalls += 1;
  if (isImage) {
    if (batch.length > 0) imageExtractions.push(...normalizeImageExtractions(extractJsonObject(content), batch));
  } else {
    extractions.push(normalizeChunkExtraction(extractJsonObject(content), label));
  }
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
      chunks: chunkRequestCount,
      chunksCompleted: extractions.length,
      imagesAnalyzed: imageExtractions.length,
      imagesUsed: images.length,
      npcStatsParsed: npcStats.length
    }
  }
}];
