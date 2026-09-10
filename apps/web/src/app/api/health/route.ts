import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 存活/就绪探针。SAE 用这个做健康检查，GitHub Actions 也可以用它做部署后验证。
 * 真正 ping 一次数据库，避免「进程活着但连不上 RDS」被误判为健康。
 */
export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      db: "up",
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        db: "down",
        message: error instanceof Error ? error.message : "unknown"
      },
      { status: 503 }
    );
  }
}
