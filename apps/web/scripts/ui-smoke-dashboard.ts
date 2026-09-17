/**
 * UI 冒烟：建一个真实玩家房间，验证地图左侧看板与「只显示自己持有法术」的施法面板。
 * 用法：
 *   tsx scripts/ui-smoke-dashboard.ts setup
 *   tsx scripts/ui-smoke-dashboard.ts cleanup <roomId> <userId>
 */
import bcrypt from "bcryptjs";
import { makeCondition } from "@touhou/rules";
import { prisma } from "../src/server/db/prisma";

const USERNAME = "e2edash";
const PASSWORD = "e2epass123";
const SOURCE_CHARACTER_ID = "cmtxofchd0001mx564v5ztjog";
const SOURCE_NPC_ID = "cmu409s9n005hcq5g9z9vbthp";

const SPELLS = [
  { id: "e2e-heal", name: "E2E治疗术", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "ONE", targeting: "ALLY", effects: [{ type: "HEAL", amount: "1d6" }] },
  { id: "e2e-possess", name: "E2E夺舍术", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "ONE", targeting: "ENEMY", effects: [{ type: "POSSESS", durationTurns: "3" }] },
  { id: "e2e-summon", name: "E2E召唤术", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "SELF", targeting: "SELF", effects: [{ type: "SUMMON", name: "异次元蹒跚者", count: "1", durationTicks: "0" }] }
];

async function setup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const source = await prisma.character.findUniqueOrThrow({ where: { id: SOURCE_CHARACTER_ID } });
  const sourceNpc = await prisma.card.findUniqueOrThrow({ where: { id: SOURCE_NPC_ID } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.create({ data: { username: USERNAME, displayName: USERNAME, passwordHash } });
  const room = await prisma.room.create({
    data: {
      name: "E2E-UI 看板", system: "COC7", ownerId: user.id, inviteCode: "e2e-dash-" + Date.now().toString(36),
      status: "PLAYING", magicEnabled: true,
      ruleOverride: { magic: { enabled: true, system: "COC7", spells: SPELLS } } as never
    }
  });
  const player = await prisma.character.create({
    data: {
      userId: user.id, roomId: room.id, system: source.system, name: "E2E·看板玩家", occupation: source.occupation,
      age: source.age, str: source.str, con: source.con, siz: source.siz, dex: source.dex, app: source.app,
      int: source.int, pow: source.pow, edu: source.edu, luck: source.luck,
      hp: source.hp, maxHp: source.maxHp, mp: source.mp, maxMp: source.maxMp,
      san: source.san, maxSan: source.maxSan, dp: source.dp, maxDp: source.maxDp,
      skills: source.skills as never, raceMods: source.raceMods as never,
      skillAllocation: source.skillAllocation as never,
      sourceData: { spells: ["e2e-heal"] } as never, era: source.era
    }
  });
  await prisma.roomMember.create({
    data: { roomId: room.id, userId: user.id, role: "PLAYER", activeCharacterId: player.id, ready: true }
  });
  await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: player.id, status: "APPROVED" } });
  const game = await prisma.game.create({ data: { roomId: room.id, title: "E2E-UI 看板局", status: "PLAYING", createdBy: user.id } });
  await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
  await prisma.gameCharacter.create({
    data: {
      gameId: game.id, characterId: player.id, userId: user.id, status: "ALIVE",
      currentHp: 9, currentMp: 7, currentSan: 44, currentDp: 3,
      conditions: [
        makeCondition({ type: "ARMOR", unit: "ROUND", remaining: 2, data: { armor: 6 } }),
        makeCondition({ type: "STATUS:HASTE", unit: "ROUND", remaining: 3, data: { key: "HASTE", stacks: 1 } })
      ] as never
    }
  });
  const scene = await prisma.scene.create({ data: { roomId: room.id, name: "E2E-UI 看板场景", isActive: true } });
  const map = await prisma.map.create({ data: { sceneId: scene.id, name: "看板地图", width: 1000, height: 800, gridSize: 70 } });
  await prisma.token.create({ data: { roomId: room.id, mapId: map.id, characterId: player.id, name: player.name, x: 200, y: 200 } });
  const npc = await prisma.card.create({
    data: {
      roomId: room.id, scope: "ROOM", type: "NPC", name: "E2E·看板NPC", system: sourceNpc.system,
      stats: { ...(sourceNpc.stats as Record<string, unknown>), spells: ["e2e-possess"] } as never
    }
  });
  await prisma.token.create({ data: { roomId: room.id, mapId: map.id, cardId: npc.id, name: npc.name, x: 400, y: 200 } });
  console.log(JSON.stringify({ roomId: room.id, userId: user.id, username: USERNAME, password: PASSWORD }));
}

async function cleanup(roomId: string, userId: string): Promise<void> {
  await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  console.log("cleaned");
}

const [mode, roomId, userId] = process.argv.slice(2);
const run = mode === "cleanup" && roomId !== undefined && userId !== undefined ? cleanup(roomId, userId) : setup();
run.catch((error) => {
  console.error("UI DASHBOARD SMOKE FAILED", error);
  process.exitCode = 1;
}).finally(() => {
  void prisma.$disconnect();
});
