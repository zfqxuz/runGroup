"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

const ADMIN_HOME = "/admin";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function jsonText(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function boolOf(value: FormDataEntryValue | null, fallback = false): boolean {
  if (value === null) return fallback;
  return value === "1" || value === "on" || value === "true";
}

function checksumOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function adminPath(pathname: string, query: string): string {
  return pathname + query;
}

async function requireAdminActor(): Promise<{ id: string; username: string; displayName: string | null }> {
  const session = await auth();
  if (session === null) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/");
  return { id: session.user.id, username: session.user.username, displayName: session.user.name ?? null };
}

async function audit(input: {
  readonly actor: { readonly id: string; readonly displayName: string | null };
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string;
  readonly detail?: Record<string, unknown>;
}): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      actorId: input.actor.id,
      actorName: input.actor.displayName,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      detail: (input.detail ?? {}) as never
    }
  });
}

/* ------------------------------- 用户管理 ------------------------------- */

export async function setUserRoleAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const userId = clean(formData.get("userId"), 64);
  const role = clean(formData.get("role"), 10) === "ADMIN" ? "ADMIN" : "USER";
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
  if (target === null) redirect(adminPath("/admin/users", "?error=not-found"));
  if (target.id === actor.id && role === "USER") redirect(adminPath("/admin/users", "?error=self"));
  if (target.username === "bdmin" && role !== "ADMIN") redirect(adminPath("/admin/users", "?error=protected"));

  await prisma.user.update({ where: { id: target.id }, data: { role } });
  await audit({
    actor,
    action: "user.set-role",
    targetType: "User",
    targetId: target.id,
    detail: { username: target.username, role }
  });
  revalidatePath("/admin/users");
  redirect(adminPath("/admin/users", "?saved=role"));
}

export async function toggleUserDisabledAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const userId = clean(formData.get("userId"), 64);
  const disabled = boolOf(formData.get("disabled"));
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
  if (target === null) redirect(adminPath("/admin/users", "?error=not-found"));
  if (target.id === actor.id) redirect(adminPath("/admin/users", "?error=self"));
  if (target.username === "bdmin") redirect(adminPath("/admin/users", "?error=protected"));

  await prisma.user.update({ where: { id: target.id }, data: { isDisabled: disabled } });
  await audit({
    actor,
    action: disabled ? "user.disable" : "user.enable",
    targetType: "User",
    targetId: target.id,
    detail: { username: target.username }
  });
  revalidatePath("/admin/users");
  redirect(adminPath("/admin/users", "?saved=disabled"));
}

/* ------------------------------- 房间管理 ------------------------------- */

const ROOM_STATUSES = ["LOBBY", "PLAYING", "PAUSED", "COMBAT", "ENDED"] as const;
type AdminRoomStatus = (typeof ROOM_STATUSES)[number];

export async function adminSetRoomStatusAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const roomId = clean(formData.get("roomId"), 64);
  const statusRaw = clean(formData.get("status"), 20);
  if ((ROOM_STATUSES as readonly string[]).includes(statusRaw) === false) {
    redirect(adminPath("/admin/rooms", "?error=status"));
  }
  const status = statusRaw as AdminRoomStatus;
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, name: true } });
  if (room === null) redirect(adminPath("/admin/rooms", "?error=not-found"));
  await prisma.$transaction([
    prisma.room.update({ where: { id: room.id }, data: { status } }),
    ...(status === "LOBBY"
      ? [prisma.roomMember.updateMany({ where: { roomId: room.id }, data: { ready: false } })]
      : [])
  ]);
  await audit({
    actor,
    action: "room.set-status",
    targetType: "Room",
    targetId: room.id,
    detail: { name: room.name, status }
  });
  revalidatePath("/admin/rooms");
  revalidatePath("/rooms/" + room.id);
  redirect(adminPath("/admin/rooms", "?saved=status"));
}

