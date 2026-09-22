import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { getModuleDshSetting, isUserInModuleDshWhitelist } from "@/server/dsh/access";
import { isDshConfigured } from "@/server/dsh/runner";
import { runDshTurn } from "@/server/dsh/turn";
import type { DshHistoryMessage } from "@/server/dsh/types";

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

/**
 * dsh 统一执行入口（NDJSON 流）。
 *
 * 请求体：{ skillId?: string | null, pathname: string, message: string, history?: [] }
 * skillId 为空时使用当前场景的默认技能（通用助手）。
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (session === null) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });

  const setting = await getModuleDshSetting();
  if (setting.enabled === false || isUserInModuleDshWhitelist(session.user, setting) === false) {
    return NextResponse.json({ ok: false, error: "当前账号没有使用 ai 助手的权限" }, { status: 403 });
  }
  if (isDshConfigured() === false) {
    return NextResponse.json({ ok: false, error: "服务器未配置 ai 助手服务" }, { status: 503 });
  }

  let body: { readonly message?: unknown; readonly history?: unknown; readonly pathname?: unknown; readonly skillId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式不正确" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (message.length === 0) return NextResponse.json({ ok: false, error: "请输入内容" }, { status: 400 });
  const pathname = typeof body.pathname === "string" ? body.pathname.trim().slice(0, 400) : "/";
  const skillId = typeof body.skillId === "string" ? body.skillId.trim().slice(0, 80) : null;
  const history = parseHistory(body.history);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown): void => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // 客户端断开时忽略后续事件。
        }
      };
      try {
        const result = await runDshTurn(
          {
            pathname,
            userId: session.user.id,
            username: session.user.username,
            role: session.user.role,
            skillId,
            message,
            history
          },
          { onEvent: send }
        );
        if (result.ok) {
          send({ type: "final", reply: result.reply, version: result.version ?? null, skillId: result.skillId ?? null });
        } else {
          send({ type: "error", error: result.error ?? "ai 助手执行失败" });
        }
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "ai 助手执行失败" });
      } finally {
        try {
          controller.close();
        } catch {
          // 流可能已被客户端取消。
        }
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}
