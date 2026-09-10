import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { issueTicket } from "@/server/socket/ticket";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 签发 60 秒有效的 Socket 一次性票据。
 * 客户端在建立 Socket 连接前调用，把票据放进 handshake.auth。
 */
export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ticket: issueTicket(session.user.id) });
}
