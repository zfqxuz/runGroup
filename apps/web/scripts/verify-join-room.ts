/**
 * 加入房间 E2E：注册临时用户，登录后在首页通过邀请码加入 DEMO01。
 * 前置：docker compose up -d db；npm run db:seed；npm run dev。
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
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

async function call(jar: Map<string, string>, path: string, init: RequestInit = {}): Promise<CallResult> {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader(jar);
  if (cookie.length > 0) headers.set("cookie", cookie);
  const response = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
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
  const session = await call(jar, "/api/auth/session");
  ensure(session.text.includes(username), "session 应包含登录用户名");
  return jar;
}

function extractActionField(html: string, marker: string): string {
  const markerIndex = html.indexOf(marker);
  if (markerIndex <= 0) throw new Error("E2E 断言失败：页面缺少标记 " + marker);
  const formStart = html.lastIndexOf("<form", markerIndex);
  if (formStart < 0) throw new Error("E2E 断言失败：未找到标记所在表单");
  const formEnd = html.indexOf("</form>", markerIndex);
  if (formEnd < 0) throw new Error("E2E 断言失败：表单未闭合");
  const formHtml = html.slice(formStart, formEnd);
  const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(formHtml);
  const field = match === null ? undefined : match[1];
  if (field === undefined || field.length === 0) throw new Error("E2E 断言失败：表单缺少 server action id");
  return field;
}

async function main(): Promise<void> {
  const username = "e2e_join_" + Date.now();
  const password = "e2e_join_pass";
  const room = await prisma.room.findUnique({ where: { inviteCode: "DEMO01" } });
  if (room === null) throw new Error("E2E 前置失败：请先运行 npm run db:seed");

  try {
    const register = await fetch(BASE + "/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, displayName: username, password })
    });
    expectEqual(register.status, 201, "注册临时用户");

    const jar = await login(username, password);
    const home = await call(jar, "/");
    expectEqual(home.status, 200, "GET 首页");
    ensure(home.text.includes("加入房间"), "首页应有加入房间表单");
    const actionField = extractActionField(home.text, "邀请码");
    const form = new FormData();
    form.set(actionField, "");
    form.set("inviteCode", "DEMO01");
    const joined = await call(jar, "/", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/" },
      body: form
    });
    ensure(joined.status < 400, "加入房间请求失败，状态 " + joined.status);

    const user = await prisma.user.findUnique({ where: { username } });
    if (user === null) throw new Error("E2E 断言失败：临时用户未创建");
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: user.id } }
    });
    ensure(membership !== null, "加入后应存在 RoomMember");
    console.log("PASS 加入房间 E2E：邀请码加入成功");
    console.log("  用户 " + username + "，房间 " + room.name);
  } finally {
    const user = await prisma.user.findUnique({ where: { username } });
    if (user !== null) {
      await prisma.roomMember.deleteMany({ where: { userId: user.id } });
      await prisma.character.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
