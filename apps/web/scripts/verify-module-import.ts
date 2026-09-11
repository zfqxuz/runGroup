/**
 * 团本导入 E2E：构造带资源的标准 zip，走 /api/modules/import，
 * 验证 Module / ModuleAsset / 资源文件落库。
 */
import { unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { uploadRoot } from "../src/server/assets/storage";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const prisma = new PrismaClient();

interface CallResult {
  readonly status: number;
  readonly text: string;
}

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
  const parts: string[] = [];
  for (const [name, value] of jar) parts.push(name + "=" + value);
  return parts.join("; ");
}

async function call(jar: Map<string, string>, pathName: string, init: RequestInit = {}): Promise<CallResult> {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader(jar);
  if (cookie.length > 0) headers.set("cookie", cookie);
  const response = await fetch(BASE + pathName, { ...init, headers, redirect: "manual" });
  absorbCookies(response, jar);
  return { status: response.status, text: await response.text() };
}

function extractActionFieldAround(html: string, marker: string): string {
  const markerIndex = html.indexOf(marker);
  if (markerIndex <= 0) throw new Error("E2E 断言失败：页面缺少标记 " + marker);
  const formIndex = html.lastIndexOf("<form", markerIndex);
  if (formIndex < 0) throw new Error("E2E 断言失败：未找到标记所在表单");
  const formHtml = html.slice(formIndex, html.indexOf("</form>", markerIndex));
  const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(formHtml);
  const field = match === null ? undefined : match[1];
  if (field === undefined || field.length === 0) throw new Error("E2E 断言失败：表单缺少 server action id");
  return field;
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("E2E 断言失败：" + message);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual === expected) return;
  throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const csrf = await call(jar, "/api/auth/csrf");
  expectEqual(csrf.status, 200, "GET /api/auth/csrf");
  const csrfBody = JSON.parse(csrf.text) as { csrfToken?: string };
  const csrfToken = csrfBody.csrfToken;
  if (csrfToken === undefined || csrfToken.length === 0) throw new Error("E2E 断言失败：csrfToken 缺失");
  const loginResult = await call(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  expectEqual(loginResult.status, 302, "登录回调 HTTP 状态");
  return jar;
}

function buildZip(png: Buffer): Buffer {
  const sections = [
    "元信息","真相与背景","剧情梗概","开场钩子","关键NPC","地点与场景","线索",
    "遭遇与战斗","道具与手书","怪物与神话生物","结局分支","奖励与成长","KP备注","附录"
  ];
  const markdown = [
    "---",
    "spec: touhou-module/v1",
    "id: e2e-module",
    "title: E2E 标准团本",
    "system: COC7",
    "era: MODERN",
    "author: E2E",
    "version: 1.0.0",
    "summary: 用于验证 zip 与资源导入。",
    "---",
    "",
    ...sections.map((title, index) => "## " + title + "\n\n内容 " + String(index + 1) + "\n"),
    "![封面](assets/images/e2e-module/cover.png)",
    ""
  ].join("\n");
  const zip = new AdmZip();
  zip.addFile("e2e-module/module.md", Buffer.from(markdown, "utf8"));
  zip.addFile("e2e-module/assets/images/e2e-module/cover.png", png);
  return zip.toBuffer();
}

