/**
 * 模型 JSON 输出的确定性兜底解析。
 *
 * 支持：
 * - markdown 代码围栏
 * - 思维链结束标记后的正式答案
 * - 多个 JSON 对象 / 夹杂英文解释
 * - 字符串内未转义引号、尾逗号
 * - 通过 jsonrepair 做结构修复
 */

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
  return output.replace(/,\s*([}\]])/g, "$1");
}

function collectBalancedJsonObjects(text, limit) {
  const value = String(text || "");
  const results = [];
  const max = Math.min(value.length, 300000);
  let starts = 0;
  for (let index = 0; index < max && starts < limit; index += 1) {
    if (value[index] !== "{") continue;
    starts += 1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let cursor = index; cursor < max; cursor += 1) {
      const char = value[cursor];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }
    if (end > index) results.push(value.slice(index, end + 1));
  }
  return results;
}

function tryParseJsonCandidate(candidate) {
  const text = String(candidate || "").trim();
  if (text.length === 0) return null;

  if (typeof jsonrepairLib === "function") {
    try {
      const parsed = JSON.parse(jsonrepairLib(text));
      if (parsed !== null && typeof parsed === "object" && Array.isArray(parsed) === false) return parsed;
    } catch (error) {
      // ignore
    }
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && Array.isArray(parsed) === false) return parsed;
  } catch (error) {
    // ignore
  }

  const repaired = repairJsonText(text);
  if (repaired !== text) {
    try {
      const parsed = JSON.parse(repaired);
      if (parsed !== null && typeof parsed === "object" && Array.isArray(parsed) === false) return parsed;
    } catch (error) {
      // ignore
    }
  }

  return null;
}

function scoreParsedObject(parsed, candidate, original) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return -1;
  const keys = Object.keys(parsed);
  if (keys.length === 0) return 1;
  let score = Math.min(30, keys.length);
  if (parsed.meta && typeof parsed.meta === "object") score += 30;
  if (parsed.sections && typeof parsed.sections === "object") score += 25;
  if (parsed.structured && typeof parsed.structured === "object") score += 35;
  if (Array.isArray(parsed.images)) score += 30;
  if (parsed.chapters || parsed.scenes || parsed.npcs || parsed.clues || parsed.items || parsed.magic || parsed.encounters) score += 12;
  score += Math.min(20, String(candidate || "").length / 500);
  const position = String(original || "").indexOf(String(candidate || ""));
  if (position > 0) score += Math.min(12, position / 200);
  return score;
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (withoutFence.length === 0) return null;

  const candidates = [withoutFence];

  const entireStart = withoutFence.indexOf("{");
  const entireEnd = withoutFence.lastIndexOf("}");
  if (entireStart >= 0 && entireEnd > entireStart) {
    candidates.push(withoutFence.slice(entireStart, entireEnd + 1));
  }

  const thinkingMarker = "end▁of▁thinking";
  const markerIndex = withoutFence.lastIndexOf(thinkingMarker);
  if (markerIndex >= 0) {
    const afterMarker = withoutFence.slice(markerIndex + thinkingMarker.length).trim();
    if (afterMarker.length > 0) candidates.unshift(afterMarker);
  }

  const balanced = collectBalancedJsonObjects(withoutFence, 200);
  for (const candidate of balanced) candidates.push(candidate);

  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed === null) continue;
    const score = scoreParsedObject(parsed, candidate, withoutFence);
    if (score > bestScore) {
      best = parsed;
      bestScore = score;
    }
  }
  return best;
}
