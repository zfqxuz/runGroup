"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { emitRoomRefresh } from "@/server/realtime";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function requireMembership(roomId: string, userId: string): Promise<{ role: string; status: string } | null> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true, room: { select: { status: true } } }
  });
  if (membership === null) return null;
  return { role: membership.role, status: membership.room.status };
}

function revalidateRoom(roomId: string): void {
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  emitRoomRefresh(roomId, "room-info");
}

export async function createClueAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const title = clean(formData.get("title"), 120);
  const content = clean(formData.get("content"), 5000);
  const isPublic = String(formData.get("isPublic") ?? "0") === "1";
  if (roomId.length === 0 || title.length === 0 || content.length === 0) {
    redirect("/rooms/" + roomId + "?clue=invalid");
  }

  const membership = await requireMembership(roomId, session.user.id);
  if (membership === null || membership.role !== "KP") {
    redirect("/rooms/" + roomId);
  }

  await prisma.clue.create({
    data: { roomId, title, content, isPublic }
  });
  revalidateRoom(roomId);
  redirect("/rooms/" + roomId + "?clue=created#room-info");
}

export async function discoverClueAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const clueId = clean(formData.get("clueId"), 64);
  const membership = await requireMembership(roomId, session.user.id);
  if (membership === null || clueId.length === 0) {
    redirect("/rooms/" + roomId);
  }

  const clue = await prisma.clue.findUnique({
    where: { id: clueId },
    select: { id: true, roomId: true }
  });
  if (clue === null || clue.roomId !== roomId) {
    redirect("/rooms/" + roomId);
  }

  await prisma.clueDiscovery.upsert({
    where: { clueId_userId: { clueId, userId: session.user.id } },
    update: {},
    create: { clueId, userId: session.user.id }
  });
  revalidateRoom(roomId);
  redirect("/rooms/" + roomId + "?clue=discovered#room-info");
}

export async function createNoteAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const title = clean(formData.get("title"), 120);
  const content = clean(formData.get("content"), 5000);
  const requestedKpOnly = String(formData.get("isKPOnly") ?? "0") === "1";
  if (roomId.length === 0 || title.length === 0 || content.length === 0) {
    redirect("/rooms/" + roomId + "?note=invalid");
  }

  const membership = await requireMembership(roomId, session.user.id);
  if (membership === null) redirect("/rooms/" + roomId);
  const isKPOnly = requestedKpOnly && membership.role === "KP";

  await prisma.note.create({
    data: {
      roomId,
      userId: session.user.id,
      title,
      content,
      isKPOnly
    }
  });
  revalidateRoom(roomId);
  redirect("/rooms/" + roomId + "?note=created#room-info");
}
