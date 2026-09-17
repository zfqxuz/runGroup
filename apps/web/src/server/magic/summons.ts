import type { SummonTemplate } from "@touhou/combat";
import type { CompiledRulePack } from "@touhou/rules";
import { prisma } from "@/server/db/prisma";

export interface SummonOrigin {
  readonly spellId?: string;
  readonly spellName?: string;
  readonly casterId?: string | null;
  readonly casterName?: string | null;
}

interface RecordLike {
  readonly [key: string]: unknown;
}

function recordOf(value: unknown): RecordLike {
  return value !== null && typeof value === "object" && Array.isArray(value) === false ? (value as RecordLike) : {};
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isSummonCard(card: { readonly stats: unknown }): boolean {
  return recordOf(card.stats).summoned === true;
}

export function summonOriginOf(card: { readonly stats: unknown }): SummonOrigin {
  const origin = recordOf(recordOf(card.stats).summonOrigin);
  return {
    spellId: stringOf(origin.spellId) || undefined,
    spellName: stringOf(origin.spellName) || undefined,
    casterId: stringOf(origin.casterId) || null,
    casterName: stringOf(origin.casterName) || null
  };
}

function statsOfTemplate(template: SummonTemplate, origin: SummonOrigin): Record<string, unknown> {
  return {
    presetId: null,
    tier: "STANDARD",
    race: "SUMMON",
    attributes: template.attributes,
    skills: template.skills ?? {},
    weapons: template.weapons ?? [],
    spells: template.spells ?? [],
    maxHp: template.derived.maxHp,
    maxMp: template.derived.maxMp,
    maxSan: template.derived.maxSan,
    maxDp: template.derived.maxDp,
    currentHp: template.derived.maxHp,
    currentMp: template.derived.maxMp,
    currentSan: template.derived.maxSan,
    currentDp: template.derived.maxDp,
    armorExpression: template.armorExpression ?? "0",
    tags: ["SUMMON"],
    rarity: "COMMON",
    summoned: true,
    summonOrigin: {
      ...origin,
      createdAt: new Date().toISOString()
    }
  };
}

/**
 * 把召唤物落到施法者当前所在场景：施法者没有 Token 时只建卡不建 Token。
 * 召唤物 Token 复用现有场景地图，坐标取施法者附近并由唯一约束兜底。
 */
async function placeSummonToken(roomId: string, cardId: string, casterId: string | null | undefined): Promise<void> {
  if (casterId === null || casterId === undefined || casterId.length === 0) return;
  const casterToken = await prisma.token.findFirst({
    where: { roomId, OR: [{ characterId: casterId }, { cardId: casterId }] },
    select: { mapId: true, x: true, y: true, roomId: true }
  });
  if (casterToken === null) return;
  const existing = await prisma.token.findFirst({ where: { roomId, cardId }, select: { id: true } });
  if (existing !== null) return;
  const map = await prisma.map.findUnique({
    where: { id: casterToken.mapId },
    select: { width: true, height: true, gridSize: true }
  });
  if (map === null) return;
  const grid = map.gridSize > 0 ? map.gridSize : 70;
  // 优先放在施法者旁边一格；被占用时沿四周扩散。
  const offsets: readonly (readonly [number, number])[] = [
    [grid, 0], [0, grid], [-grid, 0], [0, -grid],
    [grid, grid], [-grid, -grid], [grid, -grid], [-grid, grid]
  ];
  for (const offset of offsets) {
    const dx = offset[0];
    const dy = offset[1];
    const x = Math.max(0, Math.min(map.width, casterToken.x + dx));
    const y = Math.max(0, Math.min(map.height, casterToken.y + dy));
    const occupied = await prisma.token.findFirst({
      where: { mapId: casterToken.mapId, x, y },
      select: { id: true }
    });
    if (occupied !== null) continue;
    await prisma.token.create({
      data: { roomId, mapId: casterToken.mapId, cardId, name: "", x, y }
    }).catch(() => undefined);
    return;
  }
}

export async function createPersistentSummonCard(input: {
  readonly id: string;
  readonly roomId: string;
  readonly ownerId?: string | null;
  readonly pack: CompiledRulePack;
  readonly template: SummonTemplate;
  readonly origin: SummonOrigin;
}): Promise<void> {
  const stats = statsOfTemplate(input.template, input.origin);
  await prisma.card.upsert({
    where: { id: input.id },
    update: {
      name: input.template.name,
      subtitle: "召唤物",
      description: "由魔法召唤生成，可被放入地图；战斗中可选择为参战 NPC。",
      stats: stats as never,
      system: input.pack.system as never,
      roomId: input.roomId,
      scope: "ROOM",
      type: "NPC"
    },
    create: {
      id: input.id,
      roomId: input.roomId,
      ownerId: input.ownerId ?? null,
      scope: "ROOM",
      type: "NPC",
      name: input.template.name,
      subtitle: "召唤物",
      description: "由魔法召唤生成，可被放入地图；战斗中可选择为参战 NPC。",
      rarity: "COMMON",
      stats: stats as never,
      system: input.pack.system as never
    } as never
  });
  await placeSummonToken(input.roomId, input.id, input.origin.casterId);
}

export async function removeSummonCardById(cardId: string): Promise<void> {
  await prisma.token.deleteMany({ where: { cardId } });
  await prisma.card.deleteMany({ where: { id: cardId } });
}

export async function removeSummonCards(roomId: string, options: { readonly spellId?: string } = {}): Promise<number> {
  const cards = await prisma.card.findMany({
    where: { roomId, scope: "ROOM", type: "NPC" },
    select: { id: true, stats: true }
  });
  const ids = cards
    .filter((card) => isSummonCard(card))
    .filter((card) => options.spellId === undefined || summonOriginOf(card).spellId === options.spellId)
    .map((card) => card.id);
  if (ids.length === 0) return 0;
  await prisma.token.deleteMany({ where: { cardId: { in: ids } } });
  await prisma.card.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}