export async function deleteRoomAdminAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const roomId = clean(formData.get("roomId"), 64);
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, name: true } });
  if (room === null) redirect(adminPath("/admin/rooms", "?error=not-found"));
  await prisma.room.delete({ where: { id: room.id } });
  await audit({
    actor,
    action: "room.delete",
    targetType: "Room",
    targetId: room.id,
    detail: { name: room.name }
  });
  revalidatePath("/admin/rooms");
  revalidatePath("/");
  redirect(adminPath("/admin/rooms", "?saved=deleted"));
}

/* ------------------------------- 团本管理 ------------------------------- */

export async function adminSetModulePublishedAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const moduleId = clean(formData.get("moduleId"), 64);
  const published = boolOf(formData.get("published"));
  const moduleRecord = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, title: true }
  });
  if (moduleRecord === null) redirect(adminPath("/admin/modules", "?error=not-found"));
  await prisma.module.update({
    where: { id: moduleRecord.id },
    data: { isPublished: published, publishedAt: published ? new Date() : null }
  });
  await audit({
    actor,
    action: published ? "module.publish" : "module.unpublish",
    targetType: "Module",
    targetId: moduleRecord.id,
    detail: { title: moduleRecord.title }
  });
  revalidatePath("/admin/modules");
  revalidatePath("/modules");
  redirect(adminPath("/admin/modules", "?saved=published"));
}

export async function deleteModuleAdminAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const moduleId = clean(formData.get("moduleId"), 64);
  const moduleRecord = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, title: true, ownerId: true }
  });
  if (moduleRecord === null) redirect(adminPath("/admin/modules", "?error=not-found"));
  const activeGame = await prisma.game.findFirst({
    where: { moduleId, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    select: { id: true }
  });
  if (activeGame !== null) redirect(adminPath("/admin/modules", "?error=active-game"));
  await prisma.module.delete({ where: { id: moduleRecord.id } });
  await audit({
    actor,
    action: "module.delete",
    targetType: "Module",
    targetId: moduleRecord.id,
    detail: { title: moduleRecord.title, ownerId: moduleRecord.ownerId }
  });
  revalidatePath("/admin/modules");
  revalidatePath("/modules");
  redirect(adminPath("/admin/modules", "?saved=deleted"));
}

/* ------------------------------- 规则包管理 ------------------------------- */

function packSystemOf(value: unknown): "COC7" | "TOUHOU" {
  return value === "TOUHOU" ? "TOUHOU" : "COC7";
}

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 60);
}

interface ValidatedConfig {
  readonly resolved: unknown;
  readonly input: unknown;
}

function validateRulePackConfig(candidateSlug: string, input: unknown): ValidatedConfig {
  const registry = {
    ...builtinRegistry(),
    [candidateSlug]: input as never
  };
  const resolved = resolveRulePack(candidateSlug, registry);
  return { resolved, input };
}

