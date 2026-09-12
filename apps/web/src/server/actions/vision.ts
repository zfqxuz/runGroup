"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { emitRoomRefresh } from "@/server/realtime";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeReturnTo(roomId: string, raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "").trim();
  if (value.startsWith("/rooms/" + roomId) && value.startsWith("//") === false) return value;
  return "/rooms/" + roomId;
}

/** 玩家选项：与同房间成员共享战争视野（按双向并集处理，关闭时双向一起解除）。 */
export async function toggleVisionShareAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 64);
  const targetUserId = clean(formData.get("targetUserId"), 64);
  const returnTo = safeReturnTo(roomId, formData.get("returnTo"));
  if (roomId.length === 0 || targetUserId.length === 0 || targetUserId === session.user.id) {
    redirect("/rooms/" + roomId);
  }

  const [mine, target] = await Promise.all([
    prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      select: { userId: true }
    }),
    prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      select: { userId: true }
    })
  ]);
  if (mine === null || target === null) redirect("/rooms/" + roomId);

  const existing = await prisma.roomVisionShare.findFirst({
    where: {
      roomId,
      OR: [
        { userId: session.user.id, targetUserId },
        { userId: targetUserId, targetUserId: session.user.id }
      ]
    },
    select: { id: true }
  });

  if (existing === null) {
    await prisma.roomVisionShare.createMany({
      data: [
        { roomId, userId: session.user.id, targetUserId },
        { roomId, userId: targetUserId, targetUserId: session.user.id }
      ],
      skipDuplicates: true
    });
  } else {
    await prisma.roomVisionShare.deleteMany({
      where: {
        roomId,
        OR: [
          { userId: session.user.id, targetUserId },
          { userId: targetUserId, targetUserId: session.user.id }
        ]
      }
    });
  }

  revalidatePath("/rooms/" + roomId);
  emitRoomRefresh(roomId, "vision-share");
  redirect(returnTo);
}
