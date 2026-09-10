"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export interface ModuleSaveResult {
  readonly ok: boolean;
  readonly error?: string;
}

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export async function upsertModuleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = String(formData.get("roomId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") {
    redirect("/rooms/" + roomId + "/prepare?error=module");
  }

  const title = clean(formData.get("title"), 120);
  if (title.length === 0) redirect("/rooms/" + roomId + "/prepare?error=module");

  const synopsis = clean(formData.get("synopsis"), 2000);
  const author = clean(formData.get("author"), 120);
  const version = clean(formData.get("version"), 40) || "1.0.0";
  const contentText = clean(formData.get("content"), 100000);
  const existingId = clean(formData.get("moduleId"), 64);

  const existing = existingId.length > 0
    ? await prisma.module.findUnique({ where: { id: existingId } })
    : await prisma.module.findFirst({ where: { roomId }, orderBy: { id: "asc" } });

  const data = {
    roomId,
    title,
    synopsis: synopsis.length === 0 ? null : synopsis,
    author: author.length === 0 ? null : author,
    version,
    content: { text: contentText } as never
  };

  if (existing === null || existing.roomId !== roomId) {
    await prisma.module.create({ data });
  } else {
    await prisma.module.update({ where: { id: existing.id }, data });
  }

  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId + "/prepare?module=saved");
}
function contentOf(value: unknown): { format?: string; text?: string; sections?: unknown[] } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    format: typeof record.format === "string" ? record.format : undefined,
    text: typeof record.text === "string" ? record.text : undefined,
    sections: Array.isArray(record.sections) ? record.sections : undefined
  };
}

export async function saveModuleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = String(formData.get("roomId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") {
    redirect("/rooms/" + roomId + "/modules");
  }

  const existing = await prisma.module.findUnique({ where: { id: moduleId } });
  if (existing === null || existing.roomId !== roomId) {
    redirect("/rooms/" + roomId + "/modules");
  }

  const title = clean(formData.get("title"), 120);
  if (title.length === 0) redirect("/rooms/" + roomId + "/modules/" + moduleId + "?error=title");

  const synopsis = clean(formData.get("synopsis"), 2000);
  const author = clean(formData.get("author"), 120);
  const version = clean(formData.get("version"), 40) || "1.0.0";
  const text = clean(formData.get("content"), 200000);
  const previous = contentOf(existing.content);

  await prisma.module.update({
    where: { id: moduleId },
    data: {
      title,
      synopsis: synopsis.length === 0 ? null : synopsis,
      author: author.length === 0 ? null : author,
      version,
      content: {
        format: previous.format ?? "markdown",
        text,
        sections: previous.sections ?? []
      } as never
    }
  });

  revalidatePath("/rooms/" + roomId + "/prepare");
  revalidatePath("/rooms/" + roomId + "/modules");
  revalidatePath("/rooms/" + roomId + "/modules/" + moduleId);
  redirect("/rooms/" + roomId + "/modules/" + moduleId + "?saved=1");
}

