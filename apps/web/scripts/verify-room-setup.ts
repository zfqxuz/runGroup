/**
 * 开房配置页端到端验证。
 * 前置：docker compose up -d db；npm run dev。
 * 运行：npm run verify:room-setup --workspace @touhou/web
 */
import { PrismaClient } from "@prisma/client";
import { loadEffectivePack } from "../src/server/rules/loader";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();
const jar = new Map<string, string>();

interface CallResult {
  readonly status: number;
  readonly text: string;
  readonly headers: Headers;
}

function absorbCookies(response: Response): void {
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

function cookieHeader(): string {
  const parts: string[] = [];
  for (const [name, value] of jar) parts.push(name + "=" + value);
  return parts.join("; ");
}

async function call(path: string, init: RequestInit = {}): Promise<CallResult> {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader();
  if (cookie.length > 0) headers.set("cookie", cookie);
  const response = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
  absorbCookies(response);
  return { status: response.status, text: await response.text(), headers: response.headers };
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("E2E 断言失败：" + message);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual === expected) return;
  throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new Error("E2E 断言失败：期望对象，实际 " + JSON.stringify(value));
  }
  if (Array.isArray(value)) {
    throw new Error("E2E 断言失败：期望普通对象，实际是数组");
  }
  return value as Record<string, unknown>;
}

function extractActionField(html: string): string {
  const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(html);
  const field = match === null ? undefined : match[1];
  if (field === undefined || field.length === 0) {
    throw new Error("E2E 断言失败：未能从 /rooms/new 提取 server action id");
  }
  return field;
}