function parseConfigText(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function redirectPack(packId: string, query: string): never {
  redirect("/admin/rulepacks/" + packId + query);
}

export async function syncBuiltinRulePacksAction(): Promise<void> {
  const actor = await requireAdminActor();
  const registry = builtinRegistry();
  let synced = 0;
  for (const [slug, raw] of Object.entries(registry)) {
    const resolved = resolveRulePack(slug, registry);
    const rawRecord = raw as Record<string, unknown>;
    const system = packSystemOf(rawRecord.system);
    const name = typeof rawRecord.name === "string" ? rawRecord.name : slug;
    const versionText = typeof rawRecord.version === "string" ? rawRecord.version : "1.0.0";
    const description = typeof rawRecord.description === "string" ? rawRecord.description : null;
    const packRecord = await prisma.rulePack.upsert({
      where: { slug },
      update: {
        name,
        system,
        description,
        isBuiltin: true,
        isPublished: true,
        publishedAt: new Date()
      },
      create: {
        slug,
        name,
        system,
        description,
        isBuiltin: true,
        isPublished: true,
        publishedAt: new Date()
      },
      select: { id: true }
    });
    const checksum = checksumOf(resolved);
    const existing = await prisma.rulePackVersion.findUnique({
      where: { packId_version: { packId: packRecord.id, version: versionText } },
      select: { id: true }
    });
    if (existing === null) {
      await prisma.rulePackVersion.create({
        data: {
          packId: packRecord.id,
          version: versionText,
          config: (raw as object) as never,
          checksum,
          isActive: true,
          status: "PUBLISHED",
          notes: "从代码内置注册表同步",
          createdBy: actor.id,
          publishedAt: new Date()
        }
      });
    } else {
      await prisma.rulePackVersion.update({
        where: { id: existing.id },
        data: { checksum, status: "PUBLISHED", publishedAt: new Date() }
      });
    }
    synced += 1;
  }
  await audit({ actor, action: "rulepack.sync-builtin", targetType: "RulePack", detail: { synced } });
  revalidatePath("/admin/rulepacks");
  redirect("/admin/rulepacks?saved=synced");
}

export async function createRulePackAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const name = clean(formData.get("name"), 120);
  const slugRaw = clean(formData.get("slug"), 60);
  const system = packSystemOf(clean(formData.get("system"), 20));
  const description = clean(formData.get("description"), 2000) || null;
  const baseSlug = clean(formData.get("baseSlug"), 60);
  const configText = jsonText(formData.get("config"), 800000);
  const slug = normalizeSlug(slugRaw.length > 0 ? slugRaw : name);
  if (name.length === 0 || slug.length === 0) redirect("/admin/rulepacks?error=name");

  let input: unknown;
  const registry = builtinRegistry();
  if (baseSlug.length > 0 && registry[baseSlug] !== undefined) {
    input = JSON.parse(JSON.stringify(registry[baseSlug]));
  } else if (configText.length > 0) {
    try {
      input = parseConfigText(configText);
    } catch {
      redirect("/admin/rulepacks?error=config-json");
    }
  } else {
    redirect("/admin/rulepacks?error=config-empty");
  }

  let validated: ValidatedConfig;
  try {
    validated = validateRulePackConfig(slug, input);
  } catch (error) {
    redirect("/admin/rulepacks?error=config-invalid&reason=" + encodeURIComponent(error instanceof Error ? error.message : "invalid"));
  }

  const existing = await prisma.rulePack.findUnique({ where: { slug }, select: { id: true } });
  if (existing !== null) redirect("/admin/rulepacks?error=slug-exists");

  const version =
    typeof (input as { version?: unknown }).version === "string"
      ? (input as { version: string }).version
      : "1.0.0";

  const packRecord = await prisma.rulePack.create({
    data: {
      slug,
      name,
      system,
      description,
      ownerId: actor.id,
      isBuiltin: false,
      isPublished: false,
      versions: {
        create: {
          version,
          config: input as never,
          checksum: checksumOf(validated.resolved),
          isActive: false,
          status: "DRAFT",
          notes: "管理后台创建",
          createdBy: actor.id
        }
      }
    },
    select: { id: true }
  });
  await audit({
    actor,
    action: "rulepack.create",
    targetType: "RulePack",
    targetId: packRecord.id,
    detail: { slug, name, system }
  });
  revalidatePath("/admin/rulepacks");
  redirectPack(packRecord.id, "?saved=created");
}

