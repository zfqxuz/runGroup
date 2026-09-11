/**
 * 团本预设内容编辑 E2E：
 * 房间团本页 / 准备页 / 跑团页应能编辑 NPC、线索卡、场景入口；
 * KP 可公布线索，并定向分享给指定玩家。
 */
import { prisma } from "../src/server/db/prisma";
import { NpcStatsSchema } from "../src/shared/npc";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

function jarCall(jar: Map<string, string>) {
  return async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", [...jar].map(([k, v]) => k + "=" + v).join("; "));
    const response = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    const headersWithCookies = response.headers as Headers & { getSetCookie?: () => string[] };
    for (const cookie of headersWithCookies.getSetCookie?.() ?? []) {
      const first = cookie.split(";")[0];
      if (first === undefined) continue;
      const equals = first.indexOf("=");
      if (equals > 0) jar.set(first.slice(0, equals), first.slice(equals + 1));
    }
    return { status: response.status, text: await response.text(), location: response.headers.get("location") };
  };
}

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  if (response.status !== 201) throw new Error("注册失败 " + response.status + " " + (await response.text()).slice(0, 200));
  const body = (await response.json()) as { user?: { id?: string } };
  if (body.user?.id === undefined) throw new Error("缺少 user id");
  return body.user.id;
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const call = jarCall(jar);
  const csrf = await call("/api/auth/csrf");
  const csrfToken = (JSON.parse(csrf.text) as { csrfToken?: string }).csrfToken;
  if (csrfToken === undefined) throw new Error("缺少 csrfToken");
  const response = await call("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  if (response.status !== 302) throw new Error("登录失败 " + response.status);
  return jar;
}

function formFieldFor(html: string, markers: readonly string[]): string {
  const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
  for (const form of forms) {
    if (markers.every((marker) => form.includes(marker)) === false) continue;
    const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(form);
    if (match?.[1] !== undefined && match[1].length > 0) return match[1];
  }
  throw new Error("找不到表单：" + markers.join(" / "));
}

