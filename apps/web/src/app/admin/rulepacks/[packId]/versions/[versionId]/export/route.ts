import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: { packId: string; versionId: string } }
): Promise<NextResponse> {
  const session = await auth();
  if (session === null) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ ok: false, error: "无权访问" }, { status: 403 });

  const version = await prisma.rulePackVersion.findUnique({
    where: { id: context.params.versionId },
    include: { pack: { select: { id: true, slug: true, name: true } } }
  });
  if (version === null || version.pack.id !== context.params.packId) {
    return NextResponse.json({ ok: false, error: "版本不存在" }, { status: 404 });
  }

  const filename = version.pack.slug + "-" + version.version.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json";
  return new NextResponse(JSON.stringify(version.config, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"" + filename + "\""
    }
  });
}
