/**
 * AI 团本导入后台 worker。
 *
 * 由 src/server/ai/jobs.ts 以 detached 子进程方式启动：
 *   node --import tsx scripts/ai-import-worker.ts <jobId>
 *
 * 任务参数、进度、结果和上传素材都保存在 uploadRoot/ai-jobs/<jobId>/，
 * dev server / tsx watch 重启不会杀掉这个进程。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { importModule } from "../src/server/ai/module-import";
import { prisma } from "../src/server/db/prisma";
import {
  aiImportJobFilesDir,
  readAiImportJob,
  writeAiImportJob,
  type AiImportStoredJob
} from "../src/server/ai/jobs";

const MAX_PROGRESS_LINES = 40;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "AI 整合失败";
}

async function main(): Promise<void> {
  const jobId = process.argv[2] ?? "";
  if (jobId.length === 0) {
    process.exitCode = 2;
    return;
  }

  const initial = await readAiImportJob(jobId);
  if (initial === null || initial.status !== "RUNNING") return;

  const job: AiImportStoredJob = {
    ...initial,
    workerPid: process.pid,
    updatedAt: new Date().toISOString()
  };

  let writeChain: Promise<void> = Promise.resolve();
  let progressDirty = false;
  function scheduleProgressWrite(): void {
    progressDirty = true;
    writeChain = writeChain.then(async () => {
      while (progressDirty) {
        progressDirty = false;
        await writeAiImportJob(job).catch(() => undefined);
      }
    });
  }

  try {
    await writeAiImportJob(job);
    const files: File[] = [];
    for (const meta of job.files) {
      const buffer = await readFile(path.join(aiImportJobFilesDir(job.id), meta.id));
      files.push(new File([new Uint8Array(buffer)], meta.originalName, { type: meta.mimeType }));
    }

    const result = await importModule({
      files,
      roomId: job.params.roomId,
      userId: job.userId,
      author: job.params.author,
      requestedSystem: job.params.requestedSystem,
      requestedEra: job.params.requestedEra,
      instructions: job.params.instructions,
      requestedModel: job.params.requestedModel,
      onProgress: (message) => {
        job.progress.push(message);
        if (job.progress.length > MAX_PROGRESS_LINES) {
          job.progress.splice(0, job.progress.length - MAX_PROGRESS_LINES);
        }
        job.updatedAt = new Date().toISOString();
        scheduleProgressWrite();
      }
    });

    await writeChain.catch(() => undefined);
    const current = await readAiImportJob(job.id);
    if (current !== null && current.status !== "RUNNING") {
      return;
    }

    job.status = "DONE";
    job.result = result;
    job.workerPid = null;
    job.progress.push("团本生成完成");
    if (job.progress.length > MAX_PROGRESS_LINES) {
      job.progress.splice(0, job.progress.length - MAX_PROGRESS_LINES);
    }
    job.updatedAt = new Date().toISOString();
    await writeAiImportJob(job);
  } catch (error) {
    await writeChain.catch(() => undefined);
    const message = errorMessage(error);
    job.status = "FAILED";
    job.error = message;
    job.workerPid = null;
    job.progress.push("任务失败");
    job.progress.push(message);
    if (job.progress.length > MAX_PROGRESS_LINES) {
      job.progress.splice(0, job.progress.length - MAX_PROGRESS_LINES);
    }
    job.updatedAt = new Date().toISOString();
    await writeAiImportJob(job).catch(() => undefined);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
