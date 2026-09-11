import { NextResponse } from "next/server";
import { deleteAssetIfOrphan } from "@/server/assets/cleanup";
import { extensionOf, publicPath, storeImage, storeRawFile } from "@/server/assets/storage";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

async function requireKp(roomId: string, userId: string): Promise<boolean> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
  return membership !== null && membership.role === "KP";
}

const KIND_DIRECTORY: Record<string, string> = {
  IMAGE: "images",
  MAP: "maps",
  HANDOUT: "handouts",
  AUDIO: "audio",
  VIDEO: "video",
  OTHER: "files"
};

function normalizeKind(value: unknown, ext: string): string {
  const raw = String(value ?? "").trim().toUpperCase();
  if (KIND_DIRECTORY[raw] !== undefined) return raw;
  return IMAGE_EXTENSIONS.has(ext) ? "IMAGE" : "FILE";
}

async function storeUpload(
  upload: File,
  ext: string,
  userId: string,
  metadata: Record<string, unknown>
): Promise<{ assetId: string; filename: string; url: string; thumbnailUrl: string | null }> {
  const buffer = Buffer.from(await upload.arrayBuffer());
  if (IMAGE_EXTENSIONS.has(ext)) {
    const stored = await storeImage(buffer, { category: "modules", maxBytes: MAX_ASSET_BYTES });
    const created = await prisma.asset.create({
      data: {
        ownerId: userId,
        type: "OTHER",
        filename: stored.filename,
        originalName: upload.name.slice(0, 200),
        mimeType: stored.mime,
        size: stored.size,
        width: stored.width,
        height: stored.height,
        url: publicPath("modules", stored.filename),
        thumbnailUrl: publicPath("modules", stored.thumbnailName),
        checksum: stored.checksum,
        metadata: metadata as never
      },
      select: { id: true, url: true, thumbnailUrl: true }
    });
    return { assetId: created.id, filename: stored.filename, url: created.url, thumbnailUrl: created.thumbnailUrl };
  }
  const stored = await storeRawFile(buffer, {
    category: "modules",
    extension: ext,
    maxBytes: MAX_ASSET_BYTES
  });
  const created = await prisma.asset.create({
    data: {
      ownerId: userId,
      type: "OTHER",
      filename: stored.filename,
      originalName: upload.name.slice(0, 200),
      mimeType: stored.mime,
      size: stored.size,
      url: publicPath("modules", stored.filename),
      checksum: stored.checksum,
      metadata: metadata as never
    },
    select: { id: true, url: true, thumbnailUrl: true }
  });
  return { assetId: created.id, filename: stored.filename, url: created.url, thumbnailUrl: created.thumbnailUrl };
}

