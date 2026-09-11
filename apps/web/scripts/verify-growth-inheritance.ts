/**
 * 角色成长闭环 E2E：
 * 开局 → 记录 SAN / 技能成长 → 角色页展示差异 → 结束本局 → 再开一局继承成长。
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
  return { status: response.status, text: await response.text(), location: response.headers.get("location") };
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("E2E 断言失败：" + message);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual === expected) return;
  throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

function extractActionFieldAround(html: string, marker: string): string {
  const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
  for (const form of forms) {
    if (form.includes(marker) === false) continue;
    const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(form);
    if (match?.[1] !== undefined && match[1].length > 0) return match[1];
  }
  throw new Error("E2E 断言失败：未找到包含 server action 的标记表单：" + marker);
}

async function submitAction(jar: Map<string, string>, pathName: string, form: FormData) {
  const result = await call(jar, pathName, {
    method: "POST",
    headers: { origin: BASE, referer: BASE + pathName },
    body: form
  });
  ensure(result.status < 400, "Server Action 请求失败：" + result.status + " " + result.text.slice(0, 200));
  return result;
}

async function applyPresetToRoom(jar: Map<string, string>, roomId: string, moduleId: string): Promise<void> {
  await prisma.room.update({ where: { id: roomId }, data: { selectedModuleId: moduleId } });
  const page = await call(jar, "/rooms/" + roomId + "/prepare");
  expectEqual(page.status, 200, "GET 准备页（应用预设前）");
  const field = extractActionFieldAround(page.text, "应用团本预设到房间");
  const form = new FormData();
  form.set(field, "");
  form.set("roomId", roomId);
  form.set("moduleId", moduleId);
  form.set("force", "0");
  await submitAction(jar, "/rooms/" + roomId + "/prepare", form);
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
  const login = await call(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrfBody.csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  expectEqual(login.status, 302, "登录 " + username);
  return jar;
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_growth_kp_" + suffix;
  const playerName = "e2e_growth_player_" + suffix;
  const password = "e2e_growth_pass";
  let roomId: string | null = null;

  try {
    const kpId = await register(kpName, password);
    const playerId = await register(playerName, password);
    const room = await prisma.room.create({
      data: {
        name: "E2E 成长房",
        system: "COC7",
        ownerId: kpId,
        inviteCode: "GRO" + suffix.toUpperCase().slice(0, 6),
        status: "LOBBY",
        members: { create: [{ userId: kpId, role: "KP", ready: true }, { userId: playerId, role: "PLAYER", ready: true }] }
      },
      select: { id: true }
    });
    roomId = room.id;
    const module = await prisma.module.create({
      data: {
        roomId: room.id,
        title: "E2E 成长团本",
        version: "1.0.0",
        content: {
          text: "## 元信息\n\nE2E 成长\n\n```yaml module-scene\nid: e2e-growth-scene\nname: 成长测试场景\n```\n",
          sections: ["元信息"]
        } as never
      },
      select: { id: true }
    });
    await prisma.room.update({ where: { id: room.id }, data: { selectedModuleId: module.id } });
    const character = await prisma.character.create({
      data: {
        userId: playerId,
        system: "COC7",
        name: "E2E 成长角色",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 10, maxDp: 10,
        skills: { DODGE: 40 } as never
      },
      select: { id: true }
    });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId: room.id, userId: playerId } },
      data: { activeCharacterId: character.id }
    });

    const kpJar = await login(kpName, password);
    const playerJar = await login(playerName, password);

    // 新开局闸门：选择了团本时必须先应用预设。
    await applyPresetToRoom(kpJar, room.id, module.id);

    const preparePage = await call(kpJar, "/rooms/" + room.id + "/prepare");
    const startField = extractActionFieldAround(preparePage.text, "开始跑团");
    const startForm = new FormData();
    startForm.set(startField, "");
    startForm.set("roomId", room.id);
    startForm.set("moduleId", module.id);
    await submitAction(kpJar, "/rooms/" + room.id + "/prepare", startForm);
    const roomStarted = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    expectEqual(roomStarted?.status, "PLAYING", "开始后房间应进入 PLAYING");

    const firstGame = await prisma.game.findFirst({ where: { roomId: room.id, status: "PLAYING" }, orderBy: { createdAt: "desc" } });
    ensure(firstGame !== null, "应创建第一局");

    const roomPage = await call(kpJar, "/rooms/" + room.id);
    const advancementField = extractActionFieldAround(roomPage.text, "记录成长");
    for (const payload of [
      { kind: "SAN", target: "", delta: "5", note: "E2E SAN 奖励" },
      { kind: "SKILL", target: "DODGE", delta: "10", note: "E2E 技能成长" }
    ]) {
      const form = new FormData();
      form.set(advancementField, "");
      form.set("roomId", room.id);
      form.set("gameId", firstGame?.id ?? "");
      form.set("characterId", character.id);
      form.set("kind", payload.kind);
      form.set("target", payload.target);
      form.set("delta", payload.delta);
      form.set("note", payload.note);
      await submitAction(kpJar, "/rooms/" + room.id, form);
    }

    const progressed = await prisma.character.findUnique({ where: { id: character.id } });
    expectEqual(progressed?.maxSan, 55, "SAN 上限应成长");
    expectEqual(progressed?.san, 55, "当前 SAN 应继承成长");
    expectEqual((progressed?.skills as Record<string, number> | null)?.DODGE, 50, "技能应成长");
    const advancementCount = await prisma.characterAdvancement.count({ where: { characterId: character.id } });
    expectEqual(advancementCount, 2, "应写入两条成长记录");

    const characterPage = await call(playerJar, "/characters/" + character.id);
    const characterHtml = characterPage.text.replace(/<!-- -->/g, "");
    ensure(characterHtml.includes("成长记录"), "角色页应显示成长记录");
    ensure(characterHtml.includes("SAN 累计"), "角色页应显示 SAN 成长汇总");
    ensure(characterHtml.includes("DODGE"), "角色页应显示技能成长目标");
    ensure(characterHtml.includes("成长 +10") || characterHtml.includes("成长+10"), "角色页应显示技能成长标注");

    const endPage = await call(kpJar, "/rooms/" + room.id + "/end");
    const endForm = new FormData();
    endForm.set(extractActionFieldAround(endPage.text, "确认结束本局"), "");
    endForm.set("roomId", room.id);
    endForm.set("gameId", firstGame?.id ?? "");
    endForm.set("rows", "[]");
    await submitAction(kpJar, "/rooms/" + room.id + "/end", endForm);

    const endedGame = await prisma.game.findUnique({ where: { id: firstGame?.id ?? "" }, select: { status: true } });
    expectEqual(endedGame?.status, "ENDED", "第一局应结束");
    await prisma.roomMember.updateMany({ where: { roomId: room.id, role: { not: "SPECTATOR" } }, data: { ready: true } });

    const preparePage2 = await call(kpJar, "/rooms/" + room.id + "/prepare");
    const startForm2 = new FormData();
    startForm2.set(extractActionFieldAround(preparePage2.text, "开始跑团"), "");
    startForm2.set("roomId", room.id);
    startForm2.set("moduleId", module.id);
    await submitAction(kpJar, "/rooms/" + room.id + "/prepare", startForm2);

    const secondGame = await prisma.game.findFirst({ where: { roomId: room.id, status: "PLAYING" }, orderBy: { createdAt: "desc" } });
    ensure(secondGame !== null && secondGame.id !== firstGame?.id, "应创建第二局");
    const inherited = await prisma.gameCharacter.findUnique({
      where: { gameId_characterId: { gameId: secondGame?.id ?? "", characterId: character.id } }
    });
    expectEqual(inherited?.currentSan, 55, "第二局开局应继承 SAN 成长");

    console.log("PASS 成长闭环 E2E：成长记录 / 差异标注 / 结束本局 / 跨局继承");
    console.log("  character " + character.id + " games " + firstGame?.id + "," + secondGame?.id);
  } finally {
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, playerName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
