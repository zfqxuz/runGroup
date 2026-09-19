/**
 * 分支「解析结果」节点通用代码。
 * build-workflows.mjs 会注入 ROUTE_KEY / ROUTE_LABEL，
 * 并把 BUILD_NODE_NAME 替换为该分支的「构建请求」节点名。
 */

const requestItems = $("__BUILD_NODE_NAME__").all().map((item) => (item && item.json) ? item.json : {});
const outputItems = [];

function capText(value, limit) {
  const text = String(value || "");
  return text.length > limit ? text.slice(0, limit) : text;
}

function lightImageBatch(batch) {
  if (!Array.isArray(batch)) return [];
  return batch.map((image) => ({
    filename: image && image.filename ? image.filename : "",
    relativePath: image && image.relativePath ? image.relativePath : "",
    mime: image && image.mime ? image.mime : "",
    pageNumber: image && image.pageNumber !== undefined ? image.pageNumber : null,
    pageText: image && typeof image.pageText === "string" ? image.pageText.slice(0, 1200) : "",
    origin: image && image.origin ? image.origin : ""
  }));
}

function splitTextForRetry(rawText) {
  const text = String(rawText || "");
  if (text.trim().length === 0) return [""];
  if (text.length <= 700) return [text];
  const desiredParts = text.length > 1800 ? 3 : 2;
  const target = Math.ceil(text.length / desiredParts);
  const pieces = text.split(/(?<=[。！？!?；;])/).filter((piece) => piece.trim().length > 0);
  const parts = [];
  let buffer = "";
  for (const piece of pieces) {
    if (buffer.length > 0 && buffer.length + piece.length > target && parts.length < desiredParts - 1) {
      parts.push(buffer);
      buffer = "";
    }
    buffer += piece;
  }
  if (buffer.trim().length > 0) parts.push(buffer);
  if (parts.length === 0) {
    for (let offset = 0; offset < text.length; offset += target) parts.push(text.slice(offset, offset + target));
  }
  return parts;
}

function cloneRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = {};
  for (const key of Object.keys(value)) copy[key] = value[key];
  return copy;
}

function buildRetryBody(request, chunk, splitIndex, splitTotal, isImage) {
  const ctx = (request && request.context && typeof request.context === "object") ? request.context : {};
  const base = (request && request.body && typeof request.body === "object") ? request.body : {};
  if (isImage) {
    const messages = Array.isArray(base.messages) ? base.messages.map((message) => cloneRecord(message)) : [];
    messages.push({
      role: "user",
      content: "注意：上一次调用因 max_tokens 截断或失败。本次请只输出最精简的合法 JSON：images 数组最多 1 条，禁止解释，必须在 1200 个中文字符内闭合。"
    });
    return Object.assign({}, base, { temperature: 0.0, messages });
  }
  const chunkLike = {
    filename: (chunk && chunk.filename) || (request && request.label) || "素材",
    fileIndex: (chunk && chunk.fileIndex) || 1,
    fileTotal: (chunk && chunk.fileTotal) || 1,
    heading: (chunk && chunk.heading) || "",
    text: (chunk && chunk.text) || "",
    charCount: chunk && chunk.text ? chunk.text.length : 0
  };
  const messages = buildAgentMessages(ROUTE_KEY, chunkLike, ctx.hints || {}, {
    retry: true,
    splitIndex,
    splitTotal
  });
  return Object.assign({}, base, {
    model: ctx.model || base.model,
    max_tokens: ctx.maxTokens || base.max_tokens || 8192,
    temperature: 0.0,
    messages
  });
}

function buildValidatorBody(request, rawContent) {
  const ctx = (request && request.context && typeof request.context === "object") ? request.context : {};
  const base = (request && request.body && typeof request.body === "object") ? request.body : {};
  return {
    model: ctx.model || base.model,
    max_tokens: ctx.maxTokens || base.max_tokens || 8192,
    temperature: 0.1,
    stream: false,
    response_format: { type: "json_object" },
    messages: buildValidatorMessages(rawContent, ROUTE_KEY, request.label || "")
  };
}

for (let index = 0; index < requestItems.length; index += 1) {
  const request = requestItems[index] || {};
  const response = (items[index] && items[index].json) ? items[index].json : {};
  const originId = String(request.originId || request.requestId || (ROUTE_KEY + "-" + String(index + 1)));
  const kind = request.kind === "image" ? "image" : "chunk";
  const label = String(request.label || (ROUTE_LABEL + " " + String(index + 1)));
  const choice = Array.isArray(response.choices) ? response.choices[0] : null;
  const finishReason = choice ? choice.finish_reason : "";
  const rawContent = choice && choice.message && typeof choice.message.content === "string" ? choice.message.content : "";
  const needsRetry = Boolean(response.error) || finishReason === "length" || rawContent.trim().length === 0;

  if (needsRetry) {
    if (kind === "chunk" && request.chunk && String(request.chunk.text || "").trim().length > 0) {
      const parts = splitTextForRetry(request.chunk.text);
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const partText = parts[partIndex];
        const subChunk = Object.assign({}, request.chunk, { text: partText, charCount: partText.length });
        outputItems.push({
          json: {
            originId,
            originLabel: label,
            stage2Id: originId + ":s2:" + String(partIndex),
            needsStage2: true,
            stage2Kind: "retry",
            route: ROUTE_KEY,
            kind: "chunk",
            label: label + "（重试 " + String(partIndex + 1) + "/" + String(parts.length) + "）",
            chunk: subChunk,
            imageBatch: lightImageBatch([]),
            chunkGroupId: request.chunkGroupId || "",
            url: request.url,
            body: buildRetryBody(request, subChunk, partIndex, parts.length, false),
            fallbackText: capText(request.chunk.text, 4000)
          }
        });
      }
    } else {
      outputItems.push({
        json: {
          originId,
          originLabel: label,
          stage2Id: originId + ":s2:0",
          needsStage2: true,
          stage2Kind: "retry",
          route: ROUTE_KEY,
          kind,
          label: label + "（重试）",
          chunk: request.chunk || null,
          imageBatch: lightImageBatch(request.imageBatch || []),
          chunkGroupId: request.chunkGroupId || "",
          url: request.url,
          body: buildRetryBody(request, request.chunk || {}, 0, 1, kind === "image"),
          fallbackText: ""
        }
      });
    }
    continue;
  }

  const parsed = extractJsonObject(rawContent);
  if (parsed !== null) {
    outputItems.push({
      json: {
        originId,
        originLabel: label,
        stage2Id: originId + ":accepted",
        needsStage2: false,
        stage2Kind: null,
        route: ROUTE_KEY,
        kind,
        label,
        parsed,
        chunk: request.chunk || null,
        imageBatch: lightImageBatch(request.imageBatch || []),
        chunkGroupId: request.chunkGroupId || "",
        fallbackText: kind === "chunk" && request.chunk ? capText(request.chunk.text, 4000) : ""
      }
    });
    continue;
  }

  outputItems.push({
    json: {
      originId,
      originLabel: label,
      stage2Id: originId + ":validate",
      needsStage2: true,
      stage2Kind: "validate",
      route: ROUTE_KEY,
      kind,
      label,
      chunk: request.chunk || null,
      imageBatch: lightImageBatch(request.imageBatch || []),
      chunkGroupId: request.chunkGroupId || "",
      url: request.url,
      body: buildValidatorBody(request, rawContent),
      fallbackText: kind === "chunk" && request.chunk ? capText(request.chunk.text, 4000) : ""
    }
  });
}

return outputItems;
