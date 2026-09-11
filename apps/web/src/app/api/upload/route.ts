import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES, publicPath, storeImage } from "@/server/assets/storage";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_TYPES = ["PORTRAIT", "AVATAR", "TOKEN", "CARD_ART", "SCENE_BG", "MAP"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

function isAllowed(value: string): value is AllowedType {
  return (ALLOWED_TYPES as readonly string[]).includes(value);
}

export async function POST(request: Request): Promise<NextResponse> {
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

  const file = form.get("file");
  const typeRaw = String(form.get("type") ?? "CARD_ART").toUpperCase();

  if ((file instanceof File) === false) {
    return NextResponse.json({ ok: false, error: "没有收到文件" }, { status: 400 });
  }
  if (isAllowed(typeRaw) === false) {
    return NextResponse.json({ ok: false, error: "不支持的上传用途" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: "文件超过 " + Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024) + " MB" },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const category = typeRaw.toLowerCase();

  let stored;
  try {
    stored = await storeImage(buffer, { category });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "处理失败" },
      { status: 400 }
    );
  }

  const asset = await prisma.asset.create({
    data: {
      ownerId: session.user.id,
      type: typeRaw,
      filename: stored.filename,
      // 原始文件名只做展示，永远不参与路径拼接
      originalName: file.name.slice(0, 120),
      mimeType: stored.mime,
      size: stored.size,
      width: stored.width,
      height: stored.height,
      url: publicPath(category, stored.filename),
      thumbnailUrl: publicPath(category, stored.thumbnailName),
      checksum: stored.checksum
    },
    select: { id: true, url: true, thumbnailUrl: true, width: true, height: true }
  });

  return NextResponse.json({ ok: true, asset });
}
