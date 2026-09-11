/**
 * 团本广场 E2E：发布 / 公开预览 / 非作者不可编辑 / 用广场团本直接建房 / 先建房再选团本。
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

async function call(jar: Map<string, string>, pathName: string, init: RequestInit = {}): Promise<{ status: number; text: string }> {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader(jar);
  if (cookie.length > 0) headers.set("cookie", cookie);
  const response = await fetch(BASE + pathName, { ...init, headers, redirect: "manual" });
  absorbCookies(response, jar);
  return { status: response.status, text: await response.text() };
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
      const formHtml = html.slice(formIndex, formEnd);
      const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(formHtml);
      const field = match === null ? undefined : match[1];
      if (field !== undefined && field.length > 0) return field;
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
  ensure(result.status < 400, "Server Action 请求失败：" + result.status);
}

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  expectEqual(response.status, 201, "注册 " + username);
  const body = (await response.json()) as { user?: { id?: string } };
  const id = body.user?.id;
  if (id === undefined) throw new Error("E2E 断言失败：注册缺少 user.id");
  return id;
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const csrf = await call(jar, "/api/auth/csrf");
  expectEqual(csrf.status, 200, "GET /api/auth/csrf");
  const csrfBody = JSON.parse(csrf.text) as { csrfToken?: string };
  const csrfToken = csrfBody.csrfToken;
  if (csrfToken === undefined) throw new Error("E2E 断言失败：csrfToken 缺失");
  const result = await call(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  expectEqual(result.status, 302, "登录 " + username);
  return jar;
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const ownerName = "e2e_gallery_owner_" + suffix;
  const viewerName = "e2e_gallery_viewer_" + suffix;
  const password = "e2e_gallery_pass";
  let ownerId: string | null = null;
  let viewerId: string | null = null;
  let moduleId: string | null = null;
  const roomIds: string[] = [];

  try {
    ownerId = await register(ownerName, password);
    viewerId = await register(viewerName, password);
    const ownerJar = await login(ownerName, password);
    const viewerJar = await login(viewerName, password);

    const minePage = await call(ownerJar, "/modules/mine");
    expectEqual(minePage.status, 200, "GET 我的团本");
    const createField = extractActionFieldAround(minePage.text, "新建空白团本");
    const createForm = new FormData();
    createForm.set(createField, "");
    createForm.set("system", "COC7");
    createForm.set("era", "MODERN");
    await submitAction(ownerJar, "/modules/mine", createForm);

    const module = await prisma.module.findFirst({
      where: { ownerId, sourceType: "NATIVE" },
      orderBy: { id: "desc" }
    });
    ensure(module !== null, "应创建空白团本");
    moduleId = module?.id ?? "";

    const detailPath = "/modules/" + moduleId;
    const detailPage = await call(ownerJar, detailPath);
    expectEqual(detailPage.status, 200, "GET 作者团本详情");
    const saveField = extractActionFieldAround(detailPage.text, "保存");
    const saveForm = new FormData();
    saveForm.set(saveField, "");
    saveForm.set("moduleId", moduleId);
    saveForm.set("title", "E2E 广场团本");
    saveForm.set("version", "1.2.0");
    saveForm.set("author", "E2E 作者");
    saveForm.set("system", "COC7");
    saveForm.set("era", "CLASSIC");
    saveForm.set("synopsis", "这是广场公开简介。");
    saveForm.set("background", "这是广场公开背景。");
    saveForm.set("occupationRecommendation", "推荐侦探 / 记者。");
    saveForm.set("content", "PRIVATE_BODY_MARKER 仅 KP 可见的真相。");
    await submitAction(ownerJar, detailPath, saveForm);

    const pageAfterSave = await call(ownerJar, detailPath);
    const publishField = extractActionFieldAround(pageAfterSave.text, "发布到广场");
    const publishForm = new FormData();
    publishForm.set(publishField, "");
    publishForm.set("moduleId", moduleId);
    publishForm.set("published", "1");
    await submitAction(ownerJar, detailPath, publishForm);

    const published = await prisma.module.findUnique({ where: { id: moduleId } });
    expectEqual(published?.isPublished, true, "团本应发布");
    expectEqual(published?.background, "这是广场公开背景。", "背景应保存");
    expectEqual(published?.occupationRecommendation, "推荐侦探 / 记者。", "职业推荐应保存");

    const square = await call(viewerJar, "/modules");
    expectEqual(square.status, 200, "GET 团本广场");
    ensure(square.text.includes("E2E 广场团本"), "广场应显示已发布团本");
    ensure(square.text.includes("这是广场公开背景。"), "广场应显示背景");
    ensure(square.text.includes("这是广场公开简介。"), "广场应显示简介");
    ensure(square.text.includes("推荐侦探 / 记者。"), "广场应显示职业推荐");
    ensure(square.text.includes("PRIVATE_BODY_MARKER") === false, "广场不应泄露非公开正文");

    const viewerMine = await call(viewerJar, "/modules/mine");
    ensure(viewerMine.text.includes("E2E 广场团本") === false, "非作者不应在我的团本看到他人团本");

    const viewerDetail = await call(viewerJar, detailPath);
    expectEqual(viewerDetail.status, 200, "公开团本应可预览");
    ensure(viewerDetail.text.includes("编辑团本") === false, "非作者不应看到编辑表单");
    ensure(viewerDetail.text.includes("PRIVATE_BODY_MARKER") === false, "公开预览不应泄露正文");

    const newRoomPage = await call(viewerJar, "/rooms/new?moduleId=" + moduleId);
    expectEqual(newRoomPage.status, 200, "GET 带团本的建房页");
    ensure(newRoomPage.text.includes("E2E 广场团本"), "建房页应显示预选团本");
    const roomCreateField = extractActionFieldAround(newRoomPage.text, "创建房间");
    const roomCreateForm = new FormData();
    roomCreateForm.set(roomCreateField, "");
    roomCreateForm.set("name", "E2E 广场直接建房");
    roomCreateForm.set("system", "COC7");
    roomCreateForm.set("era", "MODERN");
    roomCreateForm.set("chargenMethod", "destiny5");
    roomCreateForm.set("combatMode", "ATB");
    roomCreateForm.set("allowPlayerCombatRequest", "1");
    roomCreateForm.set("moduleId", moduleId);
    await submitAction(viewerJar, "/rooms/new", roomCreateForm);

    const directRoom = await prisma.room.findFirst({
      where: { ownerId: viewerId, name: "E2E 广场直接建房" },
      orderBy: { id: "desc" }
    });
    ensure(directRoom !== null, "应创建房间");
    roomIds.push(directRoom?.id ?? "");
    expectEqual(directRoom?.selectedModuleId, moduleId, "建房时应保存所选团本");

    const preparePage = await call(viewerJar, "/rooms/" + (directRoom?.id ?? "") + "/prepare");
    expectEqual(preparePage.status, 200, "GET 准备页");
    ensure(preparePage.text.includes("这是广场公开背景。"), "准备页应显示公开背景");
    ensure(preparePage.text.includes("PRIVATE_BODY_MARKER") === false, "准备页不应泄露非公开正文");

    const secondRoom = await prisma.room.create({
      data: {
        name: "E2E 先建房再选团本",
        system: "COC7",
        ownerId: viewerId,
        inviteCode: "GAL" + suffix.toUpperCase().slice(0, 6),
        members: { create: { userId: viewerId, role: "KP" } }
      },
      select: { id: true }
    });
    roomIds.push(secondRoom.id);
    const secondPrepare = await call(viewerJar, "/rooms/" + secondRoom.id + "/prepare");
    const selectField = extractActionFieldAround(secondPrepare.text, "保存团本选择");
    const selectForm = new FormData();
    selectForm.set(selectField, "");
    selectForm.set("roomId", secondRoom.id);
    selectForm.set("moduleId", moduleId);
    await submitAction(viewerJar, "/rooms/" + secondRoom.id + "/prepare", selectForm);
    const selectedRoom = await prisma.room.findUnique({ where: { id: secondRoom.id }, select: { selectedModuleId: true } });
    expectEqual(selectedRoom?.selectedModuleId, moduleId, "先建房后应能选择团本");

    console.log("PASS 团本广场 E2E：发布 / 公开预览 / 作者编辑 / 直接建房 / 先建房再选团本");
    console.log("  module " + moduleId + " rooms " + roomIds.join(","));
  } finally {
    if (roomIds.length > 0) {
      await prisma.room.deleteMany({ where: { id: { in: roomIds } } });
    }
    if (moduleId !== null && moduleId.length > 0) {
      await prisma.module.deleteMany({ where: { id: moduleId } });
    }
    await prisma.user.deleteMany({ where: { username: { in: [ownerName, viewerName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
