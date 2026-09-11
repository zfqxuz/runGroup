/**
 * P2-3 成长检定 E2E：
 * 标记成长点 → CoC 幕间成长掷骰 → 来源标注 → 编辑 / 撤销 → 筛选 / CSV 导出
 * → 结束本局成长确认页与角色卡预览 → 结束前自动结算。
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
  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type")
  };
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("E2E 断言失败：" + message);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual === expected) return;
  throw new Error(
    "E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual)
  );
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

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_growthcheck_kp_" + suffix;
  const playerName = "e2e_growthcheck_player_" + suffix;
  const password = "e2e_growthcheck_pass";
  let roomId: string | null = null;

  try {
    const kpId = await register(kpName, password);
    const playerId = await register(playerName, password);
    const room = await prisma.room.create({
      data: {
        name: "E2E 成长检定房",
        system: "COC7",
        ownerId: kpId,
        inviteCode: "GCH" + suffix.toUpperCase().slice(0, 6),
        status: "PLAYING",
        members: {
          create: [
            { userId: kpId, role: "KP", ready: true },
            { userId: playerId, role: "PLAYER", ready: true }
          ]
        }
      },
      select: { id: true }
    });
    roomId = room.id;

    const character = await prisma.character.create({
      data: {
        userId: playerId,
        system: "COC7",
        name: "E2E 成长检定角色",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 10, maxDp: 10,
        skills: { DODGE: 0 } as never
      },
      select: { id: true }
    });
    await prisma.roomCharacterEntry.create({
      data: { roomId: room.id, characterId: character.id, status: "APPROVED" }
    });
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId: room.id, userId: playerId } },
      data: { activeCharacterId: character.id }
    });
    const game = await prisma.game.create({
      data: {
        roomId: room.id,
        status: "PLAYING",
        title: "E2E 成长检定局",
        startedAt: new Date(),
        createdBy: kpId
      },
      select: { id: true }
    });
    await prisma.gameCharacter.create({
      data: {
        gameId: game.id,
        characterId: character.id,
        userId: playerId,
        currentHp: 10,
        currentMp: 10,
        currentSan: 50,
        currentDp: 10
      }
    });

    const kpJar = await login(kpName, password);
    const playerJar = await login(playerName, password);
    const roomPath = "/rooms/" + room.id;
    const characterPath = "/characters/" + character.id;

    // 1. 标记成长点（DODGE 当前 0，必定通过）
    const roomPage = await call(kpJar, roomPath);
    ensure(roomPage.text.includes("成长与奖励"), "房间页应显示成长面板");
    const markForm = new FormData();
    markForm.set(extractActionFieldAround(roomPage.text, "标记成长点"), "");
    markForm.set("roomId", room.id);
    markForm.set("gameId", game.id);
    markForm.set("characterId", character.id);
    markForm.set("skillId", "DODGE");
    markForm.set("note", "E2E 使用闪避成功");
    markForm.set("returnTo", roomPath);
    await submitAction(kpJar, roomPath, markForm);

    const pending = await prisma.growthCheck.findFirst({
      where: { gameId: game.id, characterId: character.id, skillId: "DODGE" }
    });
    ensure(pending !== null, "应写入待检定成长点");
    expectEqual(pending?.state, "PENDING", "成长点初始状态");

    // 2. 成长检定（当前 0 必然成功）
    const endPage1 = await call(kpJar, roomPath + "/end");
    ensure(endPage1.text.includes("角色卡预览"), "结束页应包含角色卡预览");
    const resolveForm = new FormData();
    resolveForm.set(extractActionFieldAround(endPage1.text, "进行成长检定"), "");
    resolveForm.set("roomId", room.id);
    resolveForm.set("gameId", game.id);
    resolveForm.set("returnTo", roomPath + "/end");
    await submitAction(kpJar, roomPath + "/end", resolveForm);

    const resolved = await prisma.growthCheck.findUnique({ where: { id: pending?.id ?? "" } });
    expectEqual(resolved?.state, "PASSED", "DODGE 成长检定应通过");
    ensure((resolved?.roll ?? 0) >= 1 && (resolved?.roll ?? 0) <= 100, "应记录 d100 结果");
    ensure((resolved?.gain ?? 0) >= 1 && (resolved?.gain ?? 0) <= 10, "成功应记录 1d10 成长");
    const afterGrowth = await prisma.character.findUnique({ where: { id: character.id } });
    expectEqual((afterGrowth?.skills as Record<string, number> | null)?.DODGE, resolved?.gain, "技能应同步成长");

    const growthAdvancement = await prisma.characterAdvancement.findFirst({
      where: { characterId: character.id, kind: "SKILL", target: "DODGE", source: "GROWTH_CHECK" },
      orderBy: { createdAt: "desc" }
    });
    ensure(growthAdvancement !== null, "成长检定应写入成长记录");
    expectEqual(growthAdvancement?.delta, resolved?.gain, "成长记录数值应与检定一致");
    const metadata = (growthAdvancement?.metadata ?? {}) as { roll?: number };
    expectEqual(metadata.roll, resolved?.roll, "成长记录 metadata 应保存掷骰结果");

    // 3. 撤销成长记录，角色数值回退
    const characterPage1 = await call(playerJar, characterPath);
    ensure(characterPage1.text.includes("成长检定"), "角色页应显示成长检定来源");
    const revertGrowthForm = new FormData();
    revertGrowthForm.set(extractActionFieldAround(characterPage1.text, "撤销并回退数值"), "");
    revertGrowthForm.set("advancementId", growthAdvancement?.id ?? "");
    revertGrowthForm.set("returnTo", characterPath);
    await submitAction(playerJar, characterPath, revertGrowthForm);

    const afterRevert = await prisma.character.findUnique({ where: { id: character.id } });
    expectEqual((afterRevert?.skills as Record<string, number> | null)?.DODGE, 0, "撤销后技能应回退");
    const revertedRow = await prisma.characterAdvancement.findUnique({ where: { id: growthAdvancement?.id ?? "" } });
    ensure(revertedRow?.revertedAt !== null && revertedRow?.revertedAt !== undefined, "记录应标记为已撤销");

    // 4. 手动 SAN 记录 → 编辑并补全来源
    const roomPage2 = await call(kpJar, roomPath);
    const recordForm = new FormData();
    recordForm.set(extractActionFieldAround(roomPage2.text, "记录成长"), "");
    recordForm.set("roomId", room.id);
    recordForm.set("gameId", game.id);
    recordForm.set("characterId", character.id);
    recordForm.set("kind", "SAN");
    recordForm.set("target", "");
    recordForm.set("delta", "5");
    recordForm.set("note", "E2E SAN 奖励");
    await submitAction(kpJar, roomPath, recordForm);

    const afterSan = await prisma.character.findUnique({ where: { id: character.id } });
    expectEqual(afterSan?.maxSan, 55, "SAN 上限应 +5");
    expectEqual(afterSan?.san, 55, "当前 SAN 应 +5");
    const sanRow = await prisma.characterAdvancement.findFirst({
      where: { characterId: character.id, kind: "SAN" },
      orderBy: { createdAt: "desc" }
    });
    expectEqual(sanRow?.source, "MANUAL", "手动记录来源应为 MANUAL");

    const characterPage2 = await call(playerJar, characterPath);
    const editForm = new FormData();
    editForm.set(extractActionFieldAround(characterPage2.text, "保存修改"), "");
    editForm.set("advancementId", sanRow?.id ?? "");
    editForm.set("returnTo", characterPath);
    editForm.set("target", "");
    editForm.set("delta", "8");
    editForm.set("source", "END_REWARD");
    editForm.set("note", "E2E 编辑后的结束奖励");
    await submitAction(playerJar, characterPath, editForm);

    const afterEdit = await prisma.character.findUnique({ where: { id: character.id } });
    expectEqual(afterEdit?.maxSan, 58, "编辑后 SAN 上限应为 58");
    expectEqual(afterEdit?.san, 58, "编辑后当前 SAN 应为 58");
    const editedRow = await prisma.characterAdvancement.findUnique({ where: { id: sanRow?.id ?? "" } });
    expectEqual(editedRow?.source, "END_REWARD", "来源应更新为结束奖励");
    expectEqual(editedRow?.delta, 8, "数值应更新为 8");
    ensure(editedRow?.editedAt !== null && editedRow?.editedAt !== undefined, "应标记编辑时间");

    // 5. 角色页筛选与 CSV 导出
    const filtered = await call(playerJar, characterPath + "?gkind=SAN&gsource=END_REWARD");
    const filteredHtml = filtered.text.replace(/<!-- -->/g, "");
    ensure(filteredHtml.includes("成长记录（1/2）"), "筛选后应只显示 1 条 SAN 记录");
    ensure(filteredHtml.includes("结束奖励"), "筛选结果应显示来源标注");

    const filteredSkill = await call(playerJar, characterPath + "?gkind=SKILL&gsource=GROWTH_CHECK");
    ensure(filteredSkill.text.includes("已撤销"), "已撤销的成长检定记录应保留并标注");

    const exported = await call(playerJar, characterPath + "/growth/export?gkind=SAN&gsource=END_REWARD");
    expectEqual(exported.status, 200, "CSV 导出状态");
    ensure((exported.contentType ?? "").includes("text/csv"), "CSV 导出 content-type");
    ensure(exported.text.includes("日期"), "CSV 应包含表头");
    ensure(exported.text.includes("结束奖励"), "CSV 应包含来源标签");
    ensure(exported.text.includes("E2E 编辑后的结束奖励"), "CSV 应包含备注");

    const exportedAll = await call(playerJar, characterPath + "/growth/export?gkind=SKILL");
    ensure(exportedAll.text.includes("已撤销"), "CSV 应包含撤销状态");

    // 6. 撤销 SAN 记录
    const characterPage3 = await call(playerJar, characterPath);
    const revertSanForm = new FormData();
    revertSanForm.set(extractActionFieldAround(characterPage3.text, "撤销并回退数值"), "");
    revertSanForm.set("advancementId", sanRow?.id ?? "");
    revertSanForm.set("returnTo", characterPath);
    await submitAction(playerJar, characterPath, revertSanForm);
    const afterSanRevert = await prisma.character.findUnique({ where: { id: character.id } });
    expectEqual(afterSanRevert?.maxSan, 50, "撤销后 SAN 上限应回退");
    expectEqual(afterSanRevert?.san, 50, "撤销后当前 SAN 应回退");

    // 7. 结束本局成长确认页 + 结束前自动结算
    await prisma.character.update({
      where: { id: character.id },
      data: { skills: { DODGE: 0, LISTEN: 0 } as never }
    });
    const roomPage3 = await call(kpJar, roomPath);
    const markSecond = new FormData();
    markSecond.set(extractActionFieldAround(roomPage3.text, "标记成长点"), "");
    markSecond.set("roomId", room.id);
    markSecond.set("gameId", game.id);
    markSecond.set("characterId", character.id);
    markSecond.set("skillId", "LISTEN");
    markSecond.set("note", "E2E 聆听检定");
    markSecond.set("returnTo", roomPath);
    await submitAction(kpJar, roomPath, markSecond);

    const endPage2 = await call(kpJar, roomPath + "/end");
    ensure(endPage2.text.includes("成长点确认"), "结束页应包含成长点确认");
    ensure(endPage2.text.includes("待检定成长点"), "结束页应显示成长点确认区");
    ensure(endPage2.text.includes("聆听"), "结束页应显示待检定技能名称");
    ensure(endPage2.text.includes("属性"), "结束页角色卡预览应包含属性区");

    const endForm = new FormData();
    endForm.set(extractActionFieldAround(endPage2.text, "确认结束本局"), "");
    endForm.set("roomId", room.id);
    endForm.set("gameId", game.id);
    endForm.set("rows", "[]");
    endForm.set("resolveGrowth", "1");
    await submitAction(kpJar, roomPath + "/end", endForm);

    const listCheck = await prisma.growthCheck.findFirst({
      where: { gameId: game.id, characterId: character.id, skillId: "LISTEN" }
    });
    expectEqual(listCheck?.state, "PASSED", "结束前自动结算应使 LISTEN 成长");
    const afterEnd = await prisma.character.findUnique({ where: { id: character.id } });
    expectEqual((afterEnd?.skills as Record<string, number> | null)?.LISTEN, listCheck?.gain, "LISTEN 应写入成长");
    const endedGame = await prisma.game.findUnique({ where: { id: game.id }, select: { status: true } });
    expectEqual(endedGame?.status, "ENDED", "本局应结束");
    const endedRoom = await prisma.room.findUnique({ where: { id: room.id }, select: { status: true } });
    expectEqual(endedRoom?.status, "LOBBY", "房间应回到准备页");

    console.log("PASS 成长检定 E2E：标记 / 掷骰 / 来源 / 编辑 / 撤销 / 筛选导出 / 结束确认");
    console.log("  room " + room.id + " game " + game.id + " character " + character.id);
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
