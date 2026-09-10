"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deleteAssetIfOrphan } from "@/server/assets/cleanup";
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



async function uniqueModuleSlug(roomId: string, base: string): Promise<string> {
  const normalized = base.length === 0 ? "module" : base;
  let slug = normalized;
  let suffix = 2;
  while ((await prisma.module.findFirst({ where: { roomId, slug }, select: { id: true } })) !== null) {
    slug = normalized + "-" + suffix;
    suffix += 1;
  }
  return slug;
}

export async function duplicateModuleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = String(formData.get("roomId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId + "/prepare?error=module");

  const source = await prisma.module.findUnique({
    where: { id: moduleId },
    include: { assets: { orderBy: { orderIndex: "asc" } } }
  });
  if (source === null || source.roomId !== roomId) redirect("/rooms/" + roomId + "/modules");

  const slug = await uniqueModuleSlug(roomId, (source.slug ?? "module") + "-copy");
  const copy = await prisma.module.create({
    data: {
      roomId,
      rulePackVersionId: source.rulePackVersionId,
      slug,
      title: (source.title + "（副本）").slice(0, 160),
      synopsis: source.synopsis,
      author: source.author,
      system: source.system,
      era: source.era,
      version: source.version,
      isPublished: false,
      sourceType: source.sourceType,
      originalFilename: source.originalFilename,
      packagePath: source.packagePath,
      metadata: source.metadata as never,
      importReport: source.importReport as never,
      content: source.content as never
    },
    select: { id: true }
  });

  if (source.assets.length > 0) {
    await prisma.moduleAsset.createMany({
      data: source.assets.map((item) => ({
        moduleId: copy.id,
        assetId: item.assetId,
        relativePath: item.relativePath,
        originalName: item.originalName,
        kind: item.kind,
        orderIndex: item.orderIndex
      }))
    });
  }

  revalidatePath("/rooms/" + roomId + "/modules");
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId + "/modules/" + copy.id + "?saved=copy");
}

export async function deleteModuleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = String(formData.get("roomId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId + "/prepare?error=module");

  const existing = await prisma.module.findUnique({
    where: { id: moduleId },
    include: { assets: { select: { assetId: true } } }
  });
  if (existing === null || existing.roomId !== roomId) redirect("/rooms/" + roomId + "/modules");

  const activeGame = await prisma.game.findFirst({
    where: {
      moduleId,
      status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] }
    },
    select: { id: true }
  });
  if (activeGame !== null) {
    redirect("/rooms/" + roomId + "/modules/" + moduleId + "?error=active");
  }

  const assetIds = existing.assets.map((item) => item.assetId);
  await prisma.module.delete({ where: { id: moduleId } });
  for (const assetId of assetIds) {
    await deleteAssetIfOrphan(assetId);
  }

  revalidatePath("/rooms/" + roomId + "/modules");
  revalidatePath("/rooms/" + roomId + "/prepare");
  redirect("/rooms/" + roomId + "/modules?deleted=1");
}
