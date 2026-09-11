/**
 * 团本结构化编辑 E2E：
 * - 我的团本页直接新增 / 编辑线索、物品、场景、NPC
 * - 上传新素材并绑定到实体
 * - 结构化数据 content 不再只读标题，正文正确同步到 ClueTemplate
 * - Token 图自动取来源卡；无图时返回默认占位状态
 */
import { prisma } from "../src/server/db/prisma";
import { structuredOfContent } from "../src/server/modules/structure";
import { tokenInclude, tokenView } from "../src/server/scene/view";

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

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const username = "e2e_entity_" + suffix;
  const password = "e2e-entity-pass-123";
  let moduleId: string | null = null;
  let userId: string | null = null;

  try {
    userId = await register(username, password);
    const jar = await login(username, password);

    const moduleRecord = await prisma.module.create({
      data: {
        ownerId: userId, title: "E2E 结构化团本", version: "1.0.0", system: "COC7", era: "MODERN",
        content: { text: "## 元信息\n\n结构化编辑测试。\n", sections: ["元信息"], structured: null } as never
      },
      select: { id: true }
    });
    moduleId = moduleRecord.id;
    const modulePath = "/modules/" + moduleRecord.id;

    // 1. 打开我的团本详情页，确认结构化编辑器存在。
    const page = await jarCall(jar)(modulePath);
    expectEqual(page.status, 200, "GET 团本详情");
    for (const marker of ["结构化内容编辑", "新增 NPC / 角色", "新增物品 / 证物", "新增线索", "新增场景"]) {
      if (page.text.includes(marker) === false) throw new Error("团本页缺少结构化编辑入口：" + marker);
    }

    // 2. 新增线索（含正文）。
    const createClueForm = new FormData();
    createClueForm.set(formFieldFor(page.text, ['name="kind" value="clue"', 'name="entityId" value=""']), "");
    createClueForm.set("moduleId", moduleRecord.id);
    createClueForm.set("kind", "clue");
    createClueForm.set("entityId", "");
    createClueForm.set("returnTo", modulePath);
    createClueForm.set("title", "E2E 线索");
    createClueForm.set("content", "这条线索必须有完整正文，而不是只有标题。");
    createClueForm.set("isPublic", "1");
    createClueForm.set("linkedItemId", "");
    await submitAction(jar, modulePath, createClueForm);

    const moduleAfterClue = await prisma.module.findUnique({ where: { id: moduleRecord.id }, select: { content: true } });
    const structured = structuredOfContent(moduleAfterClue?.content);
    const clueEntry = structured.clues.find((entry) => entry.data.content === "这条线索必须有完整正文，而不是只有标题。");
    if (clueEntry === undefined) throw new Error("结构化数据里没有写入线索正文");
    const clueTemplate = await prisma.clueTemplate.findFirst({ where: { moduleId: moduleRecord.id, title: "E2E 线索" } });
    expectEqual(clueTemplate?.content, "这条线索必须有完整正文，而不是只有标题。", "ClueTemplate 应同步线索正文");

    // 3. 编辑已有线索并上传图片素材。
    const uploadForm = new FormData();
    uploadForm.set("kind", "IMAGE");
    uploadForm.set("file", new File([Buffer.from(PNG_BASE64, "base64")], "e2e-clue.png", { type: "image/png" }));
    const uploadResponse = await jarCall(jar)("/api/modules/" + moduleRecord.id + "/assets", { method: "POST", body: uploadForm });
    const uploadPayload = JSON.parse(uploadResponse.text) as { ok: boolean; relativePath?: string; error?: string };
    if (uploadPayload.ok === false || uploadPayload.relativePath === undefined) {
      throw new Error("上传素材失败：" + (uploadPayload.error ?? uploadResponse.status));
    }
    if (uploadPayload.relativePath.startsWith("assets/images/") === false) {
      throw new Error("上传素材相对路径不正确：" + uploadPayload.relativePath);
    }
    const moduleAsset = await prisma.moduleAsset.findFirst({ where: { moduleId: moduleRecord.id, relativePath: uploadPayload.relativePath } });
    if (moduleAsset === null) throw new Error("ModuleAsset 没有落库");

    const pageForEdit = await jarCall(jar)(modulePath);
    const editClueForm = new FormData();
    editClueForm.set(formFieldFor(pageForEdit.text, ['name="kind" value="clue"', 'name="entityId" value="' + clueEntry.id + '"', 'name="content"']), "");
    editClueForm.set("moduleId", moduleRecord.id);
    editClueForm.set("kind", "clue");
    editClueForm.set("entityId", clueEntry.id);
    editClueForm.set("returnTo", modulePath);
    editClueForm.set("title", "E2E 线索（已编辑）");
    editClueForm.set("content", "编辑后的线索正文。");
    editClueForm.set("image", uploadPayload.relativePath);
    editClueForm.set("isPublic", "0");
    editClueForm.set("linkedItemId", "");
    await submitAction(jar, modulePath, editClueForm);
    const editedTemplate = await prisma.clueTemplate.findFirst({ where: { moduleId: moduleRecord.id, title: "E2E 线索（已编辑）" } });
    if (editedTemplate === null) throw new Error("线索编辑后没有找到同步模板，sourceKey=" + clueEntry.id);
    expectEqual(editedTemplate?.content, "编辑后的线索正文。", "线索正文应更新");
    expectEqual(editedTemplate?.imagePath, uploadPayload.relativePath, "线索图片应绑定");

    // 4. 新增物品与场景，确认模板同步。
    const pageForItem = await jarCall(jar)(modulePath);
    const itemForm = new FormData();
    itemForm.set(formFieldFor(pageForItem.text, ['name="kind" value="item"', 'name="entityId" value=""']), "");
    itemForm.set("moduleId", moduleRecord.id);
    itemForm.set("kind", "item");
    itemForm.set("entityId", "");
    itemForm.set("returnTo", modulePath);
    itemForm.set("name", "E2E 武器");
    itemForm.set("itemType", "WEAPON");
    itemForm.set("description", "测试武器");
    itemForm.set("rarity", "RARE");
    itemForm.set("quantity", "1");
    itemForm.set("damage", "1d6");
    itemForm.set("range", "MELEE");
    itemForm.set("skillId", "FIGHTING_BRAWL");
    itemForm.set("accuracyMod", "0");
    await submitAction(jar, modulePath, itemForm);
    const itemTemplate = await prisma.itemTemplate.findFirst({ where: { moduleId: moduleRecord.id, name: "E2E 武器" } });
    const itemStats = (itemTemplate?.stats ?? {}) as Record<string, unknown>;
    expectEqual(itemStats.damage, "1d6", "物品伤害应同步");

    const pageForScene = await jarCall(jar)(modulePath);
    const sceneForm = new FormData();
    sceneForm.set(formFieldFor(pageForScene.text, ['name="kind" value="scene"', 'name="entityId" value=""']), "");
    sceneForm.set("moduleId", moduleRecord.id);
    sceneForm.set("kind", "scene");
    sceneForm.set("entityId", "");
    sceneForm.set("returnTo", modulePath);
    sceneForm.set("name", "E2E 场景");
    sceneForm.set("description", "测试场景");
    sceneForm.set("width", "1600");
    sceneForm.set("height", "1000");
    sceneForm.set("gridSize", "70");
    sceneForm.set("gridType", "SQUARE");
    sceneForm.set("bgColor", "#1a1a2e");
    sceneForm.set("showGrid", "1");
    await submitAction(jar, modulePath, sceneForm);
    const sceneTemplate = await prisma.sceneTemplate.findFirst({ where: { moduleId: moduleRecord.id, name: "E2E 场景" } });
    if (sceneTemplate === null) throw new Error("场景模板没有同步");

    // 5. NPC 新增并确认属性同步。
    const pageForNpc = await jarCall(jar)(modulePath);
    const npcForm = new FormData();
    npcForm.set(formFieldFor(pageForNpc.text, ['name="kind" value="npc"', 'name="entityId" value=""']), "");
    npcForm.set("moduleId", moduleRecord.id);
    npcForm.set("kind", "npc");
    npcForm.set("entityId", "");
    npcForm.set("returnTo", modulePath);
    npcForm.set("name", "E2E NPC");
    npcForm.set("tier", "ELITE");
    npcForm.set("rarity", "UNCOMMON");
    npcForm.set("description", "测试 NPC");
    for (const key of ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"]) npcForm.set("attr_" + key, "66");
    npcForm.set("maxHp", "33");
    npcForm.set("maxMp", "22");
    npcForm.set("maxSan", "55");
    npcForm.set("maxDp", "0");
    npcForm.set("skills", "FIGHTING_BRAWL:70, DODGE:50");
    await submitAction(jar, modulePath, npcForm);
    const npcTemplate = await prisma.npcTemplate.findFirst({ where: { moduleId: moduleRecord.id, name: "E2E NPC" } });
    if (npcTemplate === null) throw new Error("NPC 模板没有同步");
    expectEqual((npcTemplate.attributes as Record<string, number>).str, 66, "NPC 力量应同步");
    expectEqual((npcTemplate.skills as Record<string, number>).DODGE, 50, "NPC 技能应同步");

    // 6. Token 图片自动取来源卡；没有图片时返回 null（前端显示默认占位）。
    const room = await prisma.room.create({ data: { name: "E2E Token 房", system: "COC7", ownerId: userId, inviteCode: "ET" + suffix.slice(-5).toUpperCase(), members: { create: { userId, role: "KP" } } } });
    const scene = await prisma.scene.create({ data: { roomId: room.id, name: "Token 场景", map: { create: { name: "地图", width: 800, height: 600 } } }, include: { map: true } });
    const card = await prisma.card.create({ data: { scope: "ROOM", roomId: room.id, ownerId: userId, type: "NPC", name: "有图 NPC", rarity: "COMMON", system: "COC7", imageUrl: "/uploads/e2e-token.png", stats: {} as never } });
    if (scene.map === null) throw new Error("场景缺少地图");
    const mapId = scene.map.id;
    const tokenWithCard = await prisma.token.create({ data: { mapId, cardId: card.id, name: "有图 NPC", x: 100, y: 100 } });
    const loadedWithCard = await prisma.token.findUnique({ where: { id: tokenWithCard.id }, include: tokenInclude });
    if (loadedWithCard === null) throw new Error("Token 查询失败");
    const viewWithCard = tokenView(loadedWithCard, new Map());
    expectEqual(viewWithCard.imageUrl, "/uploads/e2e-token.png", "Token 应自动取来源卡图片");

    const tokenWithoutImage = await prisma.token.create({ data: { mapId, name: "无图 NPC", x: 200, y: 200 } });
    const loadedWithout = await prisma.token.findUnique({ where: { id: tokenWithoutImage.id }, include: tokenInclude });
    if (loadedWithout === null) throw new Error("Token 查询失败");
    const viewWithout = tokenView(loadedWithout, new Map());
    expectEqual(viewWithout.imageUrl, null, "无图 Token 应返回 null 交给前端默认占位");

    // 7. 场景页不应再出现 Token 上传入口。
    const scenesPage = await jarCall(jar)("/rooms/" + room.id + "/scenes");
    expectEqual(scenesPage.status, 200, "GET 场景页");
    if (scenesPage.text.includes("上传 Token 图")) throw new Error("场景页仍存在 Token 上传入口");

    console.log("PASS 团本结构化编辑 E2E：线索正文 / 上传 / 物品 / 场景 / NPC / Token 自动取图");
    console.log("  module=" + moduleRecord.id + " clueTemplate=" + clueTemplate?.id);
  } finally {
    if (moduleId !== null) await prisma.module.deleteMany({ where: { id: moduleId } });
    if (userId !== null) {
      await prisma.room.deleteMany({ where: { ownerId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
