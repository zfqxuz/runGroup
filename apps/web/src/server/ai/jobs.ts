import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { uploadRoot } from "@/server/assets/storage";
import type { AiImportResult } from "@/server/ai/module-import";

export type AiImportJobStatus = "RUNNING" | "DONE" | "FAILED";

export interface AiImportJobView {
  readonly id: string;
  readonly status: AiImportJobStatus;
  readonly progress: readonly string[];
  readonly error: string | null;
  readonly result: AiImportResult | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StartAiImportJobInput {
  readonly files: readonly File[];
  readonly roomId: string;
  readonly userId: string;
  readonly author: string;
  readonly requestedSystem: "COC7" | "TOUHOU" | "AUTO";
  readonly requestedEra: string;
  readonly instructions: string;
  readonly requestedModel: string;
}

export interface AiImportStoredFile {
  readonly id: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface AiImportJobParams {
  readonly roomId: string;
  readonly author: string;
  readonly requestedSystem: "COC7" | "TOUHOU" | "AUTO";
  readonly requestedEra: string;
  readonly instructions: string;
  readonly requestedModel: string;
}

/**
 * 磁盘上的任务状态。
 *
 * AI 导入可能运行几十分钟。之前任务只存在 dev server 进程内存里，
 * tsx watch / Next dev 一重启就会丢任务，前端轮询只能拿到 404。
 * 现在把状态和上传素材落到 uploadRoot/ai-jobs/<jobId>/，
 * 真正执行导入的 worker 用 detached 子进程运行，服务器重启也不会杀掉任务。
 */
export interface AiImportStoredJob {
  readonly id: string;
  readonly userId: string;
  status: AiImportJobStatus;
  progress: string[];
  error: string | null;
  result: AiImportResult | null;
  readonly params: AiImportJobParams;
  readonly files: readonly AiImportStoredFile[];
  workerPid: number | null;
  readonly createdAt: string;
  updatedAt: string;
}

const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_JOBS = 200;
const MAX_PROGRESS_LINES = 40;
const RUNNING_STALE_MS = 60 * 60 * 1000;
const SAFE_JOB_ID = /^[a-f0-9-]{36}$/i;

function jobRoot(): string {
  return path.join(uploadRoot(), "ai-jobs");
}

export function aiImportJobDir(jobId: string): string {
  return path.join(jobRoot(), jobId);
}

export function aiImportJobFilesDir(jobId: string): string {
  return path.join(aiImportJobDir(jobId), "files");
}

function jobJsonPath(jobId: string): string {
  return path.join(aiImportJobDir(jobId), "job.json");
}

function isSafeJobId(jobId: string): boolean {
  return SAFE_JOB_ID.test(jobId);
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringOf(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function progressOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(-MAX_PROGRESS_LINES)
    : [];
}

function storedFilesOf(value: unknown): AiImportStoredFile[] {
  if (Array.isArray(value) === false) return [];
  const files: AiImportStoredFile[] = [];
  for (const item of value) {
    const record = recordOf(item);
    const id = stringOf(record.id);
    if (id.length === 0) continue;
    files.push({
      id,
      originalName: stringOf(record.originalName, "material"),
      mimeType: stringOf(record.mimeType, "application/octet-stream"),
      size: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0
    });
  }
  return files;
}

function paramsOf(value: unknown): AiImportJobParams {
  const record = recordOf(value);
  const system = stringOf(record.requestedSystem, "AUTO");
  return {
    roomId: stringOf(record.roomId),
    author: stringOf(record.author),
    requestedSystem: system === "COC7" || system === "TOUHOU" ? system : "AUTO",
    requestedEra: stringOf(record.requestedEra, "MODERN"),
    instructions: stringOf(record.instructions),
    requestedModel: stringOf(record.requestedModel)
  };
}

async function writeAiImportJob(job: AiImportStoredJob): Promise<void> {
  const dir = aiImportJobDir(job.id);
  await mkdir(dir, { recursive: true });
  const target = jobJsonPath(job.id);
  const temp = target + ".tmp";
  await writeFile(temp, JSON.stringify(job), "utf8");
  await rename(temp, target);
}

export { writeAiImportJob };

export async function readAiImportJob(jobId: string): Promise<AiImportStoredJob | null> {
  if (isSafeJobId(jobId) === false) return null;
  try {
    const raw = await readFile(jobJsonPath(jobId), "utf8");
    const parsed = recordOf(JSON.parse(raw) as unknown);
    if (stringOf(parsed.id) !== jobId) return null;
    const status = stringOf(parsed.status, "RUNNING");
    if (status !== "RUNNING" && status !== "DONE" && status !== "FAILED") return null;
    const userId = stringOf(parsed.userId);
    if (userId.length === 0) return null;
    return {
      id: jobId,
      userId,
      status,
      progress: progressOf(parsed.progress),
      error: typeof parsed.error === "string" ? parsed.error : null,
      result: (parsed.result ?? null) as AiImportResult | null,
      params: paramsOf(parsed.params),
      files: storedFilesOf(parsed.files),
      workerPid: typeof parsed.workerPid === "number" && Number.isFinite(parsed.workerPid) ? parsed.workerPid : null,
      createdAt: stringOf(parsed.createdAt, new Date().toISOString()),
      updatedAt: stringOf(parsed.updatedAt, new Date().toISOString())
    };
  } catch {
    return null;
  }
}

async function pruneJobs(): Promise<void> {
  const root = jobRoot();
  await mkdir(root, { recursive: true }).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const records: { name: string; mtime: number }[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() === false) continue;
    const info = await stat(path.join(root, entry.name)).catch(() => null);
    if (info !== null) records.push({ name: entry.name, mtime: info.mtimeMs });
  }
  records.sort((a, b) => b.mtime - a.mtime);
  for (const record of records) {
    const expired = Date.now() - record.mtime > JOB_TTL_MS;
    const tooMany = records.indexOf(record) >= MAX_JOBS;
    if (expired || tooMany) {
      await rm(path.join(root, record.name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function markFailed(jobId: string, message: string): Promise<void> {
  const job = await readAiImportJob(jobId);
  if (job === null || job.status !== "RUNNING") return;
  job.status = "FAILED";
  job.error = message;
  job.workerPid = null;
  job.progress.push(message);
  if (job.progress.length > MAX_PROGRESS_LINES) job.progress.splice(0, job.progress.length - MAX_PROGRESS_LINES);
  job.updatedAt = new Date().toISOString();
  await writeAiImportJob(job).catch(() => undefined);
}

function workerScriptPath(): string | null {
  const candidates = [
    path.join(process.cwd(), "scripts", "ai-import-worker.ts"),
    path.resolve(process.cwd(), "apps", "web", "scripts", "ai-import-worker.ts")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function startAiImportJob(input: StartAiImportJobInput): Promise<string> {
  await pruneJobs();

  const id = randomUUID();
  const now = new Date().toISOString();
  const filesDir = aiImportJobFilesDir(id);
  await mkdir(filesDir, { recursive: true });

  const storedFiles: AiImportStoredFile[] = [];
  for (const file of input.files) {
    const fileId = randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(filesDir, fileId), buffer);
    storedFiles.push({
      id: fileId,
      originalName: file.name.slice(0, 200) || "material",
      mimeType: file.type || "application/octet-stream",
      size: buffer.byteLength
    });
  }

  const job: AiImportStoredJob = {
    id,
    userId: input.userId,
    status: "RUNNING",
    progress: ["任务已创建，正在解析素材…"],
    error: null,
    result: null,
    params: {
      roomId: input.roomId,
      author: input.author,
      requestedSystem: input.requestedSystem,
      requestedEra: input.requestedEra,
      instructions: input.instructions,
      requestedModel: input.requestedModel
    },
    files: storedFiles,
    workerPid: null,
    createdAt: now,
    updatedAt: now
  };
  await writeAiImportJob(job);

  const workerPath = workerScriptPath();
  if (workerPath === null) {
    await markFailed(id, "找不到 AI 导入后台 worker 脚本，请检查部署目录是否完整");
    return id;
  }

  try {
    const child = spawn(process.execPath, ["--import", "tsx", workerPath, id], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore"
    });
    child.on("error", () => {
      void markFailed(id, "AI 后台任务进程启动失败");
    });
    child.on("exit", (code, signal) => {
      if (code !== 0) {
        const reason = signal === null || signal === undefined ? "code " + String(code) : "signal " + String(signal);
        void markFailed(id, "AI 后台任务进程异常退出（" + reason + "）");
      }
    });
    child.unref();
  } catch (error) {
    await markFailed(id, error instanceof Error ? error.message : "AI 后台任务进程启动失败");
  }

  return id;
}

export async function getAiImportJob(jobId: string, userId: string): Promise<AiImportJobView | null> {
  const initial = await readAiImportJob(jobId);
  if (initial === null || initial.userId !== userId) return null;

  let job = initial;
  if (job.status === "RUNNING") {
    const workerGone =
      job.workerPid !== null
        ? isProcessAlive(job.workerPid) === false
        : Date.now() - Date.parse(job.updatedAt) > RUNNING_STALE_MS;
    if (workerGone) {
      await markFailed(jobId, "AI 后台任务已中断（服务重启或 worker 退出），请重新发起");
      job = (await readAiImportJob(jobId)) ?? job;
    }
  }

  return {
    id: job.id,
    status: job.status,
    progress: [...job.progress],
    error: job.error,
    result: job.result,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}
