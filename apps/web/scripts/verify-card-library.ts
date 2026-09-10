/**
 * 卡牌库 E2E：批量审核 / 稀有度边框 / 共享模板复制。
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

interface CleanupState {
  roomId: string | null;
  playerId: string | null;
  entryIds: string[];
}

async function cleanup(state: CleanupState): Promise<void> {
  if (state.roomId === null || state.playerId === null) return;
  if (state.entryIds.length > 0) {
    await prisma.roomCardEntry.updateMany({
      where: { id: { in: state.entryIds }, roomId: state.roomId },
      data: { status: "PENDING_REVIEW", comment: null, reviewedAt: null }
    });
  }
  await prisma.card.deleteMany({ where: { ownerId: state.playerId, templateId: "seed-card-kp-template" } });
}

async function main(): Promise<void> {
  const state: CleanupState = { roomId: null, playerId: null, entryIds: [] };
  try {
    const kp = await prisma.user.findUnique({ where: { username: "demo_kp" } });
    const player = await prisma.user.findUnique({ where: { username: "demo_player" } });
    if (kp === null || player === null) throw new Error("E2E 前置失败：请先运行 npm run db:seed");
    const room = await prisma.room.findUnique({ where: { inviteCode: "DEMO01" } });
    if (room === null) throw new Error("E2E 前置失败：seed 房间 DEMO01 不存在");
    state.roomId = room.id;
    state.playerId = player.id;

    const pendingEntries = await prisma.roomCardEntry.findMany({
      where: { roomId: room.id, status: "PENDING_REVIEW" },
      orderBy: { submittedAt: "asc" },
      take: 2
    });
    if (pendingEntries.length < 2) throw new Error("E2E 前置失败：seed 至少需要 2 条待审卡牌");
    state.entryIds = pendingEntries.map((entry) => entry.id);

    const kpJar = await login("demo_kp", "demo1234");
    const prepare = await call(kpJar, "/rooms/" + room.id + "/prepare");
    expectEqual(prepare.status, 200, "GET 准备页");
    ensure(prepare.text.includes("批量通过"), "准备页应有批量通过按钮");
    ensure(prepare.text.includes("border-amber-400/80") || prepare.text.includes("border-sky-400/60"), "准备页卡牌应显示稀有度边框");
    const reviewField = extractActionField(prepare.text, "批量通过");
    const reviewForm = new FormData();
    reviewForm.set(reviewField, "");
    for (const entryId of state.entryIds) reviewForm.append("entryIds", entryId);
    reviewForm.set("decision", "APPROVE");
    reviewForm.set("comment", "E2E 批量审核");
    const reviewResponse = await call(kpJar, "/rooms/" + room.id + "/prepare", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/rooms/" + room.id + "/prepare" },
      body: reviewForm
    });
    ensure(reviewResponse.status < 400, "批量审核请求失败");
    const reviewed = await prisma.roomCardEntry.findMany({ where: { id: { in: state.entryIds } } });
    ensure(reviewed.every((entry) => entry.status === "APPROVED"), "批量审核后状态应为 APPROVED");

    const playerJar = await login("demo_player", "demo1234");
    const library = await call(playerJar, "/cards");
    expectEqual(library.status, 200, "GET 卡牌库");
    ensure(library.text.includes("共享模板库"), "卡牌库应有共享模板库");
    ensure(library.text.includes("border-amber-400/80") || library.text.includes("border-sky-400/60") || library.text.includes("border-violet-400/70"), "卡牌库应显示稀有度边框");
    const copyField = extractActionField(library.text, "seed-card-kp-template");
    const copyForm = new FormData();
    copyForm.set(copyField, "");
    copyForm.set("templateId", "seed-card-kp-template");
    const copyResponse = await call(playerJar, "/cards", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/cards" },
      body: copyForm
    });
    ensure(copyResponse.status < 400, "复制模板请求失败");
    const copy = await prisma.card.findFirst({ where: { ownerId: player.id, templateId: "seed-card-kp-template" } });
    if (copy === null) throw new Error("E2E 断言失败：模板复制后未创建卡牌副本");
    const afterCopy = await call(playerJar, "/cards");
    ensure(afterCopy.text.includes("已复制到我的卡库"), "复制后页面应显示已复制状态");
    console.log("PASS 卡牌 E2E：批量审核 / 稀有度边框 / 共享模板复制");
    console.log("  批量审核 " + state.entryIds.length + " 张，模板副本 " + copy.id);
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