export async function createRulePackVersionAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const packId = clean(formData.get("packId"), 64);
  const version = clean(formData.get("version"), 40) || "1.0.0";
  const notes = clean(formData.get("notes"), 500) || null;
  const configText = jsonText(formData.get("config"), 800000);
  const packRecord = await prisma.rulePack.findUnique({ where: { id: packId }, select: { id: true, slug: true } });
  if (packRecord === null) redirect("/admin/rulepacks?error=not-found");

  let input: unknown;
  try {
    input = parseConfigText(configText);
  } catch {
    redirectPack(packRecord.id, "?error=config-json");
  }
  let resolved: ValidatedConfig;
  try {
    resolved = validateRulePackConfig(packRecord.slug, input);
  } catch (error) {
    redirectPack(
      packRecord.id,
      "?error=config-invalid&reason=" + encodeURIComponent(error instanceof Error ? error.message : "invalid")
    );
  }
  try {
    await prisma.rulePackVersion.create({
      data: {
        packId: packRecord.id,
        version,
        config: input as never,
        checksum: checksumOf(resolved.resolved),
        status: "DRAFT",
        notes,
        createdBy: actor.id
      }
    });
  } catch {
    redirectPack(packRecord.id, "?error=version-exists");
  }
  await audit({
    actor,
    action: "rulepack.version-create",
    targetType: "RulePackVersion",
    targetId: packRecord.id,
    detail: { slug: packRecord.slug, version }
  });
  revalidatePath("/admin/rulepacks/" + packRecord.id);
  redirectPack(packRecord.id, "?saved=version");
}

export async function adminSetRulePackVersionStatusAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const versionId = clean(formData.get("versionId"), 64);
  const statusRaw = clean(formData.get("status"), 20);
  const status = statusRaw === "PUBLISHED" || statusRaw === "ARCHIVED" ? statusRaw : "DRAFT";
  const version = await prisma.rulePackVersion.findUnique({
    where: { id: versionId },
    include: { pack: { select: { id: true, slug: true, publishedAt: true } } }
  });
  if (version === null) redirect("/admin/rulepacks?error=not-found");

  await prisma.$transaction(async (tx) => {
    await tx.rulePackVersion.update({
      where: { id: version.id },
      data: { status, publishedAt: status === "PUBLISHED" ? new Date() : version.publishedAt, isActive: status === "PUBLISHED" }
    });
    if (status === "PUBLISHED") {
      await tx.rulePack.update({
        where: { id: version.pack.id },
        data: { isPublished: true, publishedAt: version.pack.publishedAt ?? new Date() }
      });
    } else if (status === "ARCHIVED") {
      const activeCount = await tx.rulePackVersion.count({
        where: { packId: version.pack.id, status: "PUBLISHED", id: { not: version.id } }
      });
      if (activeCount === 0) {
        await tx.rulePack.update({ where: { id: version.pack.id }, data: { isPublished: false } });
      }
    }
  });
  await audit({
    actor,
    action: "rulepack.version-status",
    targetType: "RulePackVersion",
    targetId: version.id,
    detail: { packId: version.pack.id, slug: version.pack.slug, version: version.version, status }
  });
  revalidatePath("/admin/rulepacks");
  revalidatePath("/admin/rulepacks/" + version.pack.id);
  redirectPack(version.pack.id, "?saved=status");
}

export async function importRulePackVersionAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const packId = clean(formData.get("packId"), 64);
  const version = clean(formData.get("version"), 40) || "1.0.0";
  const file = formData.get("file");
  const packRecord = await prisma.rulePack.findUnique({ where: { id: packId }, select: { id: true, slug: true } });
  if (packRecord === null) redirect("/admin/rulepacks?error=not-found");
  if ((file instanceof File) === false) redirectPack(packRecord.id, "?error=file");
  const text = (await file.text()).slice(0, 900000);
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    redirectPack(packRecord.id, "?error=config-json");
  }
  let validated: ValidatedConfig;
  try {
    validated = validateRulePackConfig(packRecord.slug, input);
  } catch (error) {
    redirectPack(
      packRecord.id,
      "?error=config-invalid&reason=" + encodeURIComponent(error instanceof Error ? error.message : "invalid")
    );
  }
  try {
    await prisma.rulePackVersion.create({
      data: {
        packId: packRecord.id,
        version,
        config: input as never,
        checksum: checksumOf(validated.resolved),
        status: "DRAFT",
        notes: "从 JSON 文件导入：" + file.name.slice(0, 120),
        createdBy: actor.id
      }
    });
  } catch {
    redirectPack(packRecord.id, "?error=version-exists");
  }
  await audit({
    actor,
    action: "rulepack.version-import",
    targetType: "RulePackVersion",
    targetId: packRecord.id,
    detail: { slug: packRecord.slug, version, filename: file.name }
  });
  revalidatePath("/admin/rulepacks/" + packRecord.id);
  redirectPack(packRecord.id, "?saved=imported");
}

