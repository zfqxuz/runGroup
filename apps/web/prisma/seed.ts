import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const DEMO_PASSWORD = "demo1234";

interface SeedCard {
  readonly id: string;
  readonly type: "SPELLCARD" | "WEAPON" | "ITEM" | "NPC";
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly rarity: "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
  readonly stats: Prisma.InputJsonValue;
  readonly scope?: "COMPENDIUM" | "ROOM";
  readonly owner?: "KP" | "PLAYER";
  readonly equipped?: boolean;
  readonly isTemplate?: boolean;
}

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const kp = await prisma.user.upsert({
    where: { username: "demo_kp" },
    update: { displayName: "演示 KP", passwordHash },
    create: { username: "demo_kp", displayName: "演示 KP", email: "demo_kp@example.test", passwordHash }
  });

  const player = await prisma.user.upsert({
    where: { username: "demo_player" },
    update: { displayName: "演示玩家", passwordHash },
    create: { username: "demo_player", displayName: "演示玩家", email: "demo_player@example.test", passwordHash }
  });

  const room = await prisma.room.upsert({
    where: { inviteCode: "DEMO01" },
    update: {
      name: "演示房间 · 东方",
      system: "TOUHOU",
      ownerId: kp.id,
      status: "LOBBY",
      chargenMethod: "destiny5",
      description: "环境迁移后自动插入的演示数据"
    },
    create: {
      name: "演示房间 · 东方",
      system: "TOUHOU",
      ownerId: kp.id,
      inviteCode: "DEMO01",
      status: "LOBBY",
      chargenMethod: "destiny5",
      description: "环境迁移后自动插入的演示数据"
    }
  });

  await prisma.roomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId: kp.id } },
    update: { role: "KP" },
    create: { roomId: room.id, userId: kp.id, role: "KP" }
  });

  await prisma.roomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId: player.id } },
    update: { role: "PLAYER" },
    create: { roomId: room.id, userId: player.id, role: "PLAYER" }
  });

  const character = await prisma.character.upsert({
    where: { id: "seed-char-demo" },
    update: { userId: player.id, name: "演示角色 · 灵梦", system: "TOUHOU", race: "HUMAN", reviewStatus: "DRAFT" },
    create: {
      id: "seed-char-demo",
      userId: player.id,
      name: "演示角色 · 灵梦",
      system: "TOUHOU",
      race: "HUMAN",
      reviewStatus: "DRAFT",
      str: 40,
      con: 50,
      siz: 50,
      dex: 60,
      app: 50,
      int: 60,
      pow: 55,
      edu: 50,
      luck: 65,
      hp: 12,
      maxHp: 12,
      mp: 14,
      maxMp: 14,
      san: 55,
      maxSan: 55,
      dp: 10,
      maxDp: 10,
      skills: { DODGE: 40, DANMAKU: 60, SPIRIT_ARTS: 45 }
    }
  });

  await prisma.roomCharacterEntry.upsert({
    where: { roomId_characterId: { roomId: room.id, characterId: character.id } },
    update: { status: "PENDING_REVIEW", comment: null, submittedAt: new Date(), reviewedAt: null },
    create: { roomId: room.id, characterId: character.id, status: "PENDING_REVIEW" }
  });

  const cards: SeedCard[] = [
    { id: "seed-card-common", type: "WEAPON", name: "演示 · 木剑", subtitle: "普通", description: "用于验证 COMMON 边框", rarity: "COMMON", stats: { damage: "1d6", range: "MELEE", accuracyMod: 0, mpCost: 0 } },
    { id: "seed-card-uncommon", type: "ITEM", name: "演示 · 回复药", subtitle: "罕见", description: "用于验证 UNCOMMON 边框", rarity: "UNCOMMON", stats: { effect: "回复 1d4 点生命", uses: 3, sanCost: null } },
    { id: "seed-card-rare", type: "SPELLCARD", name: "演示 · 梦想封印", subtitle: "稀有", description: "用于验证 RARE 边框与角色装备", rarity: "RARE", equipped: true, isTemplate: true, stats: { mode: "DECLARATION", danmaku: "演示用弹幕", mpCost: 10, hpRatio: 2, durationTicks: 720, clearTargets: "ALL", enhanceType: "DANMAKU", enhanceValue: 1.5 } },
    { id: "seed-card-epic", type: "SPELLCARD", name: "演示 · 梦想天生", subtitle: "史诗", description: "用于验证 EPIC 边框", rarity: "EPIC", stats: { mode: "DECLARATION", danmaku: "演示用弹幕", mpCost: 30, hpRatio: 3, durationTicks: 900, clearTargets: "OTHERS_ONLY", enhanceType: "SPELL", enhanceValue: 2 } },
    { id: "seed-card-legendary", type: "SPELLCARD", name: "演示 · 无想的一刀", subtitle: "传说", description: "用于验证 LEGENDARY 边框", rarity: "LEGENDARY", stats: { mode: "CONSUMPTION", danmaku: "演示用弹幕", mpCost: 40, hpRatio: null, durationTicks: null, clearTargets: null, enhanceType: "AREA", enhanceValue: 3 } },
    { id: "seed-card-kp-template", type: "WEAPON", name: "演示 · KP 模板长枪", subtitle: "史诗", description: "由 KP 共享，用于验证跨用户模板可见与复制", rarity: "EPIC", scope: "COMPENDIUM", owner: "KP", isTemplate: true, stats: { damage: "2d8+2", range: "FAR", accuracyMod: 5, mpCost: 5 } },
    { id: "seed-card-boss", type: "NPC", name: "演示 Boss · 芙兰", subtitle: "Boss", description: "用于验证 ROOM 卡与传奇边框", rarity: "LEGENDARY", scope: "ROOM", owner: "KP", stats: { tier: "BOSS", race: "VAMPIRE", maxHp: 200, presetId: null } }
  ];

  for (const item of cards) {
    const ownerId = item.owner === "KP" ? kp.id : player.id;
    const data = {
      ownerId,
      scope: item.scope ?? "COMPENDIUM",
      roomId: item.scope === "ROOM" ? room.id : null,
      characterId: item.equipped === true ? character.id : null,
      isEquipped: item.equipped === true,
      isTemplate: item.isTemplate === true,
      type: item.type,
      name: item.name,
      subtitle: item.subtitle,
      description: item.description,
      rarity: item.rarity,
      system: "TOUHOU" as const,
      stats: item.stats
    };
    await prisma.card.upsert({
      where: { id: item.id },
      update: data,
      create: { id: item.id, ...data }
    });
  }

  const pendingCardIds = ["seed-card-common", "seed-card-uncommon", "seed-card-epic"];
  for (const cardId of pendingCardIds) {
    await prisma.roomCardEntry.upsert({
      where: { roomId_cardId: { roomId: room.id, cardId } },
      update: { status: "PENDING_REVIEW", comment: null, submittedAt: new Date(), reviewedAt: null },
      create: { roomId: room.id, cardId, status: "PENDING_REVIEW" }
    });
  }

  console.log("Seed 完成");
  console.log("KP：demo_kp / " + DEMO_PASSWORD);
  console.log("玩家：demo_player / " + DEMO_PASSWORD);
  console.log("邀请码：DEMO01");
}

main()
  .catch((error: unknown) => {
    console.error("Seed 失败", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