async function main(): Promise<void> {
const username = "e2e_room_" + Date.now().toString(36);
const password = "test-password-123";
const roomName = "E2E东方ATB房" + Date.now().toString(36);
let roomId: string | null = null;

try {
  const register = await call("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: "开房验证", password })
  });
  expectEqual(register.status, 201, "注册 HTTP 状态");
  const registerBody = JSON.parse(register.text) as { user?: { id?: string } };
  const rawUserId = registerBody.user?.id;
  if (rawUserId === undefined || rawUserId.length === 0) {
    throw new Error("E2E 断言失败：注册响应缺少 user.id");
  }
  const userId = rawUserId;

  const csrf = await call("/api/auth/csrf");
  expectEqual(csrf.status, 200, "GET /api/auth/csrf");
  const csrfBody = JSON.parse(csrf.text) as { csrfToken?: string };
  const csrfToken = csrfBody.csrfToken;
  if (csrfToken === undefined || csrfToken.length === 0) {
    throw new Error("E2E 断言失败：csrfToken 缺失");
  }
  const login = await call("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken,
      username,
      password,
      callbackUrl: BASE + "/",
      json: "true"
    }).toString()
  });
  expectEqual(login.status, 302, "登录回调 HTTP 状态");
  const session = await call("/api/auth/session");
  ensure(session.text.includes(userId), "登录后 session 未返回 userId");

  const setupPage = await call("/rooms/new");
  expectEqual(setupPage.status, 200, "GET /rooms/new");
  ensure(setupPage.text.includes("创建房间"), "开房配置页缺少标题");
  const actionField = extractActionField(setupPage.text);

  const form = new FormData();
  form.set(actionField, "");
  form.set("name", roomName);
  form.set("system", "TOUHOU");
  form.set("chargenMethod", "destiny5");
  form.set("combatMode", "ATB");
  form.append("disabledEvents", "GRAZE");
  const created = await call("/rooms/new", {
    method: "POST",
    headers: { origin: BASE, referer: BASE + "/rooms/new" },
    body: form
  });
  ensure(created.status === 303 || created.status === 302, "提交 server action 期望重定向，实际 " + created.status + "：" + created.text.slice(0, 200));
  const location = created.headers.get("location");
  if (location === null) throw new Error("E2E 断言失败：重定向响应缺少 location");
  const roomUrl = new URL(location, BASE);
  const segments = roomUrl.pathname.split("/");
  const last = segments[segments.length - 1];
  if (last === undefined || last.length === 0) {
    throw new Error("E2E 断言失败：无法从 location 解析 roomId：" + location);
  }
  const createdRoomId = last;
  roomId = createdRoomId;

  const room = await prisma.room.findUnique({ where: { id: createdRoomId } });
  if (room === null) throw new Error("E2E 断言失败：数据库中找不到新建房间");
  expectEqual(room.name, roomName, "房间名");
  expectEqual(room.system, "TOUHOU", "房间 system");
  expectEqual(room.chargenMethod, "destiny5", "房间 chargenMethod");
  const override = asRecord(room.ruleOverride);
  const attributeOverride = asRecord(override.attributes);
  const methods = attributeOverride.methods;
  if (Array.isArray(methods) === false) throw new Error("E2E 断言失败：规则覆盖缺少 attributes.methods 数组");
  const method = asRecord(methods[0]);
  expectEqual(method.id, "destiny5", "规则覆盖中的车卡方式 id");
  const combatOverride = asRecord(override.combat);
  expectEqual(combatOverride.mode, "ATB", "规则覆盖 combat.mode");
  const eventsOverride = asRecord(combatOverride.events);
  const grazeOverride = asRecord(eventsOverride.GRAZE);
  expectEqual(grazeOverride.defaultEnabled, false, "规则覆盖 GRAZE.defaultEnabled");

  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  expectEqual(effective.hasRoomOverride, true, "房间覆盖标记");
  expectEqual(effective.compiled.combat.mode, "ATB", "编译后 combat.mode");
  const graze = effective.compiled.combat.events.GRAZE;
  if (graze === undefined) throw new Error("E2E 断言失败：编译后缺少 GRAZE 事件");
  expectEqual(graze.defaultEnabled, false, "编译后 GRAZE 开关");
  expectEqual(graze.label, "擦弹", "编译后 GRAZE label 应保留");
  const grazeRaw = effective.compiled.pack.combat.events.GRAZE;
  if (grazeRaw === undefined) throw new Error("E2E 断言失败：合并后 pack 缺少 GRAZE 原始配置");
  expectEqual(grazeRaw.params.gainRatio, "0.5", "编译后 GRAZE params 应保留");
  ensure(Object.keys(effective.compiled.combat.events).length > 1, "其他战斗事件应被保留");

  const roomPage = await call("/rooms/" + createdRoomId + "/prepare");
  expectEqual(roomPage.status, 200, "GET 新房间页");
  ensure(roomPage.text.includes(roomName), "房间页应显示房间名");

  const lobbyPage = await call("/rooms/" + createdRoomId);
  expectEqual(lobbyPage.status, 307, "准备阶段访问房间页应跳转到准备页");


  const startLabelIndex = roomPage.text.indexOf("开始跑团");
  ensure(startLabelIndex > 0, "准备页缺少开始跑团按钮");
  const startFormIndex = roomPage.text.lastIndexOf("<form", startLabelIndex);
  const startFormHtml = roomPage.text.slice(startFormIndex, startLabelIndex);
  const startActionMatch = /name="([^"]*ACTION_ID[^"]*)"/.exec(startFormHtml);
  const startActionField = startActionMatch === null ? undefined : startActionMatch[1];
  if (startActionField === undefined) throw new Error("E2E 断言失败：未找到开始跑团 server action");
  const startForm = new FormData();
  startForm.set(startActionField, "");
  startForm.set("roomId", createdRoomId);
  const started = await call("/rooms/" + createdRoomId + "/prepare", {
    method: "POST",
    headers: { origin: BASE, referer: BASE + "/rooms/" + createdRoomId + "/prepare" },
    body: startForm
  });
  expectEqual(started.status, 303, "提交开始跑团后的状态");
  const playPage = await call("/rooms/" + createdRoomId);
  expectEqual(playPage.status, 200, "开始跑团后房间页");
  ensure(playPage.text.includes("跑团日志"), "房间页应显示跑团日志");
  console.log("PASS 开房配置页 E2E：东方房 + ATB + 禁用 GRAZE");
  console.log("  房间 " + createdRoomId + " system=" + room.system + " overrideMode=" + String(combatOverride.mode));
  console.log("  回读 loadEffectivePack：mode=" + effective.compiled.combat.mode + " GRAZE.defaultEnabled=" + String(graze.defaultEnabled) + " label=" + graze.label);
} finally {
  if (roomId === null) {
    await prisma.user.deleteMany({ where: { username } });
  } else {
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username } });
  }
  await prisma.$disconnect();
}

}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
