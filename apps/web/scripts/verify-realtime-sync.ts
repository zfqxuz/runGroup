/**
 * KP ↔ PL 实时同步回归 E2E：
 * 用真实的建房 / 带入审核 / 准备 / 应用预设 / 开局 / 发起战斗流程，
 * 验证每个服务端动作都会向房间频道广播，另一侧无需手动刷新即可收到。
 */
import { io, type Socket } from "socket.io-client";
import { prisma } from "../src/server/db/prisma";
import { listSelectableUnits } from "../src/server/combat/setup";
import type { CombatLifecycle, JoinAck, RoomRefresh, RoomUpdate } from "../src/shared/socket";

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

function formFieldOf(html: string, markers: readonly string[]): string {
  const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
  for (const form of forms) {
    if (markers.every((marker) => form.includes(marker)) === false) continue;
    const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(form);
    if (match?.[1] !== undefined && match[1].length > 0) return match[1];
  }
  throw new Error("找不到包含标记的 server action 表单：" + markers.join(" / "));
}

async function submitAction(jar: Map<string, string>, path: string, form: FormData): Promise<void> {
  const call = jarCall(jar);
  const response = await call(path, {
    method: "POST",
    headers: { origin: BASE, referer: BASE + path },
    body: form
  });
  if (response.status >= 400) throw new Error("Server Action 失败 " + response.status + "：" + response.text.slice(0, 200));
}

async function connectRoomSocket(jar: Map<string, string>, roomId: string): Promise<Socket> {
  const call = jarCall(jar);
  const ticketResponse = await call("/api/socket-ticket", { method: "POST" });
  const ticket = (JSON.parse(ticketResponse.text) as { ticket?: string }).ticket;
  if (ticket === undefined) throw new Error("缺少 socket ticket");
  const socket = await new Promise<Socket>((resolve, reject) => {
    const client = io(BASE, { path: "/api/socket", autoConnect: false, transports: ["websocket"] });
    client.auth = { ticket };
    const timer = setTimeout(() => reject(new Error("socket 连接超时")), 8000);
    client.once("connect", () => { clearTimeout(timer); resolve(client); });
    client.once("connect_error", (error: Error) => { clearTimeout(timer); reject(error); });
    client.connect();
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("room:join ack 超时")), 8000);
    socket.emit("room:join", roomId, (result: JoinAck) => {
      clearTimeout(timer);
      if (result.ok === false) reject(new Error(result.error ?? "room:join 失败"));
      else resolve();
    });
  });
  return socket;
}

