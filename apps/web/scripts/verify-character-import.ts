/**
 * 人物卡导入 E2E：构造一张最小 xlsx 人物卡，走真实页面 server action，
 * 验证基础信息、属性、技能与武器都落到角色库。
 * 前置：docker compose up -d db；npm run db:seed；npm run dev。
 */
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

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

function buildWorkbookBuffer(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([[]]);
  const put = (address: string, value: string | number): void => {
    const target = XLSX.utils.decode_cell(address);
    const ref = XLSX.utils.encode_cell({ r: target.r, c: target.c });
    sheet[ref] = { t: typeof value === "number" ? "n" : "s", v: value, w: String(value) };
  };

  put("E3", "E2E 导入角色");
  put("E4", "E2E 机师");
  put("E5", "猎人");
  put("M5", 18);
  put("M4", "现代");
  put("E6", 26);
  put("M6", "男");
  put("E7", "测试城");
  put("M7", "测试乡");

  put("U3", 60);
  put("AA3", 50);
  put("AG3", 50);
  put("U5", 75);
  put("AA5", 60);
  put("AG5", 75);
  put("U7", 80);
  put("AA7", 80);
  put("AG7", 50);

  // 左技能栏：格斗（斗殴）25，射击（步枪/霰弹枪）75
  put("F34", "格斗：");
  put("H34", "斗殴");
  put("J34", 25);
  put("R34", 25);
  put("B34", "☐");
  put("D34", "0");
  put("F39", "射击①");
  put("H39", "步枪/霰弹枪");
  put("J39", 25);
  put("N39", 50);
  put("R39", 75);
  put("B39", "☑");
  put("D39", "★");

  // 右技能栏：图书馆使用 20 + 兴趣 45 = 65
  put("AB17", "图书馆使用");
  put("AF17", 20);
  put("AL17", 45);
  put("AN17", 65);
  put("X17", "☑");
  put("Z17", "★");

  // 武器表：无 + 猎枪
  put("B53", "无");
  put("M53", "斗殴");
  put("B54", "E2E 猎枪");
  put("G54", "测试用霰弹枪");
  put("M54", "步枪/霰弹枪");
  put("Q54", 75);
  put("W54", "4D6/2D6/1D6");
  put("AA54", "10/20/50");
  put("AC54", "×");
  put("AE54", "1(2)");
  put("AG54", "7");
  put("AJ54", "100");

  // 随身物品：普通物品（F 列）+ 背包格物品（N 列，带备注）
  put("B79", "显露");
  put("D79", "颈部");
  put("F79", "E2E 护身符");
  put("N79", "E2E 圣水，备用");

  // 背景故事 9 项（标题在 W 列、内容在 AA 列）
  put("W61", "个人描述\n角色外貌");
  put("AA61", "E2E 外貌");
  put("W63", "思想与信念");
  put("AA63", "E2E 信念");
  put("W65", "重要之人");
  put("AA65", "E2E 重要之人");
  put("W67", "意义非凡之地");
  put("AA67", "E2E 之地");
  put("W69", "宝贵之物");
  put("AA69", "E2E 宝物");
  put("W71", "特质");
  put("AA71", "E2E 特质");
  put("W73", "难言之隐");
  put("AA73", "E2E 秘密");
  put("W75", "伤口和疤痕");
  put("AA75", "E2E 疤痕");
  put("W77", "恐惧症和狂躁症");
  put("AA77", "E2E 恐惧");
  // 调查员经历
  put("B97", "E2E 模组");
  put("J97", "E2E 角色变化");
  // 神话相关
  put("W98", "E2E 神话遭遇");
  put("AA98", "E2E 结果");
  put("AK98", "E2E 备注");
  put("AR98", "3");
  // 法术一览
  put("W114", "1");
  put("Y114", "E2E 法术");
  put("AC114", "3mp");
  put("AH114", "E2E 作用");
  // 调查员伙伴
  put("W130", "E2E 伙伴");
  put("AA130", "E2E 玩家");
  put("AD130", "E2E 注释");
  put("AL130", "E2E 改变");
  put("AP130", "E2E 相遇");

  sheet["!ref"] = "A1:HX160";
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "人物卡");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

