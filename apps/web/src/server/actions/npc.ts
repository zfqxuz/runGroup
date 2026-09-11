"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { computeDerived, PRESET_TIERS, RARITIES, type PresetCharacter } from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { emitRoomRefresh } from "@/server/realtime";
import { loadEffectivePack, type EffectivePack } from "@/server/rules/loader";
import { NPC_ATTRIBUTE_KEYS, NpcStatsSchema, type NpcStats } from "@/shared/npc";

function redirectError(roomId: string, message: string): never {
  redirect("/rooms/" + roomId + "/npcs/new?error=" + encodeURIComponent(message));
}

async function requireKp(roomId: string, userId: string) {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") return null;
  return prisma.room.findUnique({ where: { id: roomId } });
}

function materializePreset(preset: PresetCharacter, effective: EffectivePack): NpcStats {
  const fallback = computeDerived(effective.compiled, {
    attributes: preset.attributes,
    race: null
  });
  return {
    presetId: preset.id,
    tier: preset.tier,
    race: preset.race,
    attributes: { ...preset.attributes },
    skills: { ...preset.skills },
    maxHp: preset.maxHp ?? fallback.derived.maxHp,
    maxMp: preset.maxMp ?? fallback.derived.maxMp,
    maxSan: preset.maxSan ?? fallback.derived.maxSan,
    maxDp: preset.maxDp ?? fallback.derived.maxDp,
    tags: [...preset.tags],
    rarity: preset.rarity
  };
}

function validateAgainstPack(stats: NpcStats, effective: EffectivePack): string | null {
  if (stats.race !== null && effective.compiled.races[stats.race] === undefined) {
    return "规则包中没有种族 " + stats.race;
  }
  const knownSkills = new Set(effective.compiled.skills.map((skill) => skill.id));
  for (const skillId of Object.keys(stats.skills)) {
    if (knownSkills.has(skillId) === false) return "规则包中没有技能 " + skillId;
  }
  return null;
}

async function createNpcCard(
  roomId: string,
  userId: string,
  effective: EffectivePack,
  fields: {
    name: string;
    subtitle: string | null;
    description: string | null;
    rarity: string;
    stats: NpcStats;
  }
): Promise<string | null> {
  const knownRarities = RARITIES as readonly string[];
  if (knownRarities.includes(fields.rarity) === false) return "稀有度不合法";
  const bad = validateAgainstPack(fields.stats, effective);
  if (bad !== null) return bad;
  const card = await prisma.card.create({
    data: {
      scope: "ROOM",
      roomId,
      ownerId: userId,
      type: "NPC",
      name: fields.name,
      subtitle: fields.subtitle,
      description: fields.description,
      rarity: fields.rarity as never,
      system: effective.compiled.system,
      stats: { ...fields.stats } as never
    },
    select: { id: true }
  });
  return card.id;
}

export async function createPresetNpcAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const presetId = String(formData.get("presetId") ?? "");
  const room = await requireKp(roomId, session.user.id);
  if (room === null) redirectError(roomId, "只有 KP 能准备 NPC/Boss 卡");
  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const preset = effective.compiled.presets.find((item) => item.id === presetId);
  if (preset === undefined) redirectError(roomId, "预设角色不存在");
  const stats = materializePreset(preset, effective);
  const cardId = await createNpcCard(room.id, session.user.id, effective, {
    name: preset.name,
    subtitle: preset.subtitle ?? null,
    description: preset.description ?? null,
    rarity: preset.rarity,
    stats
  });
  if (cardId === null) redirectError(roomId, "预设角色数据不合法");
  revalidatePath("/rooms/" + room.id);
  emitRoomRefresh(room.id, "npc");
  redirect("/rooms/" + room.id);
}

function numberField(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  if (Number.isFinite(value) === false) return null;
  return Math.floor(value);
}