async function main(): Promise<void> {
  const username = "e2e_module_" + Date.now().toString(36);
  const password = "e2e_module_pass";
  let roomId: string | null = null;
  let userId: string | null = null;

  try {
    const register = await fetch(BASE + "/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, displayName: username, password })
    });
    expectEqual(register.status, 201, "注册临时用户");
    const registerBody = (await register.json()) as { user?: { id?: string } };
    userId = registerBody.user?.id ?? null;
    if (userId === null) throw new Error("E2E 断言失败：注册响应缺少 user.id");

    const room = await prisma.room.create({
      data: {
        name: "E2E 团本房间",
        system: "COC7",
        ownerId: userId,
        inviteCode: "E2E" + Date.now().toString(36).toUpperCase().slice(0, 8),
        members: { create: { userId, role: "KP" } }
      },
      select: { id: true }
    });
    roomId = room.id;

    const jar = await login(username, password);
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
    }).png().toBuffer();
    const file = new File([Uint8Array.from(buildZip(png))], "e2e-module.zip", { type: "application/zip" });
    const form = new FormData();
    form.set("roomId", room.id);
    form.set("file", file);
    const imported = await call(jar, "/api/modules/import", { method: "POST", body: form });
    ensure(imported.status < 400, "导入请求失败，状态 " + imported.status + " " + imported.text);
    const result = JSON.parse(imported.text) as { ok?: boolean; moduleId?: string };
    ensure(result.ok === true && typeof result.moduleId === "string", "导入结果缺少 moduleId");

    const module = await prisma.module.findUnique({
      where: { id: result.moduleId },
      include: { assets: { include: { asset: true } } }
    });
    if (module === null) throw new Error("E2E 断言失败：Module 未创建");
    expectEqual(module.sourceType, "ZIP", "sourceType");
    expectEqual(module.assets.length, 1, "资源数量");
    const relativePath = module.assets[0]?.relativePath ?? "";
    ensure(relativePath.startsWith("assets/images/e2e-module/"), "资源路径应被规范化：" + relativePath);
    const assetUrl = module.assets[0]?.asset.url ?? "";
    const assetResponse = await fetch(BASE + assetUrl);
    expectEqual(assetResponse.status, 200, "资源 URL 可访问");

    const listPage = await call(jar, "/rooms/" + room.id + "/modules");
    expectEqual(listPage.status, 200, "GET 团本列表页");
    ensure(listPage.text.includes("E2E 标准团本"), "团本列表应显示标题");
    const detailPage = await call(jar, "/rooms/" + room.id + "/modules/" + module.id);
    expectEqual(detailPage.status, 200, "GET 团本详情页");
    ensure(detailPage.text.includes("Markdown 正文"), "详情页应显示编辑器或预览");

    const saveActionField = extractActionFieldAround(detailPage.text, "保存");
    const existingContent = (module.content ?? {}) as { text?: string };
    const saveForm = new FormData();
    saveForm.set(saveActionField, "");
    saveForm.set("roomId", room.id);
    saveForm.set("moduleId", module.id);
    saveForm.set("title", "E2E 标准团本（已编辑）");
    saveForm.set("version", "1.0.1");
    saveForm.set("author", "E2E 作者");
    saveForm.set("synopsis", "编辑后的简介");
    saveForm.set("content", (existingContent.text ?? "") + "\n\n编辑测试");
    const saved = await call(jar, "/rooms/" + room.id + "/modules/" + module.id, {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/rooms/" + room.id + "/modules/" + module.id },
      body: saveForm
    });
    ensure(saved.status < 400, "保存团本失败，状态 " + saved.status);
    const updated = await prisma.module.findUnique({ where: { id: module.id } });
    expectEqual(updated?.title, "E2E 标准团本（已编辑）", "保存后标题");
    expectEqual(updated?.version, "1.0.1", "保存后版本");

    const detailPath = "/rooms/" + room.id + "/modules/" + module.id;
    const detailAfterSave = await call(jar, detailPath);
    const duplicateField = extractActionFieldAround(detailAfterSave.text, "复制团本");
    const duplicateForm = new FormData();
    duplicateForm.set(duplicateField, "");
    duplicateForm.set("roomId", room.id);
    duplicateForm.set("moduleId", module.id);
    const duplicated = await call(jar, detailPath, {
      method: "POST",
      headers: { origin: BASE, referer: BASE + detailPath },
      body: duplicateForm
    });
    ensure(duplicated.status < 400, "复制团本失败，状态 " + duplicated.status);
    const copy = await prisma.module.findFirst({
      where: { roomId: room.id, id: { not: module.id } },
      include: { assets: true },
      orderBy: { id: "desc" }
    });
    ensure(copy !== null, "应创建团本副本");
    ensure(copy?.title.includes("副本") === true, "副本标题应带副本标记");
    expectEqual(copy?.assets.length, 1, "副本应共享资源记录");
    expectEqual(copy?.assets[0]?.assetId, module.assets[0]?.assetId, "副本应指向同一底层资源");

    const oldAssetId = module.assets[0]?.assetId ?? "";
    const replacementPng = await sharp({
      create: { width: 3, height: 3, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } }
    }).png().toBuffer();
    const replaceForm = new FormData();
    replaceForm.set("roomId", room.id);
    replaceForm.set("moduleAssetId", module.assets[0]?.id ?? "");
    replaceForm.set("file", new File([Uint8Array.from(replacementPng)], "cover-replaced.png", { type: "image/png" }));
    const replaced = await call(jar, "/api/modules/" + module.id + "/assets", {
      method: "POST",
      body: replaceForm
    });
    ensure(replaced.status < 400, "替换团本资源失败，状态 " + replaced.status + " " + replaced.text);
    const afterReplace = await prisma.moduleAsset.findUnique({
      where: { id: module.assets[0]?.id ?? "" },
      include: { asset: true }
    });
    ensure(afterReplace !== null && afterReplace.assetId !== oldAssetId, "替换后 ModuleAsset 应指向新资源");
    const newAssetId = afterReplace?.assetId ?? "";
    const newAssetResponse = await fetch(BASE + (afterReplace?.asset.url ?? ""));
    expectEqual(newAssetResponse.status, 200, "替换后资源 URL 可访问");
    const oldAssetStillUsed = await prisma.asset.findUnique({ where: { id: oldAssetId } });
    ensure(oldAssetStillUsed !== null, "副本仍在使用旧资源时不应删除旧资源");

    const activeGame = await prisma.game.create({
      data: {
        roomId: room.id,
        moduleId: module.id,
        status: "PLAYING",
        title: "E2E 团本占用局",
        startedAt: new Date(),
        createdBy: userId
      },
      select: { id: true }
    });
    const blockedDelete = await call(jar, detailPath, {
      method: "POST",
      headers: { origin: BASE, referer: BASE + detailPath },
      body: (() => {
        const form = new FormData();
        form.set(extractActionFieldAround(detailAfterSave.text, "删除团本"), "");
        form.set("roomId", room.id);
        form.set("moduleId", module.id);
        return form;
      })()
    });
    ensure(blockedDelete.status < 400, "有进行中的局时删除请求应被拒绝并重定向");
    const moduleStillThere = await prisma.module.findUnique({ where: { id: module.id } });
    ensure(moduleStillThere !== null, "有进行中的局时不应删除团本");
    await prisma.game.update({ where: { id: activeGame.id }, data: { status: "ENDED", endedAt: new Date() } });

    const copyPath = "/rooms/" + room.id + "/modules/" + (copy?.id ?? "");
    const copyPage = await call(jar, copyPath);
    const copyDeleteField = extractActionFieldAround(copyPage.text, "删除团本");
    const copyDeleteForm = new FormData();
    copyDeleteForm.set(copyDeleteField, "");
    copyDeleteForm.set("roomId", room.id);
    copyDeleteForm.set("moduleId", copy?.id ?? "");
    const copyDeleted = await call(jar, copyPath, {
      method: "POST",
      headers: { origin: BASE, referer: BASE + copyPath },
      body: copyDeleteForm
    });
    ensure(copyDeleted.status < 400, "删除副本失败，状态 " + copyDeleted.status);
    ensure((await prisma.module.findUnique({ where: { id: copy?.id ?? "" } })) === null, "副本应被删除");
    ensure((await prisma.asset.findUnique({ where: { id: oldAssetId } })) === null, "旧资源失去唯一引用后应被清理");

    const deleteDetailPage = await call(jar, detailPath);
    const deleteField = extractActionFieldAround(deleteDetailPage.text, "删除团本");
    const deleteForm = new FormData();
    deleteForm.set(deleteField, "");
    deleteForm.set("roomId", room.id);
    deleteForm.set("moduleId", module.id);
    const deleted = await call(jar, detailPath, {
      method: "POST",
      headers: { origin: BASE, referer: BASE + detailPath },
      body: deleteForm
    });
    ensure(deleted.status < 400, "删除团本失败，状态 " + deleted.status);
    ensure((await prisma.module.findUnique({ where: { id: module.id } })) === null, "团本应被删除");
    ensure((await prisma.asset.findUnique({ where: { id: newAssetId } })) === null, "新资源失去唯一引用后应被清理");

    const blankListPage = await call(jar, "/rooms/" + room.id + "/modules");
    const blankActionField = extractActionFieldAround(blankListPage.text, "新建空白团本");
    const blankForm = new FormData();
    blankForm.set(blankActionField, "");
    blankForm.set("roomId", room.id);
    const blankCreated = await call(jar, "/rooms/" + room.id + "/modules", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/rooms/" + room.id + "/modules" },
      body: blankForm
    });
    ensure(blankCreated.status < 400, "新建空白团本失败，状态 " + blankCreated.status);
    const blank = await prisma.module.findFirst({
      where: { roomId: room.id, sourceType: "NATIVE" },
      orderBy: { id: "desc" }
    });
    ensure(blank !== null, "应创建空白团本");
    expectEqual(blank?.title, "未命名团本", "空白团本标题");
    const blankContent = (blank?.content ?? {}) as { sections?: readonly string[] };
    expectEqual(blankContent.sections?.length, 14, "空白团本应包含标准 14 章节");

    console.log("PASS 团本管理 E2E：zip / 编辑保存 / 复制 / 资源替换 / 占用保护 / 删除清理 / 新建空白团本");
    console.log("  module " + module.id + " asset " + relativePath);
  } finally {
    const assets = userId === null ? [] : await prisma.asset.findMany({ where: { ownerId: userId } });
    for (const asset of assets) {
      await unlink(path.join(uploadRoot(), "modules", asset.filename)).catch(() => undefined);
      const thumb = asset.filename.replace(/[.]png$/, "_thumb.png");
      await unlink(path.join(uploadRoot(), "modules", thumb)).catch(() => undefined);
    }
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    if (userId !== null) {
      await prisma.asset.deleteMany({ where: { ownerId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
