// dsh 极简模式（headless）旁车服务：POST /run { task, files, timeoutMs }
// 返回 { exitCode, stdout, stderr, result }；思维链只在 stderr，不会返回给业务前端。
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

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString("utf8"); });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function runTask(input) {
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
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
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
  if (request.method !== "POST" || request.url !== "/run") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  try {
    const body = JSON.parse((await readBody(request)) || "{}");
    const output = await runTask(body);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(output));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "dsh failed" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("dsh headless service listening on " + String(PORT));
});
