"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import {
  STRUCTURED_ENTITY_KINDS,
  removeStructuredEntity,
  slugifyEntityId,
  upsertStructuredEntity,
  type StructuredEntityKind
} from "@/server/modules/structured-edit";
import { moduleEntitySourceKey, syncModuleTemplatesFromModule } from "@/server/modules/templates";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function optional(value: FormDataEntryValue | null, maxLength: number): string | null {
  const text = clean(value, maxLength);
  return text.length === 0 ? null : text;
}

function intOf(value: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const number = Number(String(value ?? "").trim());
  if (Number.isFinite(number) === false) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function boolOf(value: FormDataEntryValue | null): boolean {
  return String(value ?? "") === "1";
}

function tagsOf(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 20);
}

function attributesOf(formData: FormData): Record<string, number> {
  const keys = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"];
  const out: Record<string, number> = {};
  for (const key of keys) out[key] = intOf(formData.get("attr_" + key), 50, 0, 999);
  return out;
}

function skillsOf(value: FormDataEntryValue | null): Record<string, number> {
  const out: Record<string, number> = {};
  const raw = String(value ?? "").trim();
  if (raw.length === 0) return out;
  for (const part of raw.split(/[\n,，]/)) {
    const line = part.trim();
    if (line.length === 0) continue;
    const pieces = line.split(/[:：=]/);
    const id = (pieces[0] ?? "").trim();
    const number = Number((pieces[1] ?? "").trim());
    if (id.length === 0 || Number.isFinite(number) === false) continue;
    out[id] = Math.max(0, Math.min(999, Math.floor(number)));
  }
  return out;
}

function kindOf(value: FormDataEntryValue | null): StructuredEntityKind | null {
  const raw = String(value ?? "");
  return (STRUCTURED_ENTITY_KINDS as readonly string[]).includes(raw) ? (raw as StructuredEntityKind) : null;
}

function defaultReturnPath(moduleId: string, roomId: string): string {
  return roomId.length > 0 ? "/rooms/" + roomId + "/modules/" + moduleId : "/modules/" + moduleId;
}

function safeReturnTo(raw: FormDataEntryValue | null, fallback: string): string {
  const value = String(raw ?? "").trim();
  if (value.startsWith("/") && value.startsWith("//") === false) return value;
  return fallback;
}

async function requireEditableModule(moduleId: string, roomId: string, userId: string) {
  const moduleRecord = await prisma.module.findUnique({ where: { id: moduleId } });
  if (moduleRecord === null) return null;
  if (moduleRecord.ownerId === userId) return moduleRecord;
  if (roomId.length > 0 && moduleRecord.roomId === roomId) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true }
    });
    if (membership !== null && membership.role === "KP") return moduleRecord;
  }
  return null;
}

