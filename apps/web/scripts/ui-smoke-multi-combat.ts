/**
 * UI 冒烟：建一个真实房间 + 两场进行中战斗，供 HTTP 会话实际打开房间页验证 tab。
 * 用法：
 *   tsx scripts/ui-smoke-multi-combat.ts setup
 *   tsx scripts/ui-smoke-multi-combat.ts cleanup <roomId> <userId>
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, npcRef } from "../src/server/combat/setup";

const USERNAME = "e2eui";
const PASSWORD = "e2epass123";
const SOURCE_NPC_ID = "cmu409s9n005hcq5g9z9vbthp";

async function setup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.create({
    data: { username: USERNAME, displayName: USERNAME, passwordHash, role: "USER" }
  });
  const room = await prisma.room.create({
    data: {
      name: "E2E-UI 多战斗",
      system: "COC7",
      ownerId: user.id,
      inviteCode: "e2e-ui-" + Date.now().toString(36),
      status: "PLAYING",
      magicEnabled: true,
      ruleOverride: { magic: { enabled: true, system: "COC7", spells: [] } } as never
    }
  });
  await prisma.roomMember.create({ data: { roomId: room.id, userId: user.id, role: "KP" } });
  const sourceNpc = await prisma.card.findUniqueOrThrow({ where: { id: SOURCE_NPC_ID } });
  const scene = await prisma.scene.create({ data: { roomId: room.id, name: "E2E-UI 场景", isActive: true } });
  const map = await prisma.map.create({ data: { sceneId: scene.id, name: "E2E-UI 地图", width: 1000, height: 800, gridSize: 70 } });
  const effective = await loadEffectivePack({
    id: room.id, system: room.system, rulePackVersionId: room.rulePackVersionId, ruleOverride: room.ruleOverride
  });
  async function makeCard(label: string) {
    const card = await prisma.card.create({
      data: {
        roomId: room.id, scope: "ROOM", type: "NPC", name: label,
        system: sourceNpc.system, stats: sourceNpc.stats as never
      }
    });
    await prisma.token.create({ data: { roomId: room.id, mapId: map.id, cardId: card.id, name: card.name, x: 200 + card.id.length, y: 200 } });
    return card;
  }
  // 一张未放入地图的 NPC：用于验证选择器「尚未放入地图」置灰。
  await prisma.card.create({
    data: {
      roomId: room.id, scope: "ROOM", type: "NPC", name: "E2E-UI 未入场",
      system: sourceNpc.system, stats: sourceNpc.stats as never
    }
  });
  for (const index of [1, 2]) {
    const ally = await makeCard("E2E-UI 我方" + String(index));
    const enemy = await makeCard("E2E-UI 敌方" + String(index));
    const created = await createCombatRecord(room.id, effective, [npcRef(ally.id)], [npcRef(enemy.id)]);
    if (created.ok === false) throw new Error("combat create failed: " + String(created.error));
  }
  console.log(JSON.stringify({ roomId: room.id, userId: user.id, username: USERNAME, password: PASSWORD }));
}

async function cleanup(roomId: string, userId: string): Promise<void> {
  await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  console.log("cleaned");
}

const [mode, roomId, userId] = process.argv.slice(2);
const run = mode === "cleanup" && roomId !== undefined && userId !== undefined
  ? cleanup(roomId, userId)
  : setup();
run.catch((error) => {
  console.error("UI SMOKE FAILED", error);
  process.exitCode = 1;
}).finally(() => {
  void prisma.$disconnect();
});
