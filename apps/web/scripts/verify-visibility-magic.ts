/**
 * 可见性与魔法准备 E2E：
 * 玩家角色互见配置 / NPC 默认隐藏与公开 / 模组魔法规则启用 / loadEffectivePack 回读 / MAGIC 行动校验。
 */
import { PrismaClient } from "@prisma/client";
import { applyMagicRulesToRoom } from "../src/server/modules/magic";
import { loadEffectivePack } from "../src/server/rules/loader";
import { validateCombatAction } from "../src/server/combat/options";

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

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  if (response.status !== 201) throw new Error("注册失败：" + username + " " + String(response.status));
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
    body: new URLSearchParams({ csrfToken: csrfBody.csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  if (loginResult.status !== 302) throw new Error("登录失败：" + username + " " + String(loginResult.status));
  return jar;
}

function ensure(condition: boolean, message: string): void {
  if (condition === false) throw new Error("E2E 断言失败：" + message);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual === expected) return;
  throw new Error("E2E 断言失败：" + message + "，期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

async function createApprovedCharacter(userId: string, name: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      userId,
      system: "COC7",
      name,
      str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
      hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 10, maxDp: 10
    },
    select: { id: true }
  });
  return character.id;
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const password = "e2e_visibility_pass";
  const kpName = "e2e_vis_kp_" + suffix;
  const playerName = "e2e_vis_p1_" + suffix;
  const player2Name = "e2e_vis_p2_" + suffix;
  let roomId: string | null = null;
  let moduleId: string | null = null;

  try {
    const kpId = await register(kpName, password);
    const playerId = await register(playerName, password);
    const player2Id = await register(player2Name, password);

    const room = await prisma.room.create({
      data: {
        name: "E2E 可见性房",
        system: "COC7",
        ownerId: kpId,
        inviteCode: "VIS" + suffix.toUpperCase().slice(0, 6),
        status: "LOBBY",
        members: {
          create: [
            { userId: kpId, role: "KP" },
            { userId: playerId, role: "PLAYER", ready: true },
            { userId: player2Id, role: "PLAYER", ready: true }
          ]
        }
      },
      select: { id: true, characterVisibility: true }
    });
    roomId = room.id;
    expectEqual(room.characterVisibility, "PUBLIC", "房间角色互见默认应为 PUBLIC");

    const character1 = await createApprovedCharacter(playerId, "玩家一角色");
    const character2 = await createApprovedCharacter(player2Id, "玩家二角色");
    await prisma.roomCharacterEntry.createMany({
      data: [
        { roomId: room.id, characterId: character1, status: "APPROVED" },
        { roomId: room.id, characterId: character2, status: "APPROVED" }
      ]
    });

    const hiddenNpc = await prisma.card.create({
      data: {
        scope: "ROOM", roomId: room.id, ownerId: kpId, type: "NPC", name: "隐藏Boss",
        system: "COC7", isPublic: false,
        stats: {
          presetId: null, tier: "BOSS", race: null,
          attributes: { str: 80, con: 80, siz: 80, dex: 60, app: 30, int: 60, pow: 80, edu: 50, luck: 40 },
          skills: { FIGHTING_BRAWL: 70 }, maxHp: 99, maxMp: 0, maxSan: 0, maxDp: 0,
          tags: [], rarity: "LEGENDARY"
        }
      },
      select: { id: true }
    });

    const playerJar = await login(playerName, password);

    const prepareHidden = await call(playerJar, "/rooms/" + room.id + "/prepare");
    expectEqual(prepareHidden.status, 200, "玩家 GET 准备页");
    ensure(prepareHidden.text.includes("隐藏Boss") === false, "未公开 NPC 不应出现在玩家准备页");

    await prisma.card.update({ where: { id: hiddenNpc.id }, data: { isPublic: true } });
    const preparePublic = await call(playerJar, "/rooms/" + room.id + "/prepare");
    expectEqual(preparePublic.status, 200, "公开 NPC 后玩家 GET 准备页");
    ensure(preparePublic.text.includes("隐藏Boss"), "公开 NPC 应出现在玩家准备页");

    const publicCharPage = await call(playerJar, "/rooms/" + room.id + "/characters/" + character2);
    expectEqual(publicCharPage.status, 200, "PUBLIC 下玩家可查看队友角色");
    ensure(publicCharPage.text.includes("玩家二角色"), "队友角色页应包含角色名");

    await prisma.room.update({ where: { id: room.id }, data: { characterVisibility: "PRIVATE" } });
    const privateCharPage = await call(playerJar, "/rooms/" + room.id + "/characters/" + character2);
    expectEqual(privateCharPage.status, 404, "PRIVATE 下玩家不可查看队友角色");
    const ownCharPage = await call(playerJar, "/rooms/" + room.id + "/characters/" + character1);
    expectEqual(ownCharPage.status, 200, "PRIVATE 下玩家仍可查看自己的角色");

    const moduleRecord = await prisma.module.create({
      data: {
        ownerId: kpId,
        title: "E2E 魔法模组",
        system: "COC7",
        era: "MODERN",
        version: "1.0.0",
        content: {
          format: "markdown",
          text: "## 附录\n魔法规则",
          structured: {
            magic: [
              {
                id: "fireball",
                name: "火球",
                skill: "OCCULT",
                mpCost: "3",
                sanCost: "1d3",
                damage: "1d6",
                target: "ONE",
                description: "向目标投掷火球"
              }
            ]
          }
        } as never
      },
      select: { id: true }
    });
    moduleId = moduleRecord.id;

    await prisma.room.update({
      where: { id: room.id },
      data: { selectedModuleId: moduleRecord.id, magicEnabled: true }
    });
    const applied = await applyMagicRulesToRoom(room.id, moduleRecord.id);
    expectEqual(applied, 1, "应写入 1 条魔法规则");

    const roomAfter = await prisma.room.findUnique({
      where: { id: room.id },
      select: { ruleOverride: true, rulePackVersionId: true, system: true }
    });
    const effective = await loadEffectivePack({
      id: room.id,
      system: "COC7",
      rulePackVersionId: roomAfter?.rulePackVersionId ?? null,
      ruleOverride: roomAfter?.ruleOverride ?? {}
    });
    expectEqual(effective.compiled.pack.magic?.enabled, true, "编译后规则包应启用魔法");
    expectEqual(effective.compiled.pack.magic?.spells.length, 1, "编译后应包含 1 条法术");

    const actionError = validateCombatAction(
      {
        pack: effective.compiled,
        state: { participants: [{ id: "caster", defeated: false }, { id: "target", defeated: false }] },
        attackSkills: new Map()
      },
      { actorId: "caster", kind: "MAGIC", targetId: "target", spellId: "fireball" }
    );
    expectEqual(actionError, null, "MAGIC 行动校验应通过");

    console.log("PASS 可见性与魔法准备 E2E：NPC 隐藏/公开 / 角色互见配置 / 魔法规则启用与校验");
    console.log("  room=" + room.id + " module=" + moduleId + " spells=" + String(effective.compiled.pack.magic?.spells.length ?? 0));
  } finally {
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    if (moduleId !== null) await prisma.module.deleteMany({ where: { id: moduleId } });
    await prisma.user.deleteMany({ where: { username: { in: [kpName, playerName, player2Name] } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