function waitEvent<T>(socket: Socket, event: string, predicate: (payload: T) => boolean, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error("等待事件超时：" + event));
    }, timeoutMs);
    function handler(payload: T): void {
      if (predicate(payload) === false) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

async function ensureUser(username: string, password: string): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (existing !== null) return existing.id;
  return register(username, password);
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const externalAccounts = process.env.FLOW_KP_USERNAME !== undefined;
  const kpName = process.env.FLOW_KP_USERNAME ?? "e2e_sync_kp_" + suffix;
  const plName = process.env.FLOW_PL_USERNAME ?? "e2e_sync_pl_" + suffix;
  const kpPassword = process.env.FLOW_KP_PASSWORD ?? "e2e-sync-pass-123";
  const plPassword = process.env.FLOW_PL_PASSWORD ?? "e2e-sync-pass-123";
  let roomId: string | null = null;
  let characterId: string | null = null;
  let kpSocket: Socket | null = null;
  let plSocket: Socket | null = null;

  try {
    const kpId = await ensureUser(kpName, kpPassword);
    const plId = await ensureUser(plName, plPassword);
    const kpJar = await login(kpName, kpPassword);
    const plJar = await login(plName, plPassword);

    const moduleRecord = await prisma.module.findFirst({
      where: { isPublished: true, system: "COC7" },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true }
    });
    if (moduleRecord === null) throw new Error("没有已发布的 COC7 团本可用于测试");

    // 1. KP 通过开房页创建 COC7 房间，并预选现有团本。
    const setup = await jarCall(kpJar)("/rooms/new");
    expectEqual(setup.status, 200, "GET /rooms/new");
    const createForm = new FormData();
    createForm.set(formFieldOf(setup.text, ["创建房间"]), "");
    createForm.set("name", "E2E 同步房 " + suffix.slice(-4));
    createForm.set("system", "COC7");
    createForm.set("chargenMethod", "manual");
    createForm.set("era", "MODERN");
    createForm.set("combatMode", "ATB");
    createForm.set("allowPlayerCombatRequest", "1");
    createForm.set("characterVisibility", "PUBLIC");
    createForm.set("moduleId", moduleRecord.id);
    const created = await jarCall(kpJar)("/rooms/new", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/rooms/new" },
      body: createForm
    });
    if (created.location === null) throw new Error("建房没有返回 redirect location");
    const roomPath = new URL(created.location, BASE).pathname;
    roomId = roomPath.split("/").filter((part) => part.length > 0)[1] ?? null;
    if (roomId === null) throw new Error("无法从 location 解析 roomId：" + created.location);
    const preparePath = "/rooms/" + roomId + "/prepare";

    // PL 加入房间（等价于邀请码入房结果），并准备一张待审角色卡。
    await prisma.roomMember.upsert({
      where: { roomId_userId: { roomId, userId: plId } },
      update: {},
      create: { roomId, userId: plId, role: "PLAYER" }
    });
    const character = await prisma.character.create({
      data: {
        userId: plId, system: "COC7", name: "E2E 同步角色",
        str: 50, con: 50, siz: 50, dex: 60, app: 50, int: 60, pow: 50, edu: 60, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 0, maxDp: 0,
        skills: { FIGHTING_BRAWL: 60, DODGE: 40 }
      }
    });
    characterId = character.id;
    const entry = await prisma.roomCharacterEntry.create({
      data: { roomId, characterId: character.id, status: "PENDING_REVIEW" }
    });

    kpSocket = await connectRoomSocket(kpJar, roomId);
    plSocket = await connectRoomSocket(plJar, roomId);

    // 2. KP 审核带入：PL 应立即收到 room:refresh。
    const kpPrepare = await jarCall(kpJar)(preparePath);
    const reviewForm = new FormData();
    reviewForm.set(formFieldOf(kpPrepare.text, ['name="kind" value="CHARACTER"', 'name="approve" value="1"']), "");
    reviewForm.set("kind", "CHARACTER");
    reviewForm.set("entryId", entry.id);
    reviewForm.set("approve", "1");
    const plReviewRefresh = waitEvent<RoomRefresh>(plSocket, "room:refresh", (payload) => payload.roomId === roomId && payload.reason === "entry-reviewed");
    await submitAction(kpJar, preparePath, reviewForm);
    await plReviewRefresh;
    const reviewed = await prisma.roomCharacterEntry.findUnique({ where: { id: entry.id }, select: { status: true } });
    expectEqual(reviewed?.status, "APPROVED", "KP 审核后角色应通过");

    // 3. PL 准备：KP 应立即收到 room:refresh。
    const plPrepare = await jarCall(plJar)(preparePath);
    const readyForm = new FormData();
    readyForm.set(formFieldOf(plPrepare.text, ["我准备好了"]), "");
    readyForm.set("roomId", roomId);
    const kpReadyRefresh = waitEvent<RoomRefresh>(kpSocket, "room:refresh", (payload) => payload.roomId === roomId && payload.reason === "ready");
    await submitAction(plJar, preparePath, readyForm);
    await kpReadyRefresh;

    // 4. KP 应用团本预设：PL 应立即收到 room:refresh。
    const kpPrepare2 = await jarCall(kpJar)(preparePath);
    const presetForm = new FormData();
    presetForm.set(formFieldOf(kpPrepare2.text, ["应用团本预设"]), "");
    presetForm.set("roomId", roomId);
    presetForm.set("moduleId", moduleRecord.id);
    presetForm.set("force", "0");
    const plPresetRefresh = waitEvent<RoomRefresh>(plSocket, "room:refresh", (payload) => payload.roomId === roomId && payload.reason === "preset-applied");
    await submitAction(kpJar, preparePath, presetForm);
    await plPresetRefresh;
    const activePreset = await prisma.roomPresetApplication.findFirst({
      where: { roomId, moduleId: moduleRecord.id, status: "ACTIVE" },
      select: { id: true }
    });
    if (activePreset === null) throw new Error("应用预设后没有 ACTIVE RoomPresetApplication");

    // 5. KP 准备：PL 立即收到 room:refresh；随后 KP 开局，PL 收到 room:update PLAYING。
    const kpPrepare3 = await jarCall(kpJar)(preparePath);
    const kpReadyForm = new FormData();
    kpReadyForm.set(formFieldOf(kpPrepare3.text, ["我准备好了"]), "");
    kpReadyForm.set("roomId", roomId);
    const plKpReadyRefresh = waitEvent<RoomRefresh>(plSocket, "room:refresh", (payload) => payload.roomId === roomId && payload.reason === "ready");
    await submitAction(kpJar, preparePath, kpReadyForm);
    await plKpReadyRefresh;

    const kpPrepare4 = await jarCall(kpJar)(preparePath);
    const startForm = new FormData();
    startForm.set(formFieldOf(kpPrepare4.text, ["开始跑团"]), "");
    startForm.set("roomId", roomId);
    startForm.set("moduleId", moduleRecord.id);
    const plRoomUpdate = waitEvent<RoomUpdate>(plSocket, "room:update", (payload) => payload.roomId === roomId && payload.status === "PLAYING");
    await submitAction(kpJar, preparePath, startForm);
    await plRoomUpdate;
    const roomAfterStart = await prisma.room.findUnique({ where: { id: roomId }, select: { status: true } });
    expectEqual(roomAfterStart?.status, "PLAYING", "开局后房间应 PLAYING");
    const game = await prisma.game.findFirst({ where: { roomId, status: "PLAYING" }, orderBy: { createdAt: "desc" } });
    if (game === null) throw new Error("开局后没有 Game");

    // 6. KP 发起战斗：PL 立即收到 combat:started。
    const combatNew = await jarCall(kpJar)("/rooms/" + roomId + "/combat/new");
    expectEqual(combatNew.status, 200, "GET 发起战斗页");
    const units = await listSelectableUnits(roomId, kpId, "KP");
    const ally = units.find((unit) => unit.kind === "CHARACTER" && unit.ownerId === plId);
    const enemy = units.find((unit) => unit.kind === "NPC");
    if (ally === undefined || enemy === undefined) throw new Error("发起战斗页面缺少可控 PC / NPC");
    const combatForm = new FormData();
    combatForm.set(formFieldOf(combatNew.text, ["直接开战"]), "");
    combatForm.set("roomId", roomId);
    combatForm.append("allies", ally.ref);
    combatForm.append("enemies", enemy.ref);
    const plCombatStarted = waitEvent<CombatLifecycle>(plSocket, "combat:started", (payload) => payload.roomId === roomId);
    await submitAction(kpJar, "/rooms/" + roomId + "/combat/new", combatForm);
    const combatStarted = await plCombatStarted;
    const activeCombat = await prisma.combat.findFirst({ where: { id: combatStarted.combatId }, select: { id: true, endedAt: true } });
    if (activeCombat === null) throw new Error("战斗创建后数据库没有记录");

    console.log("PASS 实时同步 E2E：审核 / 准备 / 预设 / 开局 / 战斗发起 均实时广播");
    console.log("  room=" + roomId + " module=" + moduleRecord.title + " combat=" + combatStarted.combatId);
  } finally {
    if (kpSocket !== null) kpSocket.close();
    if (plSocket !== null) plSocket.close();
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    if (characterId !== null) await prisma.character.deleteMany({ where: { id: characterId } });
    if (externalAccounts === false) {
      await prisma.user.deleteMany({ where: { username: { in: [kpName, plName] } } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
