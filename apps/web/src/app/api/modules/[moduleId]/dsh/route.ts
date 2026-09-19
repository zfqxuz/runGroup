import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { getModuleDshSetting, isUserInModuleDshWhitelist } from "@/server/dsh/access";
import { isDshConfigured } from "@/server/dsh/runner";
import { runModuleDshTurn, type DshHistoryMessage } from "@/server/dsh/module-assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseHistory(value: unknown): DshHistoryMessage[] {
  if (Array.isArray(value) === false) return [];
  const output: DshHistoryMessage[] = [];
  for (const item of value.slice(-20)) {
    if (item === null || typeof item !== "object") continue;
    const record = item as { role?: unknown; content?: unknown };
    const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
    const content = typeof record.content === "string" ? record.content.trim().slice(0, 4000) : "";
    if (role === null || content.length === 0) continue;
    output.push({ role, content });
  }
  return output;
}

export async function POST(
  request: Request,
  context: { readonly params: { readonly moduleId: string } }
): Promise<NextResponse> {
  const session = await auth();
  if (session === null) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });

  const setting = await getModuleDshSetting();
  if (setting.enabled === false || isUserInModuleDshWhitelist(session.user, setting) === false) {
    return NextResponse.json({ ok: false, error: "当前账号没有使用团本助手的权限" }, { status: 403 });
  }
  if (isDshConfigured() === false) {
    return NextResponse.json({ ok: false, error: "服务器未配置 ai团本助手服务" }, { status: 503 });
  }

  const moduleRecord = await prisma.module.findUnique({
    where: { id: context.params.moduleId },
    select: { id: true, ownerId: true, roomId: true }
  });
  if (moduleRecord === null) return NextResponse.json({ ok: false, error: "团本不存在" }, { status: 404 });

  let canEdit = moduleRecord.ownerId === session.user.id;
  if (canEdit === false && moduleRecord.ownerId === null && moduleRecord.roomId !== null) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: moduleRecord.roomId, userId: session.user.id } },
      select: { role: true }
    });
    canEdit = membership?.role === "KP";
  }
  if (canEdit === false) {
    return NextResponse.json({ ok: false, error: "只有团本作者或房间 KP 可以使用团本助手" }, { status: 403 });
  }

  let body: { readonly message?: unknown; readonly history?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式不正确" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (message.length === 0) return NextResponse.json({ ok: false, error: "请输入修改意见" }, { status: 400 });

  const result = await runModuleDshTurn({
    moduleId: moduleRecord.id,
    userId: session.user.id,
    message,
    history: parseHistory(body.history)
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