function entityDataOf(kind: StructuredEntityKind, formData: FormData): Record<string, unknown> {
  if (kind === "npc") {
    return {
      name: clean(formData.get("name"), 120),
      subtitle: optional(formData.get("subtitle"), 120),
      description: optional(formData.get("description"), 4000),
      tier: clean(formData.get("tier"), 20) || "STANDARD",
      rarity: clean(formData.get("rarity"), 20) || "COMMON",
      race: optional(formData.get("race"), 60),
      tags: tagsOf(formData.get("tags")),
      attributes: attributesOf(formData),
      skills: skillsOf(formData.get("skills")),
      maxHp: intOf(formData.get("maxHp"), 10, 1, 9999),
      maxMp: intOf(formData.get("maxMp"), 0, 0, 99999),
      maxSan: intOf(formData.get("maxSan"), 0, 0, 999),
      maxDp: intOf(formData.get("maxDp"), 0, 0, 99999),
      portrait: optional(formData.get("portrait"), 300),
      token: optional(formData.get("tokenPath"), 300),
      isPublic: boolOf(formData.get("isPublic"))
    };
  }
  if (kind === "item") {
    return {
      name: clean(formData.get("name"), 120),
      itemType: clean(formData.get("itemType"), 20) || "ITEM",
      description: optional(formData.get("description"), 4000),
      rarity: clean(formData.get("rarity"), 20) || "COMMON",
      image: optional(formData.get("image"), 300),
      quantity: intOf(formData.get("quantity"), 1, 1, 9999),
      damage: optional(formData.get("damage"), 40),
      range: optional(formData.get("range"), 20),
      skillId: optional(formData.get("skillId"), 60),
      accuracyMod: intOf(formData.get("accuracyMod"), 0, -100, 100),
      effect: optional(formData.get("effect"), 2000),
      mpCost: optional(formData.get("mpCost"), 40),
      sanCost: optional(formData.get("sanCost"), 40)
    };
  }
  if (kind === "clue") {
    return {
      title: clean(formData.get("title"), 160),
      content: clean(formData.get("content"), 20000),
      image: optional(formData.get("image"), 300),
      isPublic: boolOf(formData.get("isPublic")),
      linkedItemId: optional(formData.get("linkedItemId"), 120)
    };
  }
  if (kind === "scene") {
    return {
      name: clean(formData.get("name"), 120),
      description: optional(formData.get("description"), 4000),
      narration: optional(formData.get("narration"), 4000),
      width: intOf(formData.get("width"), 1600, 200, 8000),
      height: intOf(formData.get("height"), 1000, 200, 8000),
      gridSize: intOf(formData.get("gridSize"), 70, 10, 400),
      gridType: clean(formData.get("gridType"), 10) || "SQUARE",
      bgColor: clean(formData.get("bgColor"), 20) || "#1a1a2e",
      showGrid: boolOf(formData.get("showGrid")),
      showFog: boolOf(formData.get("showFog")),
      background: optional(formData.get("background"), 300)
    };
  }
  if (kind === "encounter") {
    return {
      title: clean(formData.get("title"), 160),
      chapterId: optional(formData.get("chapterId"), 120),
      sceneId: optional(formData.get("sceneId"), 120),
      trigger: optional(formData.get("trigger"), 1000),
      npcs: tagsOf(formData.get("npcs")),
      items: tagsOf(formData.get("items"))
    };
  }
  if (kind === "chapter") {
    return {
      title: clean(formData.get("title"), 160),
      summary: optional(formData.get("summary"), 4000)
    };
  }
  if (kind === "ending") {
    return {
      title: clean(formData.get("title"), 160),
      condition: optional(formData.get("condition"), 2000),
      description: optional(formData.get("description"), 4000)
    };
  }
  if (kind === "reward") {
    return {
      title: clean(formData.get("title"), 160),
      description: optional(formData.get("description"), 4000)
    };
  }
  return {
    name: clean(formData.get("name"), 120),
    skill: clean(formData.get("skill"), 60),
    description: optional(formData.get("description"), 4000),
    mpCost: optional(formData.get("mpCost"), 40) ?? "0",
    sanCost: optional(formData.get("sanCost"), 40) ?? "0",
    damage: optional(formData.get("damage"), 40),
    target: clean(formData.get("target"), 10) || "ONE"
  };
}

async function deleteTemplateRow(moduleId: string, kind: StructuredEntityKind, entityId: string): Promise<void> {
  const sourceKey = moduleEntitySourceKey(entityId);
  if (kind === "chapter") await prisma.chapterTemplate.deleteMany({ where: { moduleId, sourceKey } });
  else if (kind === "scene") await prisma.sceneTemplate.deleteMany({ where: { moduleId, sourceKey } });
  else if (kind === "encounter") await prisma.encounterTemplate.deleteMany({ where: { moduleId, sourceKey } });
  else if (kind === "npc") await prisma.npcTemplate.deleteMany({ where: { moduleId, sourceKey } });
  else if (kind === "clue") await prisma.clueTemplate.deleteMany({ where: { moduleId, sourceKey } });
  else if (kind === "item") await prisma.itemTemplate.deleteMany({ where: { moduleId, sourceKey } });
  else if (kind === "magic") await prisma.magicTemplate.deleteMany({ where: { moduleId, sourceKey } });
}

