"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deleteAssetIfOrphan } from "@/server/assets/cleanup";
import { REQUIRED_MODULE_SECTIONS } from "@/server/modules/format";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export interface ModuleSaveResult {
  readonly ok: boolean;
  readonly error?: string;
}

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function optionalOrExisting(
  value: FormDataEntryValue | null,
  existingValue: string | null,
  maxLength: number
): string | null {
  if (value === null) return existingValue;
  const text = clean(value, maxLength);
  return text.length === 0 ? null : text;
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

  const roomId = clean(formData.get("roomId"), 64);
  const moduleId = clean(formData.get("moduleId"), 64);
  const existing = await prisma.module.findUnique({ where: { id: moduleId } });
  if (existing === null) redirect(roomId.length > 0 ? "/rooms/" + roomId + "/modules" : "/modules/mine");

  let canEdit = existing.ownerId === session.user.id;
  if (canEdit === false && existing.ownerId === null && roomId.length > 0) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      select: { role: true }
    });
    canEdit = existing.roomId === roomId && membership !== null && membership.role === "KP";
  }
  if (canEdit === false) redirect(roomId.length > 0 ? "/rooms/" + roomId + "/modules" : "/modules/mine");

  const title = clean(formData.get("title"), 120);
  if (title.length === 0) {
    redirect((roomId.length > 0 ? "/rooms/" + roomId + "/modules/" + moduleId : "/modules/" + moduleId) + "?error=title");
  }

  const synopsis = clean(formData.get("synopsis"), 2000);
  const author = clean(formData.get("author"), 120);
  const version = clean(formData.get("version"), 40) || "1.0.0";
  const text = clean(formData.get("content"), 200000);
  const previous = contentOf(existing.content);
  const background = optionalOrExisting(formData.get("background"), existing.background, 5000);
  const occupationRecommendation = optionalOrExisting(
    formData.get("occupationRecommendation"),
    existing.occupationRecommendation,
    5000
  );
  const systemRaw = optionalOrExisting(formData.get("system"), existing.system, 20);
  const system = systemRaw === "TOUHOU" ? "TOUHOU" : systemRaw === "COC7" ? "COC7" : existing.system;
  const eraRaw = optionalOrExisting(formData.get("era"), existing.era, 20);
  const era = eraRaw === "CLASSIC" || eraRaw === "MODERN" || eraRaw === "FANTASY" ? eraRaw : existing.era;

  await prisma.module.update({
    where: { id: moduleId },
    data: {
      title,
      synopsis: synopsis.length === 0 ? null : synopsis,
      author: author.length === 0 ? null : author,
      version,
      system,
      era,
      background,
      occupationRecommendation,
      content: {
        format: previous.format ?? "markdown",
        text,
        sections: previous.sections ?? []
      } as never
    }
  });

  if (roomId.length > 0) {
    revalidatePath("/rooms/" + roomId + "/prepare");
    revalidatePath("/rooms/" + roomId + "/modules");
    revalidatePath("/rooms/" + roomId + "/modules/" + moduleId);
  }
  revalidatePath("/modules");
  revalidatePath("/modules/mine");
  revalidatePath("/modules/" + moduleId);
  redirect((roomId.length > 0 ? "/rooms/" + roomId + "/modules/" + moduleId : "/modules/" + moduleId) + "?saved=1");
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
      ownerId: session.user.id,
      roomId,
      rulePackVersionId: source.rulePackVersionId,
      slug,
      title: (source.title + "（副本）").slice(0, 160),
      synopsis: source.synopsis,
      author: source.author,
      system: source.system,
      era: source.era,
      background: source.background,
      occupationRecommendation: source.occupationRecommendation,
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
  if (existing.ownerId !== null && existing.ownerId !== session.user.id) {
    redirect("/rooms/" + roomId + "/modules/" + moduleId + "?error=owner");
  }

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


