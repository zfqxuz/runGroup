/**
 * 团本预设物化 E2E：
 * 应用团本预设 → 生成 RoomChapter / Scene+Map / NPC卡 / 武器物品证物卡 / 线索 / 遭遇 / 魔法规则；
 * 换预设 → 上一批整批替换。
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const prisma = new PrismaClient();

function absorbCookies(response: Response, jar: Map<string, string>): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const listed = headers.getSetCookie?.() ?? [];
  const fallback = response.headers.get("set-cookie");
  const cookies = listed.length > 0 ? listed : fallback === null ? [] : [fallback];
  for (const cookie of cookies) {
    const first = cookie.split(";")[0];
    if (first === undefined) continue;
    const equals = first.indexOf("=");
    if (equals <= 0) continue;
    jar.set(first.slice(0, equals), first.slice(equals + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => name + "=" + value).join("; ");
}

async function call(jar: Map<string, string>, pathName: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader(jar);
  if (cookie.length > 0) headers.set("cookie", cookie);
  const response = await fetch(BASE + pathName, { ...init, headers, redirect: "manual" });
  absorbCookies(response, jar);
  return { status: response.status, text: await response.text(), headers: response.headers };
}

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  if (response.status !== 201) throw new Error("注册失败：" + username + " " + String(response.status));
  const body = (await response.json()) as { user?: { id?: string } };
  if (body.user?.id === undefined) throw new Error("注册响应缺少 user.id");
  return body.user.id;
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const csrf = await call(jar, "/api/auth/csrf");
  const csrfBody = JSON.parse(csrf.text) as { csrfToken?: string };
  if (csrfBody.csrfToken === undefined) throw new Error("csrfToken 缺失");
  const loginResult = await call(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrfBody.csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  if (loginResult.status !== 302) throw new Error("登录失败：" + username + " " + String(loginResult.status));
  return jar;
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("E2E 断言失败：" + message);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual === expected) return;
  throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

function extractActionFieldAround(html: string, marker: string): string {
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const markerIndex = html.indexOf(marker, searchFrom);
    if (markerIndex < 0) break;
    const formIndex = html.lastIndexOf("<form", markerIndex);
    const formEnd = html.indexOf("</form>", markerIndex);
    if (formIndex >= 0 && formEnd > markerIndex) {
      const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(html.slice(formIndex, formEnd));
      if (match?.[1] !== undefined && match[1].length > 0) return match[1];
    }
    searchFrom = markerIndex + 1;
  }
  throw new Error("E2E 断言失败：未找到包含 server action 的标记表单：" + marker);
}

async function submitAction(jar: Map<string, string>, pathName: string, form: FormData): Promise<void> {
  const result = await call(jar, pathName, {
    method: "POST",
    headers: { origin: BASE, referer: BASE + pathName },
    body: form
  });
  ensure(result.status < 400, "Server Action 请求失败：" + result.status + " " + result.text.slice(0, 200));
}

function moduleContent(structure: Record<string, unknown>): never {
  return {
    format: "markdown",
    text: "## 地点与场景\n预设测试",
    structured: structure
  } as never;
}

async function applyPreset(jar: Map<string, string>, roomId: string, moduleId: string): Promise<void> {
  await prisma.room.update({ where: { id: roomId }, data: { selectedModuleId: moduleId } });
  const page = await call(jar, "/rooms/" + roomId + "/prepare");
  expectEqual(page.status, 200, "GET 准备页");
  const form = new FormData();
  form.set(extractActionFieldAround(page.text, "应用团本预设到房间"), "");
  form.set("roomId", roomId);
  form.set("moduleId", moduleId);
  await submitAction(jar, "/rooms/" + roomId + "/prepare", form);
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_preset_kp_" + suffix;
  const password = "e2e_preset_pass";
  let roomId: string | null = null;
  let moduleAId: string | null = null;
  let moduleBId: string | null = null;

  try {
    const kpId = await register(kpName, password);
    const room = await prisma.room.create({
      data: {
        name: "E2E 预设房",
        system: "COC7",
        ownerId: kpId,
        inviteCode: "PRE" + suffix.toUpperCase().slice(0, 6),
        status: "LOBBY",
        members: { create: { userId: kpId, role: "KP" } }
      },
      select: { id: true }
    });
    roomId = room.id;

    moduleAId = (await prisma.module.create({
      data: {
        ownerId: kpId,
        roomId: room.id,
        title: "E2E 预设团本 A",
        system: "COC7",
        era: "MODERN",
        version: "1.0.0",
        content: moduleContent({
          chapters: [{ id: "ch1", name: "第一章", summary: "开始" }],
          scenes: [
            {
              id: "scene-a",
              name: "审判庭",
              description: "石质大厅",
              width: 1600,
              height: 1000,
              gridType: "SQUARE",
              bgColor: "#111827",
              layers: [{ name: "地板", type: "TILE", imagePath: null }]
            }
          ],
          npcs: [
            {
              id: "npc-a",
              name: "深潜者",
              tier: "BOSS",
              rarity: "EPIC",
              description: "来自海底的怪物",
              attributes: { str: 80, con: 70, siz: 70, dex: 50, app: 20, int: 40, pow: 60, edu: 20, luck: 30 },
              skills: { DODGE: 40, FIGHTING_BRAWL: 60 },
              maxHp: 40,
              maxMp: 10,
              maxSan: 0,
              maxDp: 0
            }
          ],
          items: [
            {
              id: "item-key",
              name: "青铜钥匙",
              itemType: "EVIDENCE",
              description: "关键证物",
              rarity: "RARE",
              stats: { effect: "打开地下室" }
            },
            {
              id: "item-gun",
              name: ".38 左轮",
              itemType: "WEAPON",
              rarity: "UNCOMMON",
              stats: { damage: "1d10", range: "NEAR", skillId: "FIREARMS_HANDGUN", accuracyMod: 0 }
            }
          ],
          clues: [
            {
              id: "clue-a",
              title: "湿漉漉的脚印",
              content: "从海边一直延伸到旅店",
              isPublic: false,
              linkedItemId: "item-key"
            }
          ],
          encounters: [
            {
              id: "enc-a",
              name: "地下室遭遇",
              chapterId: "ch1",
              sceneId: "scene-a",
              trigger: "打开暗门后",
              npcs: ["npc-a"],
              items: ["item-gun"]
            }
          ],
          magic: [
            {
              id: "spell-a",
              name: "驱逐深潜者",
              skill: "OCCULT",
              mpCost: "3",
              sanCost: "1d3",
              damage: "1d6",
              target: "ONE",
              description: "古老咒语"
            }
          ]
        })
      },
      select: { id: true }
    })).id;

    await applyPreset(await login(kpName, password), room.id, moduleAId);

    const firstCounts = {
      chapters: await prisma.roomChapter.count({ where: { roomId: room.id } }),
      scenes: await prisma.scene.count({ where: { roomId: room.id } }),
      maps: await prisma.map.count({ where: { scene: { roomId: room.id } } }),
      npcs: await prisma.card.count({ where: { roomId: room.id, type: "NPC" } }),
      weapons: await prisma.card.count({ where: { roomId: room.id, type: "WEAPON" } }),
      cluesCards: await prisma.card.count({ where: { roomId: room.id, type: "CLUE" } }),
      clues: await prisma.clue.count({ where: { roomId: room.id } }),
      encounters: await prisma.encounter.count({ where: { roomId: room.id } }),
      layers: await prisma.mapLayer.count({ where: { map: { scene: { roomId: room.id } } } })
    };
    expectEqual(firstCounts.chapters, 1, "应创建 1 个 RoomChapter");
    expectEqual(firstCounts.scenes, 1, "应创建 1 个 Scene");
    expectEqual(firstCounts.maps, 1, "应创建 1 个 Map");
    expectEqual(firstCounts.npcs, 1, "应创建 1 张 NPC 卡");
    expectEqual(firstCounts.weapons, 1, "应创建 1 张武器卡");
    expectEqual(firstCounts.cluesCards, 1, "应创建 1 张证物卡");
    expectEqual(firstCounts.clues, 1, "应创建 1 条线索");
    expectEqual(firstCounts.encounters, 1, "应创建 1 个遭遇");
    expectEqual(firstCounts.layers, 1, "应创建 1 个地图图层");

    const hiddenNpc = await prisma.card.findFirst({ where: { roomId: room.id, type: "NPC" } });
    expectEqual(hiddenNpc?.isPublic, false, "NPC 默认隐藏");
    const evidence = await prisma.card.findFirst({ where: { roomId: room.id, type: "CLUE" } });
    const linkedClue = await prisma.clue.findFirst({ where: { roomId: room.id } });
    const evidenceStats = (evidence?.stats ?? {}) as { linkedClueId?: string };
    expectEqual(evidenceStats.linkedClueId, linkedClue?.id ?? "", "证物卡应关联线索");
    const encounter = await prisma.encounter.findFirst({ where: { roomId: room.id } });
    ensure(encounter?.roomChapterId !== null, "遭遇应绑定 RoomChapter");
    const roomAfterA = await prisma.room.findUnique({ where: { id: room.id }, select: { magicEnabled: true, ruleOverride: true } });
    expectEqual(roomAfterA?.magicEnabled, true, "应用带魔法的预设后应自动启用魔法");
    const magic = (roomAfterA?.ruleOverride as { magic?: { spells?: unknown[] } } | null)?.magic;
    expectEqual(magic?.spells?.length, 1, "房间规则应包含 1 条法术");

    moduleBId = (await prisma.module.create({
      data: {
        ownerId: kpId,
        roomId: room.id,
        title: "E2E 预设团本 B",
        system: "COC7",
        era: "MODERN",
        version: "1.0.0",
        content: moduleContent({
          chapters: [{ id: "ch-b", name: "另一章", summary: "" }],
          scenes: [{ id: "scene-b", name: "另一场景", width: 800, height: 600, gridType: "HEX" }],
          npcs: [{ id: "npc-b", name: "新 Boss", tier: "BOSS" }],
          items: [],
          clues: [],
          encounters: [],
          magic: []
        })
      },
      select: { id: true }
    })).id;

    await applyPreset(await login(kpName, password), room.id, moduleBId);

    const afterSwitch = {
      oldScene: await prisma.scene.count({ where: { roomId: room.id, name: "审判庭" } }),
      newScene: await prisma.scene.count({ where: { roomId: room.id, name: "另一场景" } }),
      oldNpc: await prisma.card.count({ where: { roomId: room.id, name: "深潜者" } }),
      newNpc: await prisma.card.count({ where: { roomId: room.id, name: "新 Boss" } }),
      oldClue: await prisma.clue.count({ where: { roomId: room.id, title: "湿漉漉的脚印" } }),
      magicEnabled: (await prisma.room.findUnique({ where: { id: room.id }, select: { magicEnabled: true } }))?.magicEnabled
    };
    expectEqual(afterSwitch.oldScene, 0, "换预设后旧场景应被替换");
    expectEqual(afterSwitch.newScene, 1, "换预设后应创建新场景");
    expectEqual(afterSwitch.oldNpc, 0, "换预设后旧 NPC 卡应被替换");
    expectEqual(afterSwitch.newNpc, 1, "换预设后应创建新 NPC 卡");
    expectEqual(afterSwitch.oldClue, 0, "换预设后旧线索应被替换");
    expectEqual(afterSwitch.magicEnabled, false, "新预设没有魔法时应关闭魔法");

    console.log("PASS 团本预设物化 E2E：NPC / 武器 / 证物 / 场景地图 / 线索 / 遭遇 / 魔法；换预设整批替换");
    console.log("  A: chapters=" + String(firstCounts.chapters) + " scenes=" + String(firstCounts.scenes) + " npcs=" + String(firstCounts.npcs) + " items=2 clues=1 encounters=1");
    console.log("  B: 旧场景/旧NPC/旧线索已替换，新预设无魔法已关闭");
  } finally {
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    if (moduleAId !== null) await prisma.module.deleteMany({ where: { id: moduleAId } });
    if (moduleBId !== null) await prisma.module.deleteMany({ where: { id: moduleBId } });
    await prisma.user.deleteMany({ where: { username: kpName } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