export async function saveModuleEntityAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const moduleId = clean(formData.get("moduleId"), 64);
  const roomId = clean(formData.get("roomId"), 64);
  const kind = kindOf(formData.get("kind"));
  const entityIdRaw = clean(formData.get("entityId"), 120);
  const fallbackPath = defaultReturnPath(moduleId, roomId);
  const returnTo = safeReturnTo(formData.get("returnTo"), fallbackPath + "?saved=entity");
  if (moduleId.length === 0 || kind === null) redirect(returnTo);

  const moduleRecord = await requireEditableModule(moduleId, roomId, session.user.id);
  if (moduleRecord === null) redirect(returnTo);

  const data = entityDataOf(kind, formData);
  const label = String(data.name ?? data.title ?? entityIdRaw ?? "").trim();
  if (label.length === 0 && kind !== "magic") {
    redirect(returnTo + (returnTo.includes("?") ? "&" : "?") + "error=entity-name");
  }
  const entityId = entityIdRaw.length > 0 ? entityIdRaw : slugifyEntityId(kind, label || kind);
  const result = upsertStructuredEntity(moduleRecord.content, kind, entityId, data);

  await prisma.module.update({
    where: { id: moduleId },
    data: {
      content: {
        ...(moduleRecord.content !== null && typeof moduleRecord.content === "object" && Array.isArray(moduleRecord.content) === false
          ? (moduleRecord.content as Record<string, unknown>)
          : {}),
        text: result.text,
        structured: result.structured
      } as never
    }
  });
  await syncModuleTemplatesFromModule(moduleId);

  revalidatePath("/modules/" + moduleId);
  revalidatePath("/modules/mine");
  revalidatePath("/modules");
  if (roomId.length > 0) {
    revalidatePath("/rooms/" + roomId);
    revalidatePath("/rooms/" + roomId + "/prepare");
    revalidatePath("/rooms/" + roomId + "/modules/" + moduleId);
  }
  redirect(returnTo + (returnTo.includes("?") ? "&" : "?") + "saved=entity");
}

export async function deleteModuleEntityAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const moduleId = clean(formData.get("moduleId"), 64);
  const roomId = clean(formData.get("roomId"), 64);
  const kind = kindOf(formData.get("kind"));
  const entityId = clean(formData.get("entityId"), 120);
  const fallbackPath = defaultReturnPath(moduleId, roomId);
  const returnTo = safeReturnTo(formData.get("returnTo"), fallbackPath + "?saved=deleted");
  if (moduleId.length === 0 || kind === null || entityId.length === 0) redirect(returnTo);

  const moduleRecord = await requireEditableModule(moduleId, roomId, session.user.id);
  if (moduleRecord === null) redirect(returnTo);

  const result = removeStructuredEntity(moduleRecord.content, kind, entityId);
  await prisma.module.update({
    where: { id: moduleId },
    data: {
      content: {
        ...(moduleRecord.content !== null && typeof moduleRecord.content === "object" && Array.isArray(moduleRecord.content) === false
          ? (moduleRecord.content as Record<string, unknown>)
          : {}),
        text: result.text,
        structured: result.structured
      } as never
    }
  });
  await deleteTemplateRow(moduleId, kind, entityId);
  await syncModuleTemplatesFromModule(moduleId);

  revalidatePath("/modules/" + moduleId);
  revalidatePath("/modules/mine");
  revalidatePath("/modules");
  if (roomId.length > 0) {
    revalidatePath("/rooms/" + roomId);
    revalidatePath("/rooms/" + roomId + "/prepare");
    revalidatePath("/rooms/" + roomId + "/modules/" + moduleId);
  }
  redirect(returnTo + (returnTo.includes("?") ? "&" : "?") + "saved=deleted");
}
