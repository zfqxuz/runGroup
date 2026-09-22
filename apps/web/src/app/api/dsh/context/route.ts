import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { getModuleDshSetting, isUserInModuleDshWhitelist } from "@/server/dsh/access";
import { isDshConfigured } from "@/server/dsh/runner";
import { resolveDshContext } from "@/server/dsh/context";
import { listSkillsForContext } from "@/server/dsh/skills/registry";

export const dynamic = "force-dynamic";

/**
 * 返回当前 pathname 对应的 dsh 上下文与可用技能，供全局悬浮球渲染。
 * 只做展示用解析；真正的权限校验在 POST /api/dsh/run 里重新执行。
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (session === null) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });

  const url = new URL(request.url);
  const pathname = (url.searchParams.get("pathname") ?? "/").slice(0, 400);

  const setting = await getModuleDshSetting();
  const whitelisted = isUserInModuleDshWhitelist(session.user, setting);
  const configured = isDshConfigured();

  const resolved = await resolveDshContext(pathname, {
    id: session.user.id,
    username: session.user.username,
    role: session.user.role
  });
  if (resolved.ok === false) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: 500 });
  }

  const context = resolved.context;
  const available = configured && whitelisted;
  const reason = configured === false
    ? "服务器未配置 ai 助手服务"
    : whitelisted === false
      ? "当前账号未开通 ai 助手"
      : null;

  return NextResponse.json({
    ok: true,
    configured,
    available,
    reason,
    context: {
      kind: context.kind,
      label: context.label,
      pathname: context.route.pathname,
      canEditModule: context.canEditModule,
      isKp: context.isKp
    },
    skills: whitelisted ? listSkillsForContext(context) : []
  });
}
