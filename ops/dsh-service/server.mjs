// dsh 极简模式（headless）旁车服务：
//   GET  /health -> { ok: true }
//   POST /run         { task, files, timeoutMs } -> { exitCode, stdout, stderr, result }
//   POST /run/stream  同上，但以 NDJSON 流式返回：
//     {"type":"progress","text":"..."}  阶段状态
//     {"type":"thinking","text":"..."}  dsh reasoning；工具调用细节不展开
//     {"type":"result","exitCode":0,"stdout":"...","stderr":"...","result":{...}}
//     {"type":"error","message":"..."}
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 8790);
const COMMAND = process.env.DSH_HEADLESS_COMMAND ?? "dsh";
const ARGS = (process.env.DSH_HEADLESS_ARGS ?? "--profile headless").split(/\s+/).filter(Boolean);
const ROOT = process.env.DSH_WORKSPACE_ROOT ?? join(tmpdir(), "dsh-service");
const DEFAULT_TIMEOUT = Number(process.env.DSH_TASK_TIMEOUT_MS ?? 300000);
// 生产是 1.6G 内存的单机，默认一次只跑一个 dsh 任务，避免并发把主机打满。
const MAX_CONCURRENT = Math.max(1, Number(process.env.DSH_MAX_CONCURRENT ?? 1));
const MAX_BODY_BYTES = 5 * 1024 * 1024;
let activeTasks = 0;

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

/**
 * dsh headless 的思考内容是 stderr 上的 "dsh: reasoning:" 分段。
 * 工具调用等其它 dsh 内部通道不展开给前端；没有前缀的内容按思考内容兜底。
 */
function reasoningTextFromLine(line) {
  const trimmed = line.replace(/\r$/, "").trim();
  if (trimmed.length === 0) return null;
  const marker = /^dsh:\s*reasoning:\s*/i.exec(trimmed);
  if (marker !== null) {
    const text = trimmed.slice(marker[0].length).trim();
    return text.length > 0 ? text : null;
  }
  if (/^dsh:/i.test(trimmed)) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  return trimmed;
}

async function runTask(input, onStderrLine) {
  await mkdir(ROOT, { recursive: true });
  const workspace = await mkdtemp(join(ROOT, "turn-"));
  try {
    for (const [name, content] of Object.entries(input.files ?? {})) {
      await writeFile(join(workspace, name), String(content), "utf8");
    }
    const timeoutMs = Number(input.timeoutMs) > 5000 ? Number(input.timeoutMs) : DEFAULT_TIMEOUT;
    const output = await new Promise((resolve, reject) => {
      const child = spawn(COMMAND, [...ARGS, String(input.task ?? "")], {
        cwd: workspace,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_ENV: process.env.NODE_ENV,
          LANG: process.env.LANG,
          TERM: process.env.TERM,
          DSH_HOME: process.env.DSH_HOME,
          DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
          DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
          DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let stderrBuffer = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      const handleStderrLine = (line) => {
        if (onStderrLine !== undefined) onStderrLine(line);
      };
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderr += text;
        stderrBuffer += text;
        let index;
        while ((index = stderrBuffer.indexOf("\n")) >= 0) {
          const line = stderrBuffer.slice(0, index);
          stderrBuffer = stderrBuffer.slice(index + 1);
          handleStderrLine(line);
        }
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (stderrBuffer.length > 0) handleStderrLine(stderrBuffer);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
    let result = null;
    try {
      result = JSON.parse(await readFile(join(workspace, "result.json"), "utf8"));
    } catch {
      try { result = JSON.parse(output.stdout); } catch { result = null; }
    }
    return { ...output, result };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "dsh-headless", activeTasks, maxConcurrent: MAX_CONCURRENT }));
    return;
  }

  const isRun = request.method === "POST" && (request.url === "/run" || request.url === "/run/stream");
  if (isRun === false) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (activeTasks >= MAX_CONCURRENT) {
    response.writeHead(429, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "dsh service busy" }));
    return;
  }

  activeTasks += 1;
  try {
    if (request.url === "/run/stream") {
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      });
      if (typeof response.flushHeaders === "function") response.flushHeaders();
      const send = (event) => {
        try {
          if (response.writableEnded === false) response.write(JSON.stringify(event) + "\n");
        } catch {
          // 客户端断开时忽略后续事件。
        }
      };
      try {
        const body = JSON.parse((await readBody(request)) || "{}");
        send({ type: "progress", text: "ai 正在阅读团本并思考…" });
        const output = await runTask(body, (line) => {
          const text = reasoningTextFromLine(line);
          if (text !== null) send({ type: "thinking", text });
        });
        send({ type: "progress", text: "正在整理修改结果…" });
        send({ type: "result", exitCode: output.exitCode, stdout: output.stdout, stderr: output.stderr, result: output.result });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "dsh failed" });
      } finally {
        response.end();
      }
      return;
    }

    const body = JSON.parse((await readBody(request)) || "{}");
    const output = await runTask(body);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(output));
  } catch (error) {
    if (response.headersSent === false) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "dsh failed" }));
    } else {
      response.end(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "dsh failed" }) + "\n");
    }
  } finally {
    activeTasks -= 1;
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("dsh headless service listening on " + String(PORT));
});
