/**
 * 人物卡导入 E2E：构造一张最小 xlsx 人物卡，走真实页面 server action，
 * 验证基础信息、属性、技能与武器都落到角色库。
 * 前置：docker compose up -d db；npm run db:seed；npm run dev。
 */
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

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

  sheet["!ref"] = "A1:HX74";
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

    console.log("PASS 人物卡导入 E2E：属性 / 职业 / 技能 / 武器落库");
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
