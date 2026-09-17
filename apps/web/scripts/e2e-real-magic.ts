/**
 * 真实环境 E2E：在生产库里建一个独立测试房间，用真实角色 / 真实 NPC 卡 / 真实场景地图 Token，
 * 直接调用真实服务器函数验证：
 *   1. 场景隔离（不同场景不能开战、未入场不能参战）
 *   2. 进行中战斗席位互斥
 *   3. 战斗内夺舍充能池按行动轮次消耗 + saveCombatState 写回局内状态
 *   4. 战斗外施法（HEAL / POSSESS / SUMMON），POSSESS 被 Token 移动消耗
 *   5. 持久召唤匹配真实卡、落成持久卡 + 场景 Token、关闭魔法时清理
 *   6. 战斗外禁止伤害类法术
 *
 * 运行：docker exec -w /repo/apps/web touhou-trpg-app npx tsx scripts/e2e-real-magic.ts
 */
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, listSelectableUnits, npcRef, saveCombatState } from "../src/server/combat/setup";
import { loadCombatRuntime, clearCombatRuntime } from "../src/server/combat/runtime";
import {
  consumePossessCharge,
  loadCardConditions,
  possessChargeForToken
} from "../src/server/magic/conditions";
import { castOutsideCombat } from "../src/server/magic/out-of-combat";
import { removeSummonCards } from "../src/server/magic/summons";
import { cleanupDefeatedSummons } from "../src/server/socket/combat";
import { findCondition, parseConditions } from "@touhou/rules";
import { endCombat, resolveInitiativeTurn, submitAction, endTurn } from "@touhou/combat";

const MARK = "E2E-" + Date.now().toString(36);
const SOURCE_NPC_ID = "cmu409s9n005hcq5g9z9vbthp"; // 真实房间里的「食尸鬼（秘境使者）」
const SOURCE_CHARACTER_ID = "cmtxofchd0001mx564v5ztjog"; // 真实角色「起」

let pass = 0;
let fail = 0;
function check(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    pass += 1;
    console.log("PASS " + label);
  } else {
    fail += 1;
    console.log("FAIL " + label + (detail === undefined ? "" : " :: " + JSON.stringify(detail)));
  }
}

const MAGIC_SPELLS = [
  { id: "e2e-heal", name: "E2E治疗术", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "ONE", targeting: "ALLY", effects: [{ type: "HEAL", amount: "1d6" }] },
  { id: "e2e-possess", name: "E2E夺舍术", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "ONE", targeting: "ENEMY", effects: [{ type: "POSSESS", durationTurns: "3" }] },
  { id: "e2e-summon", name: "E2E召唤术", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "SELF", targeting: "SELF", effects: [{ type: "SUMMON", name: "异次元蹒跚者", count: "1", durationTicks: "0" }] },
  { id: "e2e-summon-duration", name: "E2E限时召唤术", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "SELF", targeting: "SELF", effects: [{ type: "SUMMON", name: "异次元蹒跚者", count: "1", durationTicks: "2" }] },
  { id: "e2e-damage", name: "E2E伤害术", skill: "OCCULT", mpCost: "0", sanCost: "0", target: "ONE", targeting: "ENEMY", effects: [{ type: "DAMAGE", amount: "1d6" }] }
];

