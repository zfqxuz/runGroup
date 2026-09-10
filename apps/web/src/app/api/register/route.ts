import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";

const registerSchema = z.object({
  username: z
    .string()
    .min(3, "用户名至少 3 个字符")
    .max(32, "用户名最多 32 个字符")
    .regex(/^[a-zA-Z0-9_-]+$/, "只能包含字母、数字、下划线和连字符"),
  displayName: z.string().min(1).max(32).optional(),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码最多 72 位")
});

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (parsed.success === false) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 }
    );
  }

  const { username, displayName, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing !== null) {
    return NextResponse.json({ ok: false, error: "用户名已被占用" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      username,
      displayName: displayName ?? username,
      passwordHash
    },
    select: { id: true, username: true, displayName: true }
  });

  return NextResponse.json({ ok: true, user }, { status: 201 });
}
