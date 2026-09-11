/**
 * 游戏历史 E2E：已结束局列表 / 只读详情 / 非成员不可见。
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const prisma = new PrismaClient();

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  if (response.status !== 201) throw new Error("注册失败：" + username + " " + response.status);
  const body = (await response.json()) as { user?: { id?: string } };
  const id = body.user?.id;
  if (id === undefined) throw new Error("注册响应缺少 user.id");
  return id;
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
  return [...jar].map(([name, value]) => name + "=" + value).join("; ");
}

async function call(jar: Map<string, string>, pathName: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader(jar);
  if (cookie.length > 0) headers.set("cookie", cookie);
  const response = await fetch(BASE + pathName, { ...init, headers, redirect: "manual" });
  absorbCookies(response, jar);
  return { status: response.status, text: await response.text(), location: response.headers.get("location") };
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const csrf = await call(jar, "/api/auth/csrf");
  const csrfBody = JSON.parse(csrf.text) as { csrfToken?: string };
  if (csrfBody.csrfToken === undefined) throw new Error("csrfToken 缺失");
  const login = await call(jar, "/api/auth/callback/credentials", {
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
  if (login.status !== 302) throw new Error("登录失败：" + username + " " + login.status);
  return jar;
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("E2E 断言失败：" + message);
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const memberName = "e2e_history_member_" + suffix;
  const outsiderName = "e2e_history_outsider_" + suffix;
  const password = "e2e_history_pass";
  let roomId: string | null = null;

  try {
    const memberId = await register(memberName, password);
    await register(outsiderName, password);

    const room = await prisma.room.create({
      data: {
        name: "E2E 历史房间",
        system: "COC7",
        ownerId: memberId,
        inviteCode: "HIS" + suffix.toUpperCase().slice(0, 6),
        members: { create: { userId: memberId, role: "KP" } }
      },
      select: { id: true }
    });
    roomId = room.id;

    const game = await prisma.game.create({
      data: {
        roomId: room.id,
        status: "ENDED",
        title: "E2E 已结束局",
        startedAt: new Date(Date.now() - 3600_000),
        endedAt: new Date(),
        createdBy: memberId
      },
      select: { id: true }
    });
    await prisma.gameState.create({
      data: {
        gameId: game.id,
        currentChapterId: "终章",
        currentSceneId: "红魔馆大厅",
        currentEncounterId: "最终战",
        gameTime: "第 3 天 23:00",
        flags: { boss_defeated: true } as never,
        counters: { clues: 4 } as never,
        custom: {}
      }
    });
    const character = await prisma.character.create({
      data: {
        userId: memberId,
        system: "COC7",
        name: "E2E 历史角色",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 10, maxDp: 10
      },
      select: { id: true }
    });
    await prisma.gameCharacter.create({
      data: {
        gameId: game.id,
        characterId: character.id,
        userId: memberId,
        status: "ALIVE",
        currentHp: 8,
        currentMp: 5,
        currentSan: 44,
        currentDp: 10
      }
    });
    await prisma.message.create({
      data: {
        roomId: room.id,
        userId: memberId,
        channel: "OOC",
        type: "CHAT",
        content: { text: "HISTORY_MESSAGE_MARKER", kind: "CHAT", dice: null } as never
      }
    });

    const memberJar = await login(memberName, password);
    const list = await call(memberJar, "/history");
    if (list.status !== 200) throw new Error("历史列表 HTTP " + list.status);
    ensure(list.text.includes("E2E 已结束局"), "历史列表应显示局名");
    ensure(list.text.includes("E2E 历史房间"), "历史列表应显示房间名");

    const detail = await call(memberJar, "/history/" + game.id);
    if (detail.status !== 200) throw new Error("历史详情 HTTP " + detail.status);
    ensure(detail.text.includes("最终局内状态"), "历史详情应显示局内状态");
    ensure(detail.text.includes("HISTORY_MESSAGE_MARKER"), "历史详情应显示历史消息");
    ensure(detail.text.includes("E2E 历史角色"), "历史详情应显示局内角色");
    ensure(detail.text.includes("boss_defeated"), "历史详情应显示旗标");

    const outsiderJar = await login(outsiderName, password);
    const blocked = await call(outsiderJar, "/history/" + game.id);
    ensure(blocked.status === 404, "非成员访问历史详情应 404，实际 " + blocked.status);

    console.log("PASS 游戏历史 E2E：列表 / 只读详情 / 非成员不可见");
    console.log("  game " + game.id + " room " + room.id);
  } finally {
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [memberName, outsiderName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