export async function createBlankModuleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  let room: { id: string; system: "COC7" | "TOUHOU"; era: string | null } | null = null;
  if (roomId.length > 0) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      select: { role: true }
    });
    if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId + "/prepare?error=module");
    room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, system: true, era: true }
    });
    if (room === null) redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { username: true, displayName: true }
  });
  const author = user?.displayName ?? user?.username ?? "KP";
  const system = room?.system ?? (String(formData.get("system") ?? "COC7") === "TOUHOU" ? "TOUHOU" : "COC7");
  const era = system === "TOUHOU" ? "FANTASY" : room?.era ?? (String(formData.get("era") ?? "MODERN") === "CLASSIC" ? "CLASSIC" : "MODERN");
  const count = await prisma.module.count({ where: roomId.length > 0 ? { roomId } : { ownerId: session.user.id } });
  const title = count === 0 ? "未命名团本" : "未命名团本 " + String(count + 1);
  const text = REQUIRED_MODULE_SECTIONS.map((section) => "## " + section + "\n\n待补充。\n").join("\n");

  const created = await prisma.module.create({
    data: {
      ownerId: session.user.id,
      roomId: roomId.length > 0 ? roomId : null,
      title,
      author,
      system,
      era,
      version: "1.0.0",
      sourceType: "NATIVE",
      content: {
        format: "markdown",
        text,
        sections: [...REQUIRED_MODULE_SECTIONS]
      } as never,
      metadata: {
        spec: "touhou-module/v1",
        title,
        system,
        era,
        author,
        version: "1.0.0",
        summary: "空白团本，请补充简介与正文。"
      } as never,
      importReport: {
        warnings: [],
        errors: [],
        assetCount: 0,
        source: "NATIVE"
      } as never
    },
    select: { id: true }
  });

  revalidatePath("/modules");
  revalidatePath("/modules/mine");
  if (roomId.length > 0) {
    revalidatePath("/rooms/" + roomId + "/modules");
    revalidatePath("/rooms/" + roomId + "/prepare");
    redirect("/rooms/" + roomId + "/modules/" + created.id + "?saved=new");
  }
  redirect("/modules/" + created.id + "?saved=new");
}

export async function setModulePublishedAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const moduleId = clean(formData.get("moduleId"), 64);
  const existing = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, ownerId: true, roomId: true }
  });
  if (existing === null || existing.ownerId !== session.user.id) {
    redirect("/modules/mine");
  }

  const published = String(formData.get("published") ?? "0") === "1";
  await prisma.module.update({
    where: { id: moduleId },
    data: {
      isPublished: published,
      publishedAt: published ? new Date() : null
    }
  });

  revalidatePath("/modules");
  revalidatePath("/modules/mine");
  revalidatePath("/modules/" + moduleId);
  if (existing.roomId !== null) {
    revalidatePath("/rooms/" + existing.roomId + "/prepare");
    revalidatePath("/rooms/" + existing.roomId + "/modules");
  }
  redirect("/modules/" + moduleId + "?saved=publish");
}

export async function deleteOwnedModuleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const moduleId = clean(formData.get("moduleId"), 64);
  const existing = await prisma.module.findUnique({
    where: { id: moduleId },
    include: { assets: { select: { assetId: true } } }
  });
  if (existing === null || existing.ownerId !== session.user.id) {
    redirect("/modules/mine");
  }

  const activeGame = await prisma.game.findFirst({
    where: {
      moduleId,
      status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] }
    },
    select: { id: true }
  });
  if (activeGame !== null) {
    redirect("/modules/" + moduleId + "?error=active");
  }

  const assetIds = existing.assets.map((item) => item.assetId);
  await prisma.module.delete({ where: { id: moduleId } });
  for (const assetId of assetIds) {
    await deleteAssetIfOrphan(assetId);
  }

  revalidatePath("/modules");
  revalidatePath("/modules/mine");
  if (existing.roomId !== null) {
    revalidatePath("/rooms/" + existing.roomId + "/prepare");
    revalidatePath("/rooms/" + existing.roomId + "/modules");
  }
  redirect("/modules/mine?deleted=1");
}