export async function POST(
  request: Request,
  context: { params: { moduleId: string } }
): Promise<NextResponse> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式不合法" }, { status: 400 });
  }

  const moduleRecord = await prisma.module.findUnique({
    where: { id: context.params.moduleId },
    select: { id: true, roomId: true, ownerId: true, slug: true, title: true }
  });
  if (moduleRecord === null) {
    return NextResponse.json({ ok: false, error: "团本不存在" }, { status: 404 });
  }

  const roomId = String(form.get("roomId") ?? "").trim();
  const moduleAssetId = String(form.get("moduleAssetId") ?? "");
  const isOwner = moduleRecord.ownerId === session.user.id;
  const isRoomKp = roomId.length > 0 && moduleRecord.roomId === roomId && (await requireKp(roomId, session.user.id));
  if (isOwner === false && isRoomKp === false) {
    return NextResponse.json({ ok: false, error: "只有团本作者或本房 KP 可以上传资源" }, { status: 403 });
  }

  const file = form.get("file");
  if (file === null || typeof file !== "object" || !("arrayBuffer" in file)) {
    return NextResponse.json({ ok: false, error: "请选择上传文件" }, { status: 400 });
  }
  const upload = file as File;
  const ext = extensionOf(upload.name);
  if (ext === null) {
    return NextResponse.json({ ok: false, error: "不支持的文件格式" }, { status: 400 });
  }
  if (upload.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ ok: false, error: "资源超过 20MB 上限" }, { status: 413 });
  }

  try {
    if (moduleAssetId.length > 0) {
      const existing = await prisma.moduleAsset.findUnique({
        where: { id: moduleAssetId },
        include: { module: true, asset: true }
      });
      if (existing === null || existing.moduleId !== moduleRecord.id) {
        return NextResponse.json({ ok: false, error: "资源不存在" }, { status: 404 });
      }
      if (isOwner === false && !(roomId.length > 0 && existing.module.roomId === roomId && isRoomKp)) {
        return NextResponse.json({ ok: false, error: "只有团本作者或本房 KP 可以替换资源" }, { status: 403 });
      }
      const stored = await storeUpload(upload, ext, session.user.id, {
        ...(existing.asset.metadata as Record<string, unknown>),
        moduleId: existing.moduleId,
        relativePath: existing.relativePath,
        kind: existing.kind
      });
      await prisma.moduleAsset.update({
        where: { id: existing.id },
        data: { assetId: stored.assetId, originalName: upload.name.slice(0, 200) }
      });
      await deleteAssetIfOrphan(existing.assetId);
      return NextResponse.json({
        ok: true,
        moduleAssetId: existing.id,
        relativePath: existing.relativePath,
        url: stored.url,
        thumbnailUrl: stored.thumbnailUrl
      });
    }

    const kind = normalizeKind(form.get("kind"), ext);
    const directory = KIND_DIRECTORY[kind] ?? "files";
    const moduleDir = (moduleRecord.slug ?? "module").replace(/[^a-z0-9._-]+/gi, "-") || "module";
    const stored = await storeUpload(upload, ext, session.user.id, { moduleId: moduleRecord.id, kind });
    const relativePath = "assets/" + directory + "/" + moduleDir + "/" + stored.filename;
    const maxOrder = await prisma.moduleAsset.aggregate({
      where: { moduleId: moduleRecord.id },
      _max: { orderIndex: true }
    });
    const created = await prisma.moduleAsset.create({
      data: {
        moduleId: moduleRecord.id,
        assetId: stored.assetId,
        relativePath,
        originalName: upload.name.slice(0, 200),
        kind,
        orderIndex: (maxOrder._max.orderIndex ?? 0) + 1
      },
      select: { id: true }
    });
    return NextResponse.json({
      ok: true,
      moduleAssetId: created.id,
      relativePath,
      url: stored.url,
      thumbnailUrl: stored.thumbnailUrl
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "资源上传失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: { moduleId: string } }
): Promise<NextResponse> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  let payload: { roomId?: unknown; moduleAssetId?: unknown };
  try {
    payload = (await request.json()) as { roomId?: unknown; moduleAssetId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式不合法" }, { status: 400 });
  }
  const roomId = typeof payload.roomId === "string" ? payload.roomId.trim() : "";
  const moduleAssetId = typeof payload.moduleAssetId === "string" ? payload.moduleAssetId : "";
  const existing = await prisma.moduleAsset.findUnique({
    where: { id: moduleAssetId },
    include: { module: true }
  });
  if (existing === null || existing.moduleId !== context.params.moduleId) {
    return NextResponse.json({ ok: false, error: "资源不存在" }, { status: 404 });
  }
  if (roomId.length > 0) {
    if (existing.module.roomId !== roomId || (await requireKp(roomId, session.user.id)) === false) {
      return NextResponse.json({ ok: false, error: "只有本房 KP 可以删除团本资源" }, { status: 403 });
    }
  } else if (existing.module.ownerId !== session.user.id) {
    return NextResponse.json({ ok: false, error: "只有团本作者可以删除资源" }, { status: 403 });
  }

  await prisma.moduleAsset.delete({ where: { id: existing.id } });
  await deleteAssetIfOrphan(existing.assetId);
  return NextResponse.json({ ok: true });
}
