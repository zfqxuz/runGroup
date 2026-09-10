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

  const roomId = String(form.get("roomId") ?? "").trim();
  const moduleAssetId = String(form.get("moduleAssetId") ?? "");
  const existing = await prisma.moduleAsset.findUnique({
    where: { id: moduleAssetId },
    include: { module: true, asset: true }
  });
  if (existing === null || existing.moduleId !== context.params.moduleId) {
    return NextResponse.json({ ok: false, error: "资源不存在" }, { status: 404 });
  }
  if (roomId.length > 0) {
    if (existing.module.roomId !== roomId || (await requireKp(roomId, session.user.id)) === false) {
      return NextResponse.json({ ok: false, error: "只有本房 KP 可以替换团本资源" }, { status: 403 });
    }
  } else if (existing.module.ownerId !== session.user.id) {
    return NextResponse.json({ ok: false, error: "只有团本作者可以替换资源" }, { status: 403 });
  }

  const file = form.get("file");
  if (file === null || typeof file !== "object" || !("arrayBuffer" in file)) {
    return NextResponse.json({ ok: false, error: "请选择替换文件" }, { status: 400 });
  }
  const upload = file as File;
  const ext = extensionOf(upload.name);
  if (ext === null) {
    return NextResponse.json({ ok: false, error: "不支持的文件格式" }, { status: 400 });
  }
  if (upload.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ ok: false, error: "资源超过 20MB 上限" }, { status: 413 });
  }

  const buffer = Buffer.from(await upload.arrayBuffer());
  try {
    let assetId: string;
    if (IMAGE_EXTENSIONS.has(ext)) {
      const stored = await storeImage(buffer, { category: "modules", maxBytes: MAX_ASSET_BYTES });
      const created = await prisma.asset.create({
        data: {
          ownerId: session.user.id,
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
          metadata: {
            ...(existing.asset.metadata as Record<string, unknown>),
            moduleId: existing.moduleId,
            relativePath: existing.relativePath,
            kind: existing.kind
          }
        },
        select: { id: true }
      });
      assetId = created.id;
    } else {
      const stored = await storeRawFile(buffer, {
        category: "modules",
        extension: ext,
        maxBytes: MAX_ASSET_BYTES
      });
      const created = await prisma.asset.create({
        data: {
          ownerId: session.user.id,
          type: "OTHER",
          filename: stored.filename,
          originalName: upload.name.slice(0, 200),
          mimeType: stored.mime,
          size: stored.size,
          url: publicPath("modules", stored.filename),
          checksum: stored.checksum,
          metadata: {
            ...(existing.asset.metadata as Record<string, unknown>),
            moduleId: existing.moduleId,
            relativePath: existing.relativePath,
            kind: existing.kind
          }
        },
        select: { id: true }
      });
      assetId = created.id;
    }

    await prisma.moduleAsset.update({
      where: { id: existing.id },
      data: { assetId, originalName: upload.name.slice(0, 200) }
    });
    await deleteAssetIfOrphan(existing.assetId);

    return NextResponse.json({ ok: true, assetId });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "资源替换失败" },
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