async function main(): Promise<void> {
  const sourceCharacter = await prisma.character.findUniqueOrThrow({ where: { id: SOURCE_CHARACTER_ID } });
  const sourceNpc = await prisma.card.findUniqueOrThrow({ where: { id: SOURCE_NPC_ID } });

  // ---------- 建真实测试房间 ----------
  const user = await prisma.user.create({
    data: { username: MARK.toLowerCase(), displayName: MARK, passwordHash: "x", role: "USER" }
  });
  const room = await prisma.room.create({
    data: {
      name: MARK + " 房间",
      system: "COC7",
      ownerId: user.id,
      inviteCode: MARK + "-invite",
      status: "PLAYING",
      magicEnabled: true,
      chargenMethod: "PRESET",
      era: "MODERN",
      ruleOverride: {
        magic: { enabled: true, system: "COC7", spells: MAGIC_SPELLS }
      } as never
    }
  });
  await prisma.roomMember.create({ data: { roomId: room.id, userId: user.id, role: "KP" } });

  // 真实角色克隆进测试房间
  const player = await prisma.character.create({
    data: {
      userId: user.id,
      roomId: room.id,
      system: sourceCharacter.system,
      name: MARK + "·玩家",
      occupation: sourceCharacter.occupation,
      age: sourceCharacter.age,
      str: sourceCharacter.str, con: sourceCharacter.con, siz: sourceCharacter.siz, dex: sourceCharacter.dex,
      app: sourceCharacter.app, int: sourceCharacter.int, pow: sourceCharacter.pow, edu: sourceCharacter.edu, luck: sourceCharacter.luck,
      hp: sourceCharacter.hp, maxHp: sourceCharacter.maxHp,
      mp: sourceCharacter.mp, maxMp: sourceCharacter.maxMp,
      san: sourceCharacter.san, maxSan: sourceCharacter.maxSan,
      dp: sourceCharacter.dp, maxDp: sourceCharacter.maxDp,
      skills: sourceCharacter.skills as never,
      raceMods: sourceCharacter.raceMods as never,
      skillAllocation: sourceCharacter.skillAllocation as never,
      era: sourceCharacter.era
    }
  });
  await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: player.id, status: "APPROVED" } });

  const game = await prisma.game.create({
    data: { roomId: room.id, title: MARK + " 局", status: "PLAYING", createdBy: user.id }
  });
  await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
  await prisma.gameCharacter.create({
    data: {
      gameId: game.id,
      characterId: player.id,
      userId: user.id,
      status: "ALIVE",
      currentHp: player.maxHp,
      currentMp: player.maxMp,
      currentSan: player.maxSan,
      currentDp: player.maxDp,
      conditions: [] as never
    }
  });

  // 第二场战斗用的真实角色（多场战斗互斥测试）
  const playerSecond = await prisma.character.create({
    data: {
      userId: user.id, roomId: room.id, system: sourceCharacter.system, name: MARK + "·玩家二",
      occupation: sourceCharacter.occupation, age: sourceCharacter.age,
      str: sourceCharacter.str, con: sourceCharacter.con, siz: sourceCharacter.siz, dex: sourceCharacter.dex,
      app: sourceCharacter.app, int: sourceCharacter.int, pow: sourceCharacter.pow, edu: sourceCharacter.edu, luck: sourceCharacter.luck,
      hp: sourceCharacter.hp, maxHp: sourceCharacter.maxHp,
      mp: sourceCharacter.mp, maxMp: sourceCharacter.maxMp,
      san: sourceCharacter.san, maxSan: sourceCharacter.maxSan,
      dp: sourceCharacter.dp, maxDp: sourceCharacter.maxDp,
      skills: sourceCharacter.skills as never, raceMods: sourceCharacter.raceMods as never,
      skillAllocation: sourceCharacter.skillAllocation as never, era: sourceCharacter.era
    }
  });
  await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: playerSecond.id, status: "APPROVED" } });
  await prisma.gameCharacter.create({
    data: {
      gameId: game.id, characterId: playerSecond.id, userId: user.id, status: "ALIVE",
      currentHp: playerSecond.maxHp, currentMp: playerSecond.maxMp,
      currentSan: playerSecond.maxSan, currentDp: playerSecond.maxDp, conditions: [] as never
    }
  });

  // 真实 NPC 卡（同场景 / 异场景 / 召唤目标 / 未入场）
  async function cloneNpc(name: string, overrides?: Record<string, unknown>) {
    const stats = { ...(sourceNpc.stats as Record<string, unknown>), ...(overrides ?? {}) };
    return prisma.card.create({
      data: {
        roomId: room.id, scope: "ROOM", type: "NPC", name,
        subtitle: sourceNpc.subtitle,
        description: sourceNpc.description,
        rarity: sourceNpc.rarity,
        system: sourceNpc.system,
        stats: stats as never
      }
    });
  }
  const npcSameScene = await cloneNpc("E2E·食尸鬼A");
  const npcOtherScene = await cloneNpc("E2E·食尸鬼B");
  const npcNoToken = await cloneNpc("E2E·食尸鬼C");
  const npcSecondFight = await cloneNpc("E2E·食尸鬼D");
  const npcThirdFight = await cloneNpc("E2E·食尸鬼E");
  const summonSource = await cloneNpc("异次元蹒跚者");

  // 真实场景 / 地图 / Token
  const sceneA = await prisma.scene.create({ data: { roomId: room.id, name: "E2E场景A", isActive: true } });
  const mapA = await prisma.map.create({ data: { sceneId: sceneA.id, name: "地图A", width: 1000, height: 800, gridSize: 70 } });
  const sceneB = await prisma.scene.create({ data: { roomId: room.id, name: "E2E场景B" } });
  const mapB = await prisma.map.create({ data: { sceneId: sceneB.id, name: "地图B", width: 1000, height: 800, gridSize: 70 } });
  await prisma.token.create({ data: { roomId: room.id, mapId: mapA.id, characterId: player.id, name: player.name, x: 100, y: 100 } });
  await prisma.token.create({ data: { roomId: room.id, mapId: mapA.id, cardId: npcSameScene.id, name: npcSameScene.name, x: 300, y: 100 } });
  await prisma.token.create({ data: { roomId: room.id, mapId: mapB.id, cardId: npcOtherScene.id, name: npcOtherScene.name, x: 100, y: 100 } });
  await prisma.token.create({ data: { roomId: room.id, mapId: mapA.id, characterId: playerSecond.id, name: playerSecond.name, x: 200, y: 200 } });
  await prisma.token.create({ data: { roomId: room.id, mapId: mapA.id, cardId: npcSecondFight.id, name: npcSecondFight.name, x: 400, y: 200 } });
  await prisma.token.create({ data: { roomId: room.id, mapId: mapA.id, cardId: npcThirdFight.id, name: npcThirdFight.name, x: 500, y: 200 } });

  const effective = await loadEffectivePack({
    id: room.id, system: room.system, rulePackVersionId: room.rulePackVersionId, ruleOverride: room.ruleOverride
  });
  const spellById = new Map(effective.compiled.pack.magic?.spells.map((spell) => [spell.id, spell]) ?? []);
  check(spellById.size >= MAGIC_SPELLS.length, "真实规则包已加载测试法术", [...spellById.keys()]);

  let combatId: string | null = null;
  try {
    // ---------- 1. 场景隔离 ----------
    const crossScene = await createCombatRecord(room.id, effective, [characterRef(player.id)], [npcRef(npcOtherScene.id)]);
    check(crossScene.ok === false && String(crossScene.error ?? "").includes("同一场景"), "不同场景不能开战", crossScene.error);

    const noToken = await createCombatRecord(room.id, effective, [characterRef(player.id)], [npcRef(npcNoToken.id)]);
    check(noToken.ok === false && String(noToken.error ?? "").includes("尚未放入地图"), "未入场单位不能参战", noToken.error);

    // ---------- 2. 正常开战 ----------
    const created = await createCombatRecord(room.id, effective, [characterRef(player.id)], [npcRef(npcSameScene.id)]);
    check(created.ok === true && created.combatId !== undefined, "同场景可正常开战", created.error);
    if (created.ok === false || created.combatId === undefined) return;
    combatId = created.combatId;

    // ---------- 3. 席位互斥 ----------
    const duplicate = await createCombatRecord(room.id, effective, [characterRef(player.id)], [npcRef(npcSameScene.id)]);
    check(duplicate.ok === false && String(duplicate.error ?? "").includes("另一场"), "同一单位不能同时参加两场战斗", duplicate.error);

    // ---------- 3.5 选择器资格：未入场 / 已在其它战斗置灰 ----------
    const options = await listSelectableUnits(room.id, user.id, "KP");
    const optionByRef = new Map(options.map((option) => [option.ref, option]));
    const playerOption = optionByRef.get(characterRef(player.id));
    const noTokenOption = optionByRef.get(npcRef(npcNoToken.id));
    const freeOption = optionByRef.get(npcRef(npcOtherScene.id));
    check(
      playerOption?.eligible === false && playerOption?.activeCombatId === combatId &&
        String(playerOption?.ineligibleReason ?? "").includes("另一场"),
      "已在其它战斗的单位在选择器里被标记为不可参战",
      playerOption
    );
    check(
      noTokenOption?.sceneId === null && noTokenOption?.eligible === false &&
        String(noTokenOption?.ineligibleReason ?? "").includes("尚未放入地图"),
      "未入场单位在选择器里被标记为不可参战",
      noTokenOption
    );
    check(
      freeOption?.eligible === true && freeOption?.activeCombatId === null && freeOption?.sceneName !== null,
      "已入场且空闲的单位可选择",
      freeOption
    );

    // ---------- 4. 战斗内夺舍：真实 runtime + 真实结算函数 ----------
    const runtime = await loadCombatRuntime(combatId);
    if (runtime === null) {
      check(false, "战斗 runtime 可加载");
      return;
    }
    check(runtime.state.participants.length === 2, "战斗包含真实玩家与真实 NPC");
    const pc = runtime.state.participants.find((item) => item.id === player.id);
    const npc = runtime.state.participants.find((item) => item.id === npcSameScene.id);
    check(pc !== undefined && npc !== undefined, "找到玩家与 NPC 参战单位");
    if (pc === undefined || npc === undefined) return;

    runtime.state.initiativeOrder = [npc.id, pc.id];
    runtime.state.activeIndex = 0;
    runtime.state.phase = "AWAITING_ACTION";
    for (const participant of runtime.state.participants) participant.isReady = participant.id === npc.id;
    const submitted = submitAction(runtime.state, {
      actorId: npc.id, kind: "MAGIC", spellId: "e2e-possess", name: "E2E夺舍术", targetId: pc.id
    });
    check(submitted === true, "NPC 提交夺舍行动");
    resolveInitiativeTurn(runtime.pack, runtime.state, {});
    check(pc.possessedBy === npc.id && pc.possessCharges === 3, "战斗内夺舍写入充能池 3 格", {
      possessedBy: pc.possessedBy, charges: pc.possessCharges
    });

    // 一场战斗有 2 名参战者：endTurn 走完一轮才会进入下一行动轮次并结算充能。
    const roundBefore = runtime.state.round;
    endTurn(runtime.pack, runtime.state);
    endTurn(runtime.pack, runtime.state);
    check(
      runtime.state.round === roundBefore + 1 && pc.possessCharges === 2,
      "经过 1 个完整行动轮次消耗 1 格充能",
      { round: runtime.state.round, charges: pc.possessCharges }
    );

    await saveCombatState(combatId, runtime.state);
    const gcAfter = await prisma.gameCharacter.findFirstOrThrow({ where: { gameId: game.id, characterId: player.id } });
    const gcConditions = parseConditions(gcAfter.conditions);
    const gcPossess = findCondition(gcConditions, "POSSESS");
    check(gcPossess !== null && gcPossess.duration.remaining === 2, "saveCombatState 把夺舍充能写回 GameCharacter.conditions", {
      conditions: gcConditions.map((condition) => ({ type: condition.type, remaining: condition.duration.remaining }))
    });

    // ---------- 5. 战斗外施法：HEAL ----------
    await prisma.gameCharacter.updateMany({ where: { gameId: game.id, characterId: player.id }, data: { currentHp: 5 } });
    const healSpell = spellById.get("e2e-heal");
    if (healSpell === undefined) { check(false, "找到治疗法术"); return; }
    const healResult = await castOutsideCombat({
      roomId: room.id, pack: effective.compiled, spell: healSpell,
      caster: { kind: "CHARACTER", id: player.id }, target: { kind: "CHARACTER", id: player.id }
    });
    const healed = await prisma.gameCharacter.findFirstOrThrow({ where: { gameId: game.id, characterId: player.id } });
    check(healResult.ok === true && healed.currentHp > 5, "战斗外治疗真实生效", { hp: healed.currentHp, log: healResult.log });

    // ---------- 6. 战斗外夺舍 + Token 移动充能 ----------
    const possessSpell = spellById.get("e2e-possess");
    if (possessSpell === undefined) { check(false, "找到夺舍法术"); return; }
    const possessResult = await castOutsideCombat({
      roomId: room.id, pack: effective.compiled, spell: possessSpell,
      caster: { kind: "CHARACTER", id: player.id }, target: { kind: "CARD", id: npcSameScene.id }
    });
    const npcConditions = await loadCardConditions(npcSameScene.id);
    const npcPossess = findCondition(npcConditions, "POSSESS");
    check(possessResult.ok === true && npcPossess !== null && npcPossess.duration.remaining === 3, "战斗外夺舍写入真实 NPC 卡局内状态", {
      conditions: npcConditions.map((condition) => ({ type: condition.type, unit: condition.duration.unit, remaining: condition.duration.remaining }))
    });

    const beforeMove = await possessChargeForToken({ roomId: room.id, characterId: null, cardId: npcSameScene.id });
    const move1 = await consumePossessCharge({ roomId: room.id, characterId: null, cardId: npcSameScene.id });
    const move2 = await consumePossessCharge({ roomId: room.id, characterId: null, cardId: npcSameScene.id });
    const move3 = await consumePossessCharge({ roomId: room.id, characterId: null, cardId: npcSameScene.id });
    const afterAll = await loadCardConditions(npcSameScene.id);
    check(beforeMove === 3 && move1.remaining === 2 && move2.remaining === 1 && move3.expired === true, "Token 移动按次消耗夺舍充能并在耗尽时释放", {
      beforeMove, move1: move1.remaining, move2: move2.remaining, move3Expired: move3.expired
    });
    check(findCondition(afterAll, "POSSESS") === null, "充能耗尽后 NPC 卡上的夺舍状态被清除");

    // ---------- 7. 战斗外持久召唤：匹配真实卡 + 落 Token + 关闭魔法清理 ----------
    const summonSpell = spellById.get("e2e-summon");
    if (summonSpell === undefined) { check(false, "找到召唤法术"); return; }
    const summonResult = await castOutsideCombat({
      roomId: room.id, pack: effective.compiled, spell: summonSpell,
      caster: { kind: "CHARACTER", id: player.id }, target: { kind: "CHARACTER", id: player.id }
    });
    const summonCards = await prisma.card.findMany({ where: { roomId: room.id, name: "异次元蹒跚者" } });
    const summonCard = summonCards.find((card) => (card.stats as Record<string, unknown>).summoned === true);
    const summonStats = (summonCard?.stats ?? {}) as Record<string, unknown>;
    const sourceStats = sourceNpc.stats as Record<string, unknown>;
    check(summonResult.ok === true && summonCard !== undefined, "战斗外召唤生成持久 NPC 卡", summonResult.log);
    check(
      summonCard !== undefined && summonStats.maxHp === sourceStats.maxHp,
      "召唤物属性来自房间内真实卡而不是通用兜底",
      { summonMaxHp: summonStats.maxHp, sourceMaxHp: sourceStats.maxHp }
    );
    const summonToken = summonCard === undefined ? null : await prisma.token.findFirst({ where: { roomId: room.id, cardId: summonCard.id } });
    check(summonToken !== null && summonToken.mapId === mapA.id, "召唤物自动落在施法者当前场景", { mapId: summonToken?.mapId, expected: mapA.id });

    const removed = await removeSummonCards(room.id);
    const summonTokenAfter = summonCard === undefined ? null : await prisma.token.findFirst({ where: { roomId: room.id, cardId: summonCard.id } });
    const summonCardAfter = summonCard === undefined ? null : await prisma.card.findUnique({ where: { id: summonCard.id } });
    check(removed >= 1 && summonCardAfter === null && summonTokenAfter === null, "关闭魔法清理召唤卡与地图 Token", { removed });

    // ---------- 7.5 战斗外限时召唤：进入战斗后按轮到期并清理 ----------
    const durationSpell = spellById.get("e2e-summon-duration");
    if (durationSpell === undefined) {
      check(false, "找到限时召唤法术");
      return;
    }
    const durationCast = await castOutsideCombat({
      roomId: room.id, pack: effective.compiled, spell: durationSpell,
      caster: { kind: "CHARACTER", id: player.id }, target: { kind: "CHARACTER", id: player.id }
    });
    const durationCards = await prisma.card.findMany({ where: { roomId: room.id, name: "异次元蹒跚者" } });
    const durationCard = durationCards.find((card) => {
      const stats = card.stats as Record<string, unknown>;
      return stats.summoned === true && stats.summonDurationTicks === 2;
    });
    check(durationCast.ok === true && durationCard !== undefined, "战斗外限时召唤记录持续 2 轮", {
      log: durationCast.log, found: durationCard !== undefined
    });
    if (durationCard === undefined) return;

    const third = await createCombatRecord(room.id, effective, [npcRef(npcThirdFight.id)], [npcRef(durationCard.id)]);
    check(third.ok === true && third.combatId !== undefined, "限时召唤物作为真实 NPC 卡加入战斗", third.error);
    if (third.combatId === undefined) return;
    const rt3 = await loadCombatRuntime(third.combatId);
    if (rt3 === null) {
      check(false, "限时召唤战斗 runtime 可加载");
      return;
    }
    const summonParticipant = rt3.state.participants.find((participant) => participant.id === durationCard.id);
    check(summonParticipant?.summonExpiresAtRound === 3, "进入战斗后剩余持续 2 轮", {
      expiresAt: summonParticipant?.summonExpiresAtRound
    });

    function advanceOneRound(runtime: NonNullable<typeof rt3>): void {
      runtime.state.initiativeOrder = runtime.state.participants.map((participant) => participant.id);
      runtime.state.activeIndex = Math.max(0, runtime.state.initiativeOrder.length - 1);
      runtime.state.phase = "AWAITING_ACTION";
      for (const participant of runtime.state.participants) participant.isReady = false;
      endTurn(runtime.pack, runtime.state);
    }
    advanceOneRound(rt3);
    await saveCombatState(third.combatId, rt3.state);
    const cardAfterOneRound = await prisma.card.findUnique({ where: { id: durationCard.id } });
    check((cardAfterOneRound?.stats as Record<string, unknown> | undefined)?.summonDurationTicks === 1, "走完 1 轮后剩余持续 1 轮并回写卡片", {
      stats: cardAfterOneRound?.stats
    });

    advanceOneRound(rt3);
    check(rt3.state.participants.some((participant) => participant.id === durationCard.id) === false, "持续轮次耗尽后从战斗移除");
    await cleanupDefeatedSummons(rt3);
    const cardAfterExpire = await prisma.card.findUnique({ where: { id: durationCard.id } });
    const tokenAfterExpire = await prisma.token.findFirst({ where: { roomId: room.id, cardId: durationCard.id } });
    check(cardAfterExpire === null && tokenAfterExpire === null, "到期后清理持久召唤卡与地图 Token", {
      card: cardAfterExpire?.id ?? null, token: tokenAfterExpire?.id ?? null
    });

    // ---------- 8. 同房间多场战斗 + 状态重算 ----------
    const second = await createCombatRecord(room.id, effective, [characterRef(playerSecond.id)], [npcRef(npcSecondFight.id)]);
    check(second.ok === true && second.combatId !== undefined, "同一房间可以同时开第二场战斗（不同单位）", second.error);

    const combatOne = await prisma.combat.findUniqueOrThrow({ where: { id: combatId } });
    check(combatOne.sceneId === sceneA.id, "战斗记录了绑定场景", { sceneId: combatOne.sceneId, expected: sceneA.id });

    if (second.combatId !== undefined) {
      const runtimeOne = await loadCombatRuntime(combatId);
      if (runtimeOne !== null) {
        endCombat(runtimeOne.state, "E2E 结束第一场");
        await saveCombatState(combatId, runtimeOne.state);
      }
      const roomAfterFirstEnd = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
      check(roomAfterFirstEnd.status === "COMBAT", "只结束一场时房间仍保持 COMBAT", { status: roomAfterFirstEnd.status });

      const runtimeTwo = await loadCombatRuntime(second.combatId);
      if (runtimeTwo !== null) {
        endCombat(runtimeTwo.state, "E2E 结束第二场");
        await saveCombatState(second.combatId, runtimeTwo.state);
      }
      // 第三场（限时召唤战斗）仍在进行中，此时房间应保持 COMBAT。
      const roomAfterSecondEnd = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
      check(roomAfterSecondEnd.status === "COMBAT", "仍有第三场时房间保持 COMBAT", { status: roomAfterSecondEnd.status });

      if (rt3.state.phase !== "ENDED") endCombat(rt3.state, "E2E 结束第三场");
      // 即使引擎已因召唤物到期自动结束，也要落库一次，否则 DB 里仍是进行中。
      await saveCombatState(third.combatId, rt3.state);
      const roomAfterAllEnd = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
      check(roomAfterAllEnd.status === "PLAYING", "全部战斗结束后房间回到 PLAYING", { status: roomAfterAllEnd.status });
    }

    // ---------- 9. 战斗外禁止伤害法术 ----------
    const damageSpell = spellById.get("e2e-damage");
    if (damageSpell === undefined) { check(false, "找到伤害法术"); return; }
    const damageResult = await castOutsideCombat({
      roomId: room.id, pack: effective.compiled, spell: damageSpell,
      caster: { kind: "CHARACTER", id: player.id }, target: { kind: "CARD", id: npcSameScene.id }
    });
    check(damageResult.ok === false, "战斗外禁止伤害类法术", damageResult.error);
  } finally {
    clearCombatRuntime(combatId ?? "");
    // 清理测试数据（Room 级联删除场景 / 地图 / Token / 卡 / 战斗 / 局）
    await prisma.combatRequest.deleteMany({ where: { roomId: room.id } }).catch(() => undefined);
    await prisma.room.delete({ where: { id: room.id } }).catch((error) => console.log("cleanup room failed", error));
    await prisma.character.delete({ where: { id: player.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }

  console.log("\nE2E REAL RESULT: passed=" + pass + " failed=" + fail);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("E2E REAL CRASHED", error);
  process.exitCode = 1;
}).finally(() => {
  void prisma.$disconnect();
});