export async function deleteRulePackAdminAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const packId = clean(formData.get("packId"), 64);
  const packRecord = await prisma.rulePack.findUnique({
    where: { id: packId },
    select: { id: true, slug: true, name: true, isBuiltin: true, versions: { select: { id: true } } }
  });
  if (packRecord === null) redirect("/admin/rulepacks?error=not-found");
  if (packRecord.isBuiltin) redirectPack(packRecord.id, "?error=builtin");
  const versionIds = packRecord.versions.map((item) => item.id);
  const boundRooms = await prisma.room.count({ where: { rulePackVersionId: { in: versionIds } } });
  const boundModules = await prisma.module.count({ where: { rulePackVersionId: { in: versionIds } } });
  if (boundRooms > 0 || boundModules > 0) redirectPack(packRecord.id, "?error=in-use");
  await prisma.rulePack.delete({ where: { id: packRecord.id } });
  await audit({
    actor,
    action: "rulepack.delete",
    targetType: "RulePack",
    targetId: packRecord.id,
    detail: { slug: packRecord.slug, name: packRecord.name }
  });
  revalidatePath("/admin/rulepacks");
  redirect("/admin/rulepacks?saved=deleted");
}

export async function bindRoomRulePackAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const roomId = clean(formData.get("roomId"), 64);
  const versionId = clean(formData.get("versionId"), 64);
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, name: true, system: true } });
  if (room === null) redirect("/admin/rulepacks?error=room-not-found");

  if (versionId.length === 0) {
    await prisma.room.update({ where: { id: room.id }, data: { rulePackVersionId: null } });
    await audit({ actor, action: "rulepack.unbind-room", targetType: "Room", targetId: room.id, detail: { name: room.name } });
    revalidatePath("/admin/rulepacks");
    redirect("/admin/rulepacks?saved=unbound");
  }

  const version = await prisma.rulePackVersion.findUnique({
    where: { id: versionId },
    include: { pack: { select: { system: true, isPublished: true, slug: true, name: true } } }
  });
  if (version === null) redirect("/admin/rulepacks?error=version-not-found");
  if (version.status !== "PUBLISHED" || version.pack.isPublished === false) {
    redirect("/admin/rulepacks?error=unpublished");
  }
  if (version.pack.system !== room.system) {
    redirect("/admin/rulepacks?error=system-mismatch");
  }
  await prisma.room.update({ where: { id: room.id }, data: { rulePackVersionId: version.id } });
  await audit({
    actor,
    action: "rulepack.bind-room",
    targetType: "Room",
    targetId: room.id,
    detail: { room: room.name, pack: version.pack.name, version: version.version }
  });
  revalidatePath("/admin/rulepacks");
  revalidatePath("/rooms/" + room.id);
  redirect("/admin/rulepacks?saved=bound");
}

/* ------------------------------- 平台设置 ------------------------------- */

export async function updateSystemSettingAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor();
  const key = clean(formData.get("key"), 80);
  const valueText = jsonText(formData.get("value"), 20000);
  if (key.length === 0) redirect("/admin/system?error=key");
  let value: unknown;
  try {
    value = JSON.parse(valueText.length === 0 ? "{}" : valueText);
  } catch {
    redirect("/admin/system?error=json");
  }
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: value as never, updatedBy: actor.id },
    create: { key, value: value as never, updatedBy: actor.id }
  });
  await audit({ actor, action: "system.setting", targetType: "SystemSetting", targetId: key });
  revalidatePath("/admin/system");
  redirect("/admin/system?saved=1");
}
