/**
 * P2-1 增量 E2E：
 * 六边形网格几何 / 墙体 / 灯光 / 战争迷雾 Socket 编辑 / 地图图层 / 团本结构化场景自动绑定。
 * 运行：E2E_BASE_URL=http://localhost:3101 npx tsx --env-file=.env scripts/verify-scene-increments.ts
 */
import { PrismaClient } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import type { Ack } from "../src/shared/socket";
import type { SceneMapUpdated } from "../src/shared/scene";
import {
  computeVisibilityPolygon,
  hexCellKey,
  pointInPolygon,
  snapPointToGrid,
  type GeometrySegment
} from "../src/shared/scene-geometry";

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

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  expectEqual(response.status, 201, "注册 " + username);
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
    body: new URLSearchParams({
      csrfToken: csrfBody.csrfToken,
      username,
      password,
      callbackUrl: BASE + "/",
      json: "true"
    }).toString()
  });
  expectEqual(loginResult.status, 302, "登录 " + username);
  return jar;
}

async function connectSocket(jar: Map<string, string>): Promise<Socket> {
  const ticketResponse = await call(jar, "/api/socket-ticket", { method: "POST" });
  const ticket = (JSON.parse(ticketResponse.text) as { ticket?: string }).ticket;
  if (ticket === undefined) throw new Error("socket ticket 缺失");
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { path: "/api/socket", autoConnect: false, transports: ["websocket"], reconnection: false, rejectUnauthorized: false });
    socket.auth = { ticket };
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("socket connect timeout"));
    }, 8000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.connect();
  });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket ack timeout: " + event)), 8000);
    socket.emit(event, payload, (result: T) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function waitEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket event timeout: " + event)), 8000);
    socket.once(event, (value: T) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function verifyGeometry(): void {
  const hexMap = { width: 1400, height: 900, gridSize: 70, gridType: "HEX" };
  const snapped = snapPointToGrid(hexMap, 123, 456);
  const key = hexCellKey({ q: Math.round((Math.sqrt(3) / 3 * snapped.x - snapped.y / 3) / 35), r: Math.round((2 / 3 * snapped.y) / 35) });
  ensure(key.startsWith("hex:"), "六边形网格键应为 hex 前缀");
  ensure(snapped.x >= 0 && snapped.x <= 1400 && snapped.y >= 0 && snapped.y <= 900, "六边形吸附坐标应在边界内");

  const segment: GeometrySegment = { a: { x: 500, y: 0 }, b: { x: 500, y: 900 } };
  const polygon = computeVisibilityPolygon({ x: 100, y: 450 }, [segment], 1400, 900);
  ensure(polygon.length >= 3, "可见性多边形应至少有 3 个点");
  ensure(pointInPolygon({ x: 300, y: 450 }, polygon), "墙前的点应在视线内");
  ensure(pointInPolygon({ x: 900, y: 450 }, polygon) === false, "墙后的点不应在视线内");
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_sceneplus_" + suffix;
  const password = "e2e_sceneplus_pass";
  let roomId: string | null = null;
  let moduleId: string | null = null;
  let socket: Socket | null = null;

  try {
    const kpId = await register(kpName, password);
    const room = await prisma.room.create({
      data: {
        name: "E2E 场景增量房",
        system: "COC7",
        ownerId: kpId,
        inviteCode: "SCP" + suffix.toUpperCase().slice(0, 6),
        status: "PLAYING",
        members: { create: { userId: kpId, role: "KP" } }
      },
      select: { id: true }
    });
    roomId = room.id;

    const scene = await prisma.scene.create({
      data: {
        roomId: room.id,
        name: "E2E 增量大厅",
        isActive: true,
        map: {
          create: {
            name: "E2E 增量地图",
            width: 1400,
            height: 900,
            gridSize: 70,
            gridType: "SQUARE",
            bgColor: "#111827",
            showGrid: true,
            showFog: true
          }
        }
      },
      include: { map: true }
    });
    const mapId = scene.map?.id;
    if (mapId === undefined) throw new Error("地图创建失败");

    const jar = await login(kpName, password);
    socket = await connectSocket(jar);
    const joinAck = await emitAck<Ack>(socket, "room:join", room.id);
    ensure(joinAck.ok, "KP Socket 加入房间失败");

    const wallEvent = waitEvent<SceneMapUpdated>(socket, "scene:map:updated");
    const wallAck = await emitAck<Ack>(socket, "scene:wall:create", {
      roomId: room.id,
      sceneId: scene.id,
      points: [100, 100, 400, 100],
      type: "WALL"
    });
    ensure(wallAck.ok, wallAck.error ?? "创建墙体失败");
    const wallUpdate = await wallEvent;
    expectEqual(wallUpdate.map.walls.length, 1, "广播地图应包含 1 面墙");
    expectEqual(await prisma.wall.count({ where: { mapId } }), 1, "数据库墙体数量");

    const lightEvent = waitEvent<SceneMapUpdated>(socket, "scene:map:updated");
    const lightAck = await emitAck<Ack>(socket, "scene:light:create", {
      roomId: room.id,
      sceneId: scene.id,
      x: 700,
      y: 450,
      radius: 260,
      color: "#ffaa00",
      intensity: 1
    });
    ensure(lightAck.ok, lightAck.error ?? "创建灯光失败");
    const lightUpdate = await lightEvent;
    expectEqual(lightUpdate.map.lights.length, 1, "广播地图应包含 1 盏灯");
    expectEqual(await prisma.light.count({ where: { mapId } }), 1, "数据库灯光数量");

    const fogEvent = waitEvent<{ readonly fogRevealed: readonly string[] }>(socket, "scene:fog:updated");
    const fogAck = await emitAck<Ack>(socket, "scene:fog:paint", {
      roomId: room.id,
      sceneId: scene.id,
      cells: ["0,0", "1,0"],
      mode: "REVEAL"
    });
    ensure(fogAck.ok, fogAck.error ?? "迷雾揭示失败");
    const fogUpdate = await fogEvent;
    ensure(fogUpdate.fogRevealed.includes("0,0") && fogUpdate.fogRevealed.includes("1,0"), "迷雾广播应包含揭示格子");
    const mapAfterFog = await prisma.map.findUnique({ where: { id: mapId } });
    ensure(Array.isArray(mapAfterFog?.fogRevealed) && (mapAfterFog?.fogRevealed as readonly string[]).length === 2, "数据库迷雾格子数量");

    const resetEvent = waitEvent<{ readonly fogRevealed: readonly string[] }>(socket, "scene:fog:updated");
    const resetAck = await emitAck<Ack>(socket, "scene:fog:reset", { roomId: room.id, sceneId: scene.id });
    ensure(resetAck.ok, resetAck.error ?? "迷雾重置失败");
    const resetUpdate = await resetEvent;
    expectEqual(resetUpdate.fogRevealed.length, 0, "重置后迷雾应为空");

    const scenesPath = "/rooms/" + room.id + "/scenes";
    const scenesPage = await call(jar, scenesPath);
    expectEqual(scenesPage.status, 200, "GET 场景管理页");
    const layerForm = new FormData();
    layerForm.set(extractActionFieldAround(scenesPage.text, "新增图层"), "");
    layerForm.set("roomId", room.id);
    layerForm.set("sceneId", scene.id);
    layerForm.set("name", "E2E 图层");
    layerForm.set("layerType", "TILE");
    layerForm.set("zIndex", "3");
    layerForm.set("visible", "1");
    await submitAction(jar, scenesPath, layerForm);
    const layer = await prisma.mapLayer.findFirst({ where: { mapId, name: "E2E 图层" } });
    ensure(layer !== null, "地图图层应创建成功");
    expectEqual(layer?.zIndex, 3, "图层 zIndex");

    moduleId = (await prisma.module.create({
      data: {
        ownerId: kpId,
        title: "E2E 结构化团本",
        system: "COC7",
        era: "MODERN",
        version: "1.0.0",
        content: {
          format: "markdown",
          text: "## 地点与场景\n测试",
          structured: {
            chapters: [{ id: "chapter-a", name: "第一章", summary: "E2E" }],
            scenes: [
              { id: "scene-a", name: "E2E 团本场景 A", description: "A", width: 1600, height: 1000, gridType: "HEX", bgColor: "#0f172a", showFog: true },
              { id: "scene-b", name: "E2E 团本场景 B", description: "B", width: 1200, height: 800, gridType: "SQUARE" }
            ],
            encounters: [
              { id: "enc-a", name: "E2E 团本遭遇", sceneId: "scene-a", chapterId: "chapter-a", trigger: "进入场景 A" }
            ]
          }
        } as never
      },
      select: { id: true }
    })).id;
    const game = await prisma.game.create({
      data: {
        roomId: room.id,
        moduleId,
        status: "PLAYING",
        title: "E2E 场景增量局",
        startedAt: new Date(),
        createdBy: kpId
      },
      select: { id: true }
    });
    await prisma.gameState.create({ data: { gameId: game.id, paused: false } });

    const scenesPageWithModule = await call(jar, scenesPath);
    expectEqual(scenesPageWithModule.status, 200, "GET 含团本场景页");
    const importForm = new FormData();
    importForm.set(extractActionFieldAround(scenesPageWithModule.text, "同步团本场景与遭遇"), "");
    importForm.set("roomId", room.id);
    await submitAction(jar, scenesPath, importForm);

    const createdSceneA = await prisma.scene.findFirst({ where: { roomId: room.id, name: "E2E 团本场景 A" } });
    const createdSceneB = await prisma.scene.findFirst({ where: { roomId: room.id, name: "E2E 团本场景 B" } });
    ensure(createdSceneA !== null && createdSceneB !== null, "团本结构化场景应自动生成");
    const importedEncounter = await prisma.encounter.findFirst({ where: { roomId: room.id, title: "E2E 团本遭遇" } });
    ensure(importedEncounter !== null, "团本结构化遭遇应自动生成");
    expectEqual(importedEncounter?.sceneId, createdSceneA?.id ?? null, "遭遇应绑定到结构化场景");
    const generatedHexMap = await prisma.map.findFirst({ where: { sceneId: createdSceneA?.id ?? "" } });
    expectEqual(generatedHexMap?.gridType, "HEX", "结构化场景网格类型应写入 HEX");

    verifyGeometry();
    console.log("PASS 场景棋盘增量 E2E：六边形几何 / 墙面 / 灯光 / 战雾 / 图层 / 团本结构化场景绑定");
    console.log("  room=" + room.id + " module=" + moduleId + " scenes=" + String(createdSceneA !== null && createdSceneB !== null));
  } finally {
    socket?.close();
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    if (moduleId !== null) await prisma.module.deleteMany({ where: { id: moduleId } });
    await prisma.user.deleteMany({ where: { username: kpName } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