async function main(): Promise<void> {
  const player = await prisma.user.findUnique({ where: { username: "demo_player" } });
  if (player === null) throw new Error("E2E 前置失败：请先运行 npm run db:seed");
  const characterName = "E2E 导入角色";

  try {
    const jar = await login("demo_player", "demo1234");
    const page = await call(jar, "/characters/import");
    expectEqual(page.status, 200, "GET 导入页");
    ensure(page.text.includes("导入 xlsx 人物卡"), "导入页应可访问");
    const actionField = extractActionField(page.text, "选择 .xlsx 文件");

    const buffer = buildWorkbookBuffer();
    const bytes = Uint8Array.from(buffer);
    const file = new File([bytes], "e2e-coc7-character.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const form = new FormData();
    form.set(actionField, "");
    form.set("file", file);

    const response = await call(jar, "/characters/import", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/characters/import" },
      body: form
    });
    ensure(response.status < 400, "导入请求失败，状态 " + response.status);

    const character = await prisma.character.findFirst({
      where: { userId: player.id, name: characterName },
      orderBy: { createdAt: "desc" }
    });
    if (character === null) throw new Error("E2E 断言失败：未创建导入角色");
    expectEqual(character.str, 60, "力量导入");
    expectEqual(character.edu, 75, "教育导入");
    expectEqual(character.era, "MODERN", "年代导入");
    expectEqual(character.occupation, "猎人", "职业按序号回填");
    const skills = (character.skills ?? {}) as Record<string, number>;
    expectEqual(skills.FIGHTING_BRAWL, 25, "格斗技能导入");
    expectEqual(skills.FIREARMS_RIFLE, 75, "射击技能导入");
    expectEqual(skills.LIBRARY_USE, 65, "图书馆使用导入");

    const weapons = await prisma.card.findMany({ where: { characterId: character.id, type: "WEAPON" } });
    expectEqual(weapons.length, 1, "武器数量");
    expectEqual(weapons[0]?.name, "E2E 猎枪", "武器名称");

    const itemCards = await prisma.card.findMany({
      where: { characterId: character.id, type: "ITEM" },
      orderBy: { createdAt: "asc" }
    });
    expectEqual(itemCards.length, 2, "随身物品卡数量");
    expectEqual(itemCards[0]?.name, "E2E 护身符", "随身物品-普通物品名");
    expectEqual(itemCards[0]?.subtitle, "显露 · 颈部", "随身物品-携带部位");
    expectEqual(itemCards[0]?.description, "由 xlsx 人物卡导入", "随身物品-无备注描述");
    expectEqual(itemCards[1]?.name, "E2E 圣水", "随身物品-背包格物品名");
    expectEqual(itemCards[1]?.description, "备用", "随身物品-背包备注");

    const backstory = (character.backstory ?? {}) as Record<string, unknown>;
    expectEqual(backstory.appearance, "E2E 外貌", "背景故事-角色外貌");
    expectEqual(backstory.beliefs, "E2E 信念", "背景故事-思想与信念");
    expectEqual(backstory.significantPeople, "E2E 重要之人", "背景故事-重要之人");
    expectEqual(backstory.meaningfulPlaces, "E2E 之地", "背景故事-意义非凡之地");
    expectEqual(backstory.treasuredPossessions, "E2E 宝物", "背景故事-宝贵之物");
    expectEqual(backstory.traits, "E2E 特质", "背景故事-特质");
    expectEqual(backstory.secrets, "E2E 秘密", "背景故事-难言之隐");
    expectEqual(backstory.scars, "E2E 疤痕", "背景故事-伤口和疤痕");
    expectEqual(backstory.phobias, "E2E 恐惧", "背景故事-恐惧症和狂躁症");
    const experiences = (backstory.experiences ?? []) as Array<Record<string, unknown>>;
    expectEqual(experiences.length, 1, "调查员经历数量");
    expectEqual(experiences[0]?.module, "E2E 模组", "调查员经历-模组");
    expectEqual(experiences[0]?.change, "E2E 角色变化", "调查员经历-人物变化");
    const mythos = (backstory.mythosExperiences ?? []) as Array<Record<string, unknown>>;
    expectEqual(mythos.length, 1, "神话相关数量");
    expectEqual(mythos[0]?.name, "E2E 神话遭遇", "神话相关-遇到了");
    expectEqual(mythos[0]?.result, "E2E 结果", "神话相关-获得结果");
    const spells = (backstory.spells ?? []) as string[];
    expectEqual(spells.length, 1, "法术一览数量");
    expectEqual(spells[0], "E2E 法术", "法术一览-名称");
    const companions = (backstory.companions ?? []) as Array<Record<string, unknown>>;
    expectEqual(companions.length, 1, "调查员伙伴数量");
    expectEqual(companions[0]?.name, "E2E 伙伴", "调查员伙伴-姓名");
    expectEqual(companions[0]?.module, "E2E 相遇", "调查员伙伴-相遇模组");

    const detail = await call(jar, "/characters/" + character.id);
    expectEqual(detail.status, 200, "GET 角色详情页");
    ensure(detail.text.includes("背景故事与经历"), "详情页应显示背景故事区块");
    ensure(detail.text.includes("E2E 外貌"), "详情页应显示角色外貌");
    ensure(detail.text.includes("E2E 模组"), "详情页应显示调查员经历区块");
    ensure(detail.text.includes("E2E 法术"), "详情页应显示法术一览");
    ensure(detail.text.includes("E2E 伙伴"), "详情页应显示调查员伙伴");
    ensure(detail.text.includes("E2E 护身符"), "详情页应显示随身物品");
    ensure(detail.text.includes("E2E 圣水"), "详情页应显示背包格物品");

    console.log("PASS 人物卡导入 E2E：属性 / 职业 / 技能 / 武器 / 随身物品卡 / 背景故事与经历落库并在角色页展示");
    console.log("  角色 " + character.id + "，武器 " + (weapons[0]?.id ?? "无"));
  } finally {
    await prisma.card.deleteMany({ where: { ownerId: player.id, name: "E2E 猎枪" } });
    await prisma.character.deleteMany({ where: { userId: player.id, name: characterName } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