async function submitAction(jar: Map<string, string>, path: string, form: FormData): Promise<void> {
  const response = await jarCall(jar)(path, {
    method: "POST",
    headers: { origin: BASE, referer: BASE + path },
    body: form
  });
  if (response.status >= 400) throw new Error("Server Action 失败 " + response.status + "：" + response.text.slice(0, 200));
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_content_kp_" + suffix;
  const plName = "e2e_content_pl_" + suffix;
  const password = "e2e-content-pass-123";
  let roomId: string | null = null;

  try {
    const kpId = await register(kpName, password);
    const plId = await register(plName, password);
    const kpJar = await login(kpName, password);
    const plJar = await login(plName, password);

    const moduleRecord = await prisma.module.findFirst({
      where: { isPublished: true, system: "COC7" },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true }
    });
    if (moduleRecord === null) throw new Error("没有已发布的 COC7 团本");

    const room = await prisma.room.create({
      data: {
        name: "E2E 内容编辑房 " + suffix,
        system: "COC7",
        ownerId: kpId,
        inviteCode: "EC" + suffix.slice(-5).toUpperCase(),
        selectedModuleId: moduleRecord.id,
        status: "LOBBY",
        members: {
          create: [
            { userId: kpId, role: "KP", ready: true },
            { userId: plId, role: "PLAYER", ready: true }
          ]
        }
      }
    });
    roomId = room.id;
    const modulePath = "/rooms/" + room.id + "/modules/" + moduleRecord.id;
    const preparePath = "/rooms/" + room.id + "/prepare";

    const character = await prisma.character.create({
      data: {
        userId: plId, system: "COC7", name: "E2E 内容角色",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 0, maxDp: 0,
        skills: { DODGE: 30 }
      }
    });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });

    const clueA = await prisma.clue.create({
      data: { roomId: room.id, title: "定向线索 A", content: "只发给指定玩家的内容", isPublic: false }
    });
    const clueB = await prisma.clue.create({
      data: { roomId: room.id, title: "公开线索 B", content: "需要 KP 公布的内容", isPublic: false }
    });
    const npcStats = NpcStatsSchema.parse({
      presetId: null, tier: "MINION", rarity: "COMMON", race: null,
      attributes: { str: 40, con: 40, siz: 40, dex: 40, app: 40, int: 40, pow: 40, edu: 40, luck: 40 },
      skills: { FIGHTING_BRAWL: 40 }, maxHp: 10, maxMp: 10, maxSan: 50, maxDp: 0, tags: []
    });
    const npc = await prisma.card.create({
      data: { scope: "ROOM", roomId: room.id, ownerId: kpId, type: "NPC", name: "待编辑 NPC", rarity: "COMMON", system: "COC7", stats: npcStats as never }
    });
    const item = await prisma.card.create({
      data: {
        scope: "ROOM", roomId: room.id, ownerId: kpId, type: "ITEM", name: "待编辑物品", description: "旧描述", rarity: "COMMON", quantity: 1, system: "COC7",
        stats: { damage: "1d4", range: "MELEE" } as never
      }
    });
    const scene = await prisma.scene.create({
      data: { roomId: room.id, name: "待编辑场景", description: "预设场景", map: { create: { name: "默认地图", width: 1600, height: 1000 } } }
    });
    const application = await prisma.roomPresetApplication.create({
      data: { roomId: room.id, moduleId: moduleRecord.id, appliedBy: kpId, status: "ACTIVE" }
    });
    await prisma.roomPresetInstance.createMany({
      data: [
        { applicationId: application.id, templateType: "CARD", templateId: "t-npc", entityId: npc.id },
        { applicationId: application.id, templateType: "CARD", templateId: "t-item", entityId: item.id },
        { applicationId: application.id, templateType: "CLUE", templateId: "t-clue-a", entityId: clueA.id },
        { applicationId: application.id, templateType: "CLUE", templateId: "t-clue-b", entityId: clueB.id },
        { applicationId: application.id, templateType: "SCENE", templateId: "t-scene", entityId: scene.id }
      ]
    });

    // 1. 房间团本页应出现预设内容编辑面板与入口。
    const modulePage = await jarCall(kpJar)(modulePath);
    expectEqual(modulePage.status, 200, "GET 房间团本页");
    for (const marker of ["预设内容编辑（KP）", "保存分享名单", "保存卡片", "编辑场景 / 地图", "定向线索 A", "公开线索 B"]) {
      if (modulePage.text.includes(marker) === false) throw new Error("团本页缺少编辑入口：" + marker);
    }

    // 2. KP 把线索 A 定向发给 PL。
    const shareForm = new FormData();
    shareForm.set(formFieldFor(modulePage.text, ['value="' + clueA.id + '"', "保存分享名单"]), "");
    shareForm.set("roomId", room.id);
    shareForm.set("clueId", clueA.id);
    shareForm.set("targetUserIds", plId);
    shareForm.set("returnTo", modulePath);
    await submitAction(kpJar, modulePath, shareForm);
    const shareCount = await prisma.clueShare.count({ where: { clueId: clueA.id, userId: plId } });
    expectEqual(shareCount, 1, "线索 A 应定向分享给 PL");

    // 3. KP 编辑线索 A。
    const pageAfterShare = await jarCall(kpJar)(modulePath);
    const editClueForm = new FormData();
    editClueForm.set(formFieldFor(pageAfterShare.text, ['value="' + clueA.id + '"', "保存线索"]), "");
    editClueForm.set("roomId", room.id);
    editClueForm.set("clueId", clueA.id);
    editClueForm.set("title", "已被编辑的定向线索 A");
    editClueForm.set("content", "编辑后的定向内容");
    editClueForm.set("isPublic", "0");
    editClueForm.set("returnTo", modulePath);
    await submitAction(kpJar, modulePath, editClueForm);
    const editedClue = await prisma.clue.findUnique({ where: { id: clueA.id }, select: { title: true, content: true } });
    expectEqual(editedClue?.title, "已被编辑的定向线索 A", "线索标题应更新");

    // 4. KP 在准备页编辑 NPC。
    const preparePage = await jarCall(kpJar)(preparePath);
    expectEqual(preparePage.status, 200, "GET 准备页");
    const npcForm = new FormData();
    npcForm.set(formFieldFor(preparePage.text, ['value="' + npc.id + '"', "保存 NPC"]), "");
    npcForm.set("roomId", room.id);
    npcForm.set("cardId", npc.id);
    npcForm.set("returnTo", preparePath);
    npcForm.set("name", "已被编辑的 NPC");
    npcForm.set("subtitle", "");
    npcForm.set("description", "编辑后的 NPC");
    npcForm.set("tier", "STANDARD");
    npcForm.set("rarity", "UNCOMMON");
    npcForm.set("race", "");
    npcForm.set("tags", "E2E");
    for (const key of ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"]) npcForm.set("attr_" + key, "55");
    npcForm.set("maxHp", "22");
    npcForm.set("maxMp", "11");
    npcForm.set("maxSan", "44");
    npcForm.set("maxDp", "5");
    npcForm.set("skills", "FIGHTING_BRAWL:66, DODGE:33");
    await submitAction(kpJar, preparePath, npcForm);
    const editedNpc = await prisma.card.findUnique({ where: { id: npc.id }, select: { name: true, rarity: true, stats: true } });
    expectEqual(editedNpc?.name, "已被编辑的 NPC", "NPC 名称应更新");
    expectEqual(editedNpc?.rarity, "UNCOMMON", "NPC 稀有度应更新");

    // 5. KP 编辑物品卡。
    const pageForItem = await jarCall(kpJar)(modulePath);
    const itemForm = new FormData();
    itemForm.set(formFieldFor(pageForItem.text, ['value="' + item.id + '"', "保存卡片"]), "");
    itemForm.set("cardId", item.id);
    itemForm.set("returnTo", modulePath);
    itemForm.set("name", "已被编辑的物品");
    itemForm.set("subtitle", "");
    itemForm.set("description", "新描述");
    itemForm.set("rarity", "RARE");
    itemForm.set("quantity", "3");
    itemForm.set("stats", JSON.stringify({ damage: "1d8", range: "NEAR" }));
    await submitAction(kpJar, modulePath, itemForm);
    const editedItem = await prisma.card.findUnique({ where: { id: item.id }, select: { name: true, quantity: true, stats: true } });
    expectEqual(editedItem?.name, "已被编辑的物品", "物品名称应更新");
    expectEqual(editedItem?.quantity, 3, "物品数量应更新");

    // 6. KP 公布线索 B。
    const pageForPublish = await jarCall(kpJar)(modulePath);
    const publishForm = new FormData();
    publishForm.set(formFieldFor(pageForPublish.text, ['value="' + clueB.id + '"', "公布给所有人"]), "");
    publishForm.set("roomId", room.id);
    publishForm.set("clueId", clueB.id);
    publishForm.set("isPublic", "1");
    publishForm.set("returnTo", modulePath);
    await submitAction(kpJar, modulePath, publishForm);
    const published = await prisma.clue.findUnique({ where: { id: clueB.id }, select: { isPublic: true } });
    expectEqual(published?.isPublic, true, "线索 B 应已公布");

    // 7. 开局后 PL 应能看到「发给我的」线索 A 与公开线索 B。
    await prisma.room.update({ where: { id: room.id }, data: { status: "PLAYING" } });
    const game = await prisma.game.create({
      data: { roomId: room.id, status: "PLAYING", title: "E2E 内容编辑局", createdBy: kpId, startedAt: new Date() }
    });
    await prisma.gameCharacter.create({
      data: { gameId: game.id, characterId: character.id, userId: plId, currentHp: 10, currentMp: 10, currentSan: 50, currentDp: 0 }
    });
    const plRoomPage = await jarCall(plJar)("/rooms/" + room.id);
    expectEqual(plRoomPage.status, 200, "GET 跑团页");
    if (plRoomPage.text.includes("已被编辑的定向线索 A") === false) throw new Error("PL 跑团页没有看到定向分享的线索 A");
    if (plRoomPage.text.includes("发给我") === false) throw new Error("定向线索没有显示「发给我」标记");
    if (plRoomPage.text.includes("公开线索 B") === false) throw new Error("PL 跑团页没有看到已公布的线索 B");

    // 8. 场景页入口与编辑表单存在。
    const scenesPage = await jarCall(kpJar)("/rooms/" + room.id + "/scenes");
    expectEqual(scenesPage.status, 200, "GET 场景页");
    if (scenesPage.text.includes("保存场景 / 地图") === false) throw new Error("场景页缺少编辑表单");

    console.log("PASS 线索 / NPC / 场景编辑 E2E：公布、定向分享、编辑与可见性");
    console.log("  room=" + room.id + " module=" + moduleRecord.title + " npc=" + npc.id);
  } finally {
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, plName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
