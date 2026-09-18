/**
 * 战斗 E2E：开局后才通过审核、没有 GameCharacter 的角色进入战斗时，
 * 必须自动补一条局内角色；被打死 / 中止后，HP 与 DEAD 状态要写回该行。
 */
import { endCombat } from "@touhou/combat";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, npcRef, saveCombatState } from "../src/server/combat/setup";
import { loadCombatRuntime } from "../src/server/combat/runtime";
import { NpcStatsSchema } from "../src/shared/npc";

function assert(condition: boolean, message: string): asserts condition {
  if (condition === false) throw new Error("战斗晚加入 E2E FAILED: " + message);
}

async function main(): Promise<void> {
  const username = "e2e_late_combat_" + Date.now().toString(36);
  const user = await prisma.user.create({
    data: { username, displayName: "后加入验证", passwordHash: "not-used" },
    select: { id: true }
  });
  let roomId: string | null = null;
  try {
    const room = await prisma.room.create({
      data: {
        name: "E2E 后加入战斗房",
        system: "COC7",
        status: "PLAYING",
        ownerId: user.id,
        inviteCode: "LATE" + Date.now().toString(36).slice(-4).toUpperCase(),
        members: { create: { userId: user.id, role: "KP" } }
      },
      select: { id: true, system: true, rulePackVersionId: true, ruleOverride: true }
    });
    roomId = room.id;

    const character = await prisma.character.create({
      data: {
        userId: user.id,
        system: "COC7",
        name: "E2E 后加入调查员",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 12, maxHp: 12, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 0, maxDp: 0, skills: {}
      }
    });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });

    const game = await prisma.game.create({
      data: { roomId: room.id, status: "PLAYING", title: "E2E 后加入局", createdBy: user.id },
      select: { id: true }
    });
    await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
    // 注意：这里故意不创建 GameCharacter，模拟开局后才入房 / 补交角色卡。

    const npc = await prisma.card.create({
      data: {
        scope: "ROOM", roomId: room.id, ownerId: user.id, type: "NPC", name: "E2E 木桩", system: "COC7",
        stats: NpcStatsSchema.parse({
          attributes: { str: 10, con: 10, siz: 10, dex: 10, app: 10, int: 10, pow: 10, edu: 10, luck: 10 },
          skills: {}, maxHp: 30, maxMp: 0, maxSan: 30, maxDp: 0
        }) as never
      }
    });
    const effective = await loadEffectivePack({
      id: room.id,
      system: room.system,
      rulePackVersionId: room.rulePackVersionId,
      ruleOverride: room.ruleOverride
    });
    const created = await createCombatRecord(room.id, effective, [characterRef(character.id)], [npcRef(npc.id)]);
    assert(created.ok === true && created.combatId !== undefined, created.error ?? "创建战斗失败");
    const combatId = created.combatId as string;

    const createdGameCharacter = await prisma.gameCharacter.findUnique({
      where: { gameId_characterId: { gameId: game.id, characterId: character.id } }
    });
    assert(createdGameCharacter !== null, "进入战斗时应为无 GameCharacter 的角色补一条局内角色");
    assert(createdGameCharacter.currentHp === character.hp, "补建 GameCharacter 应继承角色基础 HP");
    assert(createdGameCharacter.currentMp === character.mp, "补建 GameCharacter 应继承角色基础 MP");
    assert(createdGameCharacter.currentSan === character.san, "补建 GameCharacter 应继承角色基础 SAN");
    assert(createdGameCharacter.currentDp === character.dp, "补建 GameCharacter 应继承角色基础 DP");

    const runtime = await loadCombatRuntime(combatId);
    assert(runtime !== null, "战斗 runtime 可加载");
    const pc = runtime.state.participants.find((participant) => participant.characterId === character.id);
    assert(pc !== undefined, "战斗中存在该 PC");
    pc.hp = 0;
    pc.dead = true;
    pc.majorWound = true;
    pc.unconscious = true;
    pc.defeated = true;
    endCombat(runtime.state, "E2E 死亡测试");
    await saveCombatState(combatId, runtime.state);

    const afterDeath = await prisma.gameCharacter.findUniqueOrThrow({
      where: { gameId_characterId: { gameId: game.id, characterId: character.id } }
    });
    assert(afterDeath.currentHp === 0, "死亡后 GameCharacter.currentHp 应为 0，实际 " + String(afterDeath.currentHp));
    assert(afterDeath.status === "DEAD", "死亡后 GameCharacter.status 应为 DEAD，实际 " + afterDeath.status);
    const conditionTypes = (afterDeath.conditions as Array<{ type?: unknown }>).map((condition) => condition.type);
    assert(conditionTypes.includes("DEAD"), "死亡后应写入 DEAD 持久条件");
    assert(conditionTypes.includes("UNCONSCIOUS"), "死亡后应写入 UNCONSCIOUS 持久条件");

    const roomAfter = await prisma.room.findUniqueOrThrow({ where: { id: room.id }, select: { status: true } });
    assert(roomAfter.status === "PLAYING", "战斗结束后房间应回到 PLAYING");

    console.log("PASS 战斗晚加入 E2E：无 GameCharacter 自动补建 → 战斗死亡写回 HP 0 / DEAD");
    console.log("  角色 " + character.id + "，战斗 " + combatId);
  } finally {
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