function parseAttributes(formData: FormData): NpcStats["attributes"] | null {
  const attributes: Record<string, number> = {};
  for (const key of NPC_ATTRIBUTE_KEYS) {
    const value = numberField(formData, "attr_" + key);
    if (value === null) return null;
    attributes[key] = value;
  }
  return attributes as NpcStats["attributes"];
}

function parseSkills(formData: FormData, effective: EffectivePack): { skills: Record<string, number> } | string {
  const raw = String(formData.get("skills") ?? "").trim();
  const skills: Record<string, number> = {};
  if (raw.length === 0) return { skills };
  const parts = raw.split(/[\n,，]/);
  for (const part of parts) {
    const line = part.trim();
    if (line.length === 0) continue;
    const pieces = line.split(/[:：=]/);
    const skillId = pieces[0]?.trim() ?? "";
    const value = Number(pieces[1]?.trim() ?? "0");
    if (skillId.length === 0 || Number.isFinite(value) === false) return "技能格式示例：DANMAKU:60";
    if (effective.compiled.skills.some((skill) => skill.id === skillId) === false) {
      return "规则包中没有技能 " + skillId;
    }
    skills[skillId] = Math.max(0, Math.floor(value));
  }
  return { skills };
}

function parseTags(formData: FormData): string[] {
  return String(formData.get("tags") ?? "")
    .split(/[,，]/)
    .map((tag) => tag.trim().toUpperCase())
    .filter((tag) => tag.length > 0)
    .slice(0, 20);
}

export async function createCustomNpcAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const room = await requireKp(roomId, session.user.id);
  if (room === null) redirectError(roomId, "只有 KP 能准备 NPC/Boss 卡");
  const name = String(formData.get("name") ?? "").trim().slice(0, 50);
  if (name.length === 0) redirectError(roomId, "请填写名字");
  const attributes = parseAttributes(formData);
  if (attributes === null) redirectError(roomId, "属性必须是数字");
  const maxHp = numberField(formData, "maxHp");
  const maxMp = numberField(formData, "maxMp");
  const maxSan = numberField(formData, "maxSan");
  const maxDp = numberField(formData, "maxDp");
  if (maxHp === null || maxMp === null || maxSan === null || maxDp === null) {
    redirectError(roomId, "HP/MP/SAN/DP 必须是数字");
  }
  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const skillsResult = parseSkills(formData, effective);
  if (typeof skillsResult === "string") redirectError(roomId, skillsResult);
  const tierRaw = String(formData.get("tier") ?? "STANDARD");
  const knownTiers = PRESET_TIERS as readonly string[];
  const tier = knownTiers.includes(tierRaw) ? tierRaw : "STANDARD";
  const rarityRaw = String(formData.get("rarity") ?? "COMMON");
  const raceRaw = String(formData.get("race") ?? "").trim();
  const parsed = NpcStatsSchema.safeParse({
    presetId: null,
    tier,
    rarity: rarityRaw,
    race: raceRaw.length === 0 ? null : raceRaw,
    attributes,
    skills: skillsResult.skills,
    maxHp,
    maxMp,
    maxSan,
    maxDp,
    tags: parseTags(formData)
  });
  if (parsed.success === false) {
    redirectError(roomId, parsed.error.issues[0]?.message ?? "NPC 数据不合法");
  }
  const cardId = await createNpcCard(room.id, session.user.id, effective, {
    name,
    subtitle: String(formData.get("subtitle") ?? "").trim().slice(0, 60) || null,
    description: String(formData.get("description") ?? "").trim().slice(0, 500) || null,
    rarity: parsed.data.rarity,
    stats: parsed.data
  });
  if (cardId === null) redirectError(roomId, "NPC 数据不合法");
  revalidatePath("/rooms/" + room.id);
  emitRoomRefresh(room.id, "npc");
  redirect("/rooms/" + room.id);
}

