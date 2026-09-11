import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { DEEPSEEK_MODELS, isDeepSeekConfigured } from "@/server/ai/deepseek";
import { importModuleWithDeepSeek } from "@/server/ai/module-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILES = 40;

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  if (isDeepSeekConfigured() === false) {
    return NextResponse.json(
      { ok: false, error: "未配置 DEEPSEEK_API_KEY，管理员请在 apps/web/.env 中配置后重启服务" },
      { status: 400 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式不合法" }, { status: 400 });
  }

  const roomId = String(form.get("roomId") ?? "").trim();
  if (roomId.length > 0) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      select: { role: true }
    });
    if (membership === null || membership.role !== "KP") {
      return NextResponse.json({ ok: false, error: "只有本房 KP 可以导入房间团本" }, { status: 403 });
    }
  }

  const uploads = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  const single = form.get("file");
  const files = uploads.length > 0 ? uploads : single instanceof File && single.size > 0 ? [single] : [];
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "请至少上传一个素材文件" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ ok: false, error: "单次最多上传 " + MAX_FILES + " 个文件" }, { status: 413 });
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > 150 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "单次上传总大小不能超过 150MB" }, { status: 413 });
  }

  const systemRaw = String(form.get("system") ?? "AUTO").toUpperCase();
  const system = systemRaw === "COC7" || systemRaw === "TOUHOU" ? systemRaw : "AUTO";
  const era = String(form.get("era") ?? "MODERN").trim().slice(0, 40) || "MODERN";
  const instructions = String(form.get("instructions") ?? "").trim().slice(0, 4000);
  const modelRaw = String(form.get("model") ?? "").trim();
  const model = DEEPSEEK_MODELS.some((item) => item.id === modelRaw) ? modelRaw : "";

  try {
    const result = await importModuleWithDeepSeek({
      files,
      roomId,
      userId: session.user.id,
      author: session.user.name ?? session.user.username,
      requestedSystem: system,
      requestedEra: era,
      instructions,
      requestedModel: model
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "AI 整合失败"
      },
      { status: 400 }
    );
  }
}
