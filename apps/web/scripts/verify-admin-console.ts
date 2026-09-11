/**
 * 管理后台 E2E：
 * 非管理员拦截 → 临时管理员访问后台 → 同步内置规则包 → 绑定规则包到房间 → 导出 JSON → loadEffectivePack 回读。
 * 运行：E2E_BASE_URL=http://localhost:3101 npx tsx --env-file=.env scripts/verify-admin-console.ts
 */
import { PrismaClient } from "@prisma/client";
import { loadEffectivePack } from "../src/server/rules/loader";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const prisma = new PrismaClient();

interface CallResult {
  readonly status: number;
  readonly text: string;
  readonly headers: Headers;
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

async function call(jar: Map<string, string>, pathName: string, init: RequestInit = {}): Promise<CallResult> {
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

async function submitAction(jar: Map<string, string>, pathName: string, form: FormData): Promise<CallResult> {
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
  const adminName = "e2e_admin_" + suffix;
  const normalName = "e2e_normal_" + suffix;
  const password = "e2e_admin_pass";
  let roomId: string | null = null;

  try {
    const adminId = await register(adminName, password);
    await register(normalName, password);
    await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });

    const normalJar = await login(normalName, password);
    const normalAdminPage = await call(normalJar, "/admin");
    ensure(
      normalAdminPage.status === 307 || normalAdminPage.status === 302 || normalAdminPage.status === 303,
      "普通用户访问 /admin 应被重定向，实际 " + normalAdminPage.status
    );

    const adminJar = await login(adminName, password);
    const dashboard = await call(adminJar, "/admin");
    expectEqual(dashboard.status, 200, "管理员 GET /admin");
    ensure(dashboard.text.includes("管理后台"), "后台首页缺少标题");

    const pages = ["/admin/users", "/admin/rooms", "/admin/modules", "/admin/games", "/admin/rulepacks", "/admin/system", "/admin/audit"];
    for (const pathName of pages) {
      const page = await call(adminJar, pathName);
      expectEqual(page.status, 200, "管理员 GET " + pathName);
    }

    // 同步内置规则包
    const rulePageBefore = await call(adminJar, "/admin/rulepacks");
    expectEqual(rulePageBefore.status, 200, "GET /admin/rulepacks 同步前");
    const syncForm = new FormData();
    syncForm.set(extractActionFieldAround(rulePageBefore.text, "同步内置规则包"), "");
    await submitAction(adminJar, "/admin/rulepacks", syncForm);

    const [cocPack, touhouPack] = await Promise.all([
      prisma.rulePack.findUnique({
        where: { slug: "coc7-baseline" },
        include: { versions: { orderBy: { createdAt: "asc" } } }
      }),
      prisma.rulePack.findUnique({
        where: { slug: "touhou-ext" },
        include: { versions: { orderBy: { createdAt: "asc" } } }
      })
    ]);
    ensure(cocPack !== null && cocPack.isBuiltin && cocPack.versions.length > 0, "coc7-baseline 同步失败");
    ensure(touhouPack !== null && touhouPack.isBuiltin && touhouPack.versions.length > 0, "touhou-ext 同步失败");
    const cocVersion = cocPack?.versions[0];
    ensure(cocVersion !== undefined && cocVersion.status === "PUBLISHED", "coc7-baseline 版本应已发布");
    ensure(cocVersion?.isActive === true, "coc7-baseline 版本应激活");

    // 创建房间并绑定已发布规则包
    const room = await prisma.room.create({
      data: {
        name: "E2E 管理规则包房",
        system: "COC7",
        ownerId: adminId,
        inviteCode: "ADM" + suffix.toUpperCase().slice(0, 6),
        members: { create: { userId: adminId, role: "KP" } }
      },
      select: { id: true }
    });
    roomId = room.id;

    const rulePage = await call(adminJar, "/admin/rulepacks");
    const bindActionField = extractActionFieldAround(rulePage.text, "保存绑定");
    const bindForm = new FormData();
    bindForm.set(bindActionField, "");
    bindForm.set("roomId", room.id);
    bindForm.set("versionId", cocVersion?.id ?? "");
    await submitAction(adminJar, "/admin/rulepacks", bindForm);

    const boundRoom = await prisma.room.findUnique({ where: { id: room.id }, select: { rulePackVersionId: true } });
    expectEqual(boundRoom?.rulePackVersionId, cocVersion?.id ?? "", "房间应绑定到发布版本");

    const effective = await loadEffectivePack({
      id: room.id,
      system: "COC7",
      rulePackVersionId: boundRoom?.rulePackVersionId ?? null,
      ruleOverride: {}
    });
    expectEqual(effective.source, "database", "loadEffectivePack 应读取数据库版本");
    ensure(effective.compiled.pack.attributes.methods.length > 0, "数据库规则包应能编译出车卡方法");

    // 导出 JSON
    const exported = await call(
      adminJar,
      "/admin/rulepacks/" + (cocPack?.id ?? "") + "/versions/" + (cocVersion?.id ?? "") + "/export"
    );
    expectEqual(exported.status, 200, "导出规则包 JSON");
    const exportedJson = JSON.parse(exported.text) as { id?: string };
    expectEqual(exportedJson.id, "coc7-baseline", "导出 JSON 的规则包 id");

    console.log("PASS 管理员后台 E2E：非管理员拦截 / 后台页面 / 内置同步 / 绑房 / 导出 / 编译回读");
    console.log("  packs=coc7-baseline+touhou-ext version=" + (cocVersion?.version ?? "") + " room=" + room.id);
  } finally {
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { username: { in: [adminName, normalName] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