/** KP 切换某张 NPC / Boss 卡是否向玩家公开属性。 */
export async function setNpcVisibilityAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const cardId = String(formData.get("cardId") ?? "");
  const isPublic = String(formData.get("isPublic") ?? "0") === "1";
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null || membership.role !== "KP") redirect("/rooms/" + roomId);

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, roomId: true, scope: true, type: true }
  });
  if (card === null || card.roomId !== roomId || card.scope !== "ROOM" || card.type !== "NPC") {
    redirect("/rooms/" + roomId);
  }

  await prisma.card.update({ where: { id: card.id }, data: { isPublic } });
  revalidatePath("/rooms/" + roomId);
  emitRoomRefresh(roomId, "npc-visibility");
  redirect("/rooms/" + roomId);
}

function safeNpcReturnTo(roomId: string, raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "").trim();
  if (value.startsWith("/rooms/" + roomId) && value.startsWith("//") === false) return value;
  return "/rooms/" + roomId;
}

/** KP 编辑已有 NPC / Boss 卡的名称、属性、技能与公开数值。 */
export async function updateNpcAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const cardId = String(formData.get("cardId") ?? "");
  const returnTo = safeNpcReturnTo(roomId, formData.get("returnTo"));
  const room = await requireKp(roomId, session.user.id);
  if (room === null) redirect("/rooms/" + roomId);

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, roomId: true, scope: true, type: true, stats: true, subtitle: true }
  });
  if (card === null || card.roomId !== roomId || card.scope !== "ROOM" || card.type !== "NPC") {
    redirect(returnTo);
  }

  const name = String(formData.get("name") ?? "").trim().slice(0, 50);
  if (name.length === 0) redirectError(roomId, "请填写名字");
  const attributes = parseAttributes(formData);
  if (attributes === null) redirectError(roomId, "属性必须是数字");
  const maxHp = numberField(formData, "maxHp");
  const maxMp = numberField(formData, "maxMp");
  const maxSan = numberField(formData, "maxSan");
  const maxDp = numberField(formData, "maxDp");
  if (maxHp === null || maxMp === null || maxSan === null || maxDp === null) {
    redirectError(roomId, "HP/MP/SAN/DP 必须是数字");
  }

  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const skillsResult = parseSkills(formData, effective);
  if (typeof skillsResult === "string") redirectError(roomId, skillsResult);

  const existingParsed = NpcStatsSchema.safeParse(card.stats);
  const existing = existingParsed.success ? existingParsed.data : null;
  const tierRaw = String(formData.get("tier") ?? existing?.tier ?? "STANDARD");
  const knownTiers = PRESET_TIERS as readonly string[];
  const tier = knownTiers.includes(tierRaw) ? tierRaw : "STANDARD";
  const rarityRaw = String(formData.get("rarity") ?? existing?.rarity ?? "COMMON");
  const raceRaw = String(formData.get("race") ?? "").trim();
  const parsed = NpcStatsSchema.safeParse({
    presetId: existing?.presetId ?? null,
    tier,
    rarity: rarityRaw,
    race: raceRaw.length === 0 ? null : raceRaw,
    attributes,
    skills: skillsResult.skills,
    maxHp,
    maxMp,
    maxSan,
    maxDp,
    tags: parseTags(formData)
  });
  if (parsed.success === false) {
    redirectError(roomId, parsed.error.issues[0]?.message ?? "NPC 数据不合法");
  }
  const bad = validateAgainstPack(parsed.data, effective);
  if (bad !== null) redirectError(roomId, bad);

  await prisma.card.update({
    where: { id: card.id },
    data: {
      name,
      subtitle: String(formData.get("subtitle") ?? "").trim().slice(0, 60) || null,
      description: String(formData.get("description") ?? "").trim().slice(0, 500) || null,
      rarity: parsed.data.rarity as never,
      stats: { ...parsed.data } as never
    }
  });
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/prepare");
  emitRoomRefresh(roomId, "npc-updated");
  redirect(returnTo);
}
