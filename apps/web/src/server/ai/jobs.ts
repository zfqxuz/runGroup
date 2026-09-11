import { randomUUID } from "node:crypto";
import { importModuleWithDeepSeek, type AiImportResult } from "@/server/ai/module-import";

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

interface AiImportJob {
  readonly id: string;
  readonly userId: string;
  status: AiImportJobStatus;
  progress: string[];
  error: string | null;
  result: AiImportResult | null;
  createdAt: string;
  updatedAt: string;
  touchedAt: number;
}

const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_JOBS = 200;
const MAX_PROGRESS_LINES = 40;
const jobs = new Map<string, AiImportJob>();

function touch(job: AiImportJob): void {
  job.updatedAt = new Date().toISOString();
  job.touchedAt = Date.now();
}

function prune(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.touchedAt > JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size <= MAX_JOBS) return;
  const ordered = [...jobs.values()].sort((a, b) => a.touchedAt - b.touchedAt);
  for (const job of ordered) {
    if (jobs.size <= MAX_JOBS) break;
    if (job.status !== "RUNNING") jobs.delete(job.id);
  }
}

export function startAiImportJob(input: StartAiImportJobInput): string {
  prune();
  const id = randomUUID();
  const now = new Date().toISOString();
  const job: AiImportJob = {
    id,
    userId: input.userId,
    status: "RUNNING",
    progress: ["任务已创建，正在解析素材…"],
    error: null,
    result: null,
    createdAt: now,
    updatedAt: now,
    touchedAt: Date.now()
  };
  jobs.set(id, job);
  void runJob(job, input);
  return id;
}

async function runJob(job: AiImportJob, input: StartAiImportJobInput): Promise<void> {
  try {
    const result = await importModuleWithDeepSeek({
      files: input.files,
      roomId: input.roomId,
      userId: input.userId,
      author: input.author,
      requestedSystem: input.requestedSystem,
      requestedEra: input.requestedEra,
      instructions: input.instructions,
      requestedModel: input.requestedModel,
      onProgress: (message) => {
        job.progress.push(message);
        if (job.progress.length > MAX_PROGRESS_LINES) {
          job.progress.splice(0, job.progress.length - MAX_PROGRESS_LINES);
        }
        touch(job);
      }
    });
    job.status = "DONE";
    job.result = result;
    job.progress.push("团本生成完成");
    touch(job);
  } catch (error) {
    job.status = "FAILED";
    job.error = error instanceof Error ? error.message : "AI 整合失败";
    job.progress.push("任务失败");
    touch(job);
  }
}

export function getAiImportJob(id: string, userId: string): AiImportJobView | null {
  const job = jobs.get(id);
  if (job === undefined || job.userId !== userId) return null;
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
