/**
 * 团本快照与进行中局资源保护 E2E：
 * 1. 开局前生成不可变快照。
 * 2. 团本资源被替换/删除时，只要本局还在进行，旧 Asset 必须保留。
 * 3. 本局结束后，旧 Asset 才允许清理，快照引用保留相对路径信息。
 */
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { deleteAssetIfOrphan } from "@/server/assets/cleanup";
import { uploadRoot } from "@/server/assets/storage";
import { ensureModuleRevision } from "@/server/modules/revision";

const prisma = new PrismaClient();

async function fileExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("E2E 断言失败：" + message);
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const username = "e2e_revision_" + suffix;
  let roomId: string | null = null;
  let revisionId: string | null = null;
  let assetId: string | null = null;
  let filePath: string | null = null;

  try {
    const owner = await prisma.user.create({
      data: { username, displayName: "快照测试", passwordHash: "not-a-real-password" },
      select: { id: true }
    });
    const room = await prisma.room.create({
      data: {
        name: "E2E 快照房",
        system: "COC7",
        ownerId: owner.id,
        inviteCode: "REV" + suffix.toUpperCase().slice(0, 8),
        members: { create: { userId: owner.id, role: "KP" } }
      },
      select: { id: true }
    });
    roomId = room.id;

    const moduleRecord = await prisma.module.create({
      data: {
        ownerId: owner.id,
        roomId: room.id,
        title: "E2E 快照团本",
        version: "1.0.0",
        content: { text: "## 元信息\n\nV1", sections: ["元信息"] } as never,
        metadata: {} as never,
        importReport: {} as never
      },
      select: { id: true }
    });

    const filename = "e2e-revision-" + suffix + ".png";
    const directory = path.join(uploadRoot(), "modules");
    await mkdir(directory, { recursive: true });
    filePath = path.join(directory, filename);
    await writeFile(filePath, Buffer.from([1, 2, 3]));

    const asset = await prisma.asset.create({
      data: {
        ownerId: owner.id,
        type: "OTHER",
        filename,
        originalName: filename,
        mimeType: "image/png",
        size: 3,
        url: "/api/assets/modules/" + filename,
        checksum: "e2e-revision-" + suffix,
        metadata: {} as never
      },
      select: { id: true }
    });
    assetId = asset.id;

    await prisma.moduleAsset.create({
      data: {
        moduleId: moduleRecord.id,
        assetId: asset.id,
        relativePath: "assets/images/" + filename,
        originalName: filename,
        kind: "IMAGE"
      }
    });

    const revision = await ensureModuleRevision(moduleRecord.id);
    if (revision === null) throw new Error("E2E 断言失败：生成快照失败");
    revisionId = revision.id;
    ensure(revision.version === "1.0.0", "快照版本应保留");

    const game = await prisma.game.create({
      data: {
        roomId: room.id,
        moduleId: moduleRecord.id,
        moduleRevisionId: revision.id,
        status: "PLAYING",
        title: "E2E 快照局",
        createdBy: owner.id
      },
      select: { id: true }
    });

    // 模拟进行中的局遇到团本资源替换：先移除 ModuleAsset 引用，再尝试清理旧 Asset。
    await prisma.moduleAsset.deleteMany({ where: { moduleId: moduleRecord.id } });
    const protectedResult = await deleteAssetIfOrphan(asset.id);
    ensure(protectedResult === false, "进行中局的快照资源不应被清理");
    ensure(await fileExists(filePath), "进行中局的资源文件应保留");

    await prisma.game.update({ where: { id: game.id }, data: { status: "ENDED", endedAt: new Date() } });
    const cleanedResult = await deleteAssetIfOrphan(asset.id);
    ensure(cleanedResult, "局结束后应允许清理旧资源");
    ensure((await fileExists(filePath)) === false, "局结束后资源文件应被删除");

    const assetAfter = await prisma.asset.findUnique({ where: { id: asset.id }, select: { id: true } });
    expectNull(assetAfter, "清理后 Asset 行应删除");
    assetId = null;

    const linkAfter = await prisma.moduleRevisionAsset.findFirst({
      where: { revisionId: revision.id, relativePath: "assets/images/" + filename },
      select: { assetId: true, relativePath: true }
    });
    if (linkAfter === null) throw new Error("E2E 断言失败：快照资源引用应保留");
    expectNull(linkAfter.assetId, "清理后快照资源引用的 assetId 应置空");

    console.log("PASS 团本快照 E2E：开局快照 / 进行中资源保护 / 结束后清理");
  } finally {
    if (filePath !== null) await rm(filePath, { force: true });
    if (revisionId !== null) await prisma.moduleRevision.deleteMany({ where: { id: revisionId } });
    if (roomId !== null) {
      await prisma.game.deleteMany({ where: { roomId } });
      await prisma.module.deleteMany({ where: { roomId } });
      await prisma.room.deleteMany({ where: { id: roomId } });
    }
    if (assetId !== null) await prisma.asset.deleteMany({ where: { id: assetId } });
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  }
}

function expectNull(value: unknown, message: string): void {
  if (value === null) return;
  throw new Error("E2E 断言失败：" + message + "，实际 " + JSON.stringify(value));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
