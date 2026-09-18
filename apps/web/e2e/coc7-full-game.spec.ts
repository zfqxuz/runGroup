import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { prisma } from "../src/server/db/prisma";

const PASSWORD = "e2epass123";
const USER_PREFIX = "e2efull";

interface CharacterSpec {
  readonly name: string;
  readonly playerName: string;
  readonly occupation: string;
  readonly attributes: { readonly str: number; readonly con: number; readonly siz: number; readonly dex: number; readonly app: number; readonly int: number; readonly pow: number; readonly edu: number; readonly luck: number };
  readonly skills: readonly { readonly side: "LEFT" | "RIGHT"; readonly row: number; readonly name: string; readonly specialization?: string; readonly total: number }[];
  readonly weapons?: readonly { readonly name: string; readonly type: string; readonly skillLabel: string; readonly damage: string; readonly rangeText: string; readonly row: number }[];
}

function buildCharacterWorkbook(spec: CharacterSpec): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([[]]);
  const put = (address: string, value: string | number): void => {
    const target = XLSX.utils.decode_cell(address);
    const ref = XLSX.utils.encode_cell({ r: target.r, c: target.c });
    sheet[ref] = { t: typeof value === "number" ? "n" : "s", v: value, w: String(value) };
  };

  put("E3", spec.name);
  put("E4", spec.playerName);
  put("E5", spec.occupation);
  put("M4", "现代");
  put("E6", 30);
  put("M6", "男");
  put("E7", "测试城");
  put("M7", "测试乡");

  put("U3", spec.attributes.str);
  put("AA3", spec.attributes.dex);
  put("AG3", spec.attributes.pow);
  put("U5", spec.attributes.con);
  put("AA5", spec.attributes.app);
  put("AG5", spec.attributes.edu);
  put("U7", spec.attributes.siz);
  put("AA7", spec.attributes.int);
  put("AG7", spec.attributes.luck);

  for (const skill of spec.skills) {
    const prefix = skill.side === "LEFT"
      ? { name: "F", specialization: "H", total: "R", marker: "B", occupationMarker: "D", initial: "J", occupation: "N", interest: "P" }
      : { name: "AB", specialization: "AD", total: "AN", marker: "X", occupationMarker: "Z", initial: "AF", occupation: "AJ", interest: "AL" };
    if (skill.specialization !== undefined) put(prefix.specialization + String(skill.row), skill.specialization);
    put(prefix.name + String(skill.row), skill.name);
    put(prefix.initial + String(skill.row), 1);
    put(prefix.total + String(skill.row), skill.total);
    put(prefix.marker + String(skill.row), "☑");
  }

  for (const weapon of spec.weapons ?? []) {
    put("B" + String(weapon.row), weapon.name);
    put("G" + String(weapon.row), weapon.type);
    put("M" + String(weapon.row), weapon.skillLabel);
    put("W" + String(weapon.row), weapon.damage);
    put("AA" + String(weapon.row), weapon.rangeText);
    put("AC" + String(weapon.row), "×");
    put("AE" + String(weapon.row), "1(2)");
  }

  sheet["!ref"] = "A1:HX160";
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "人物卡");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

async function register(page: Page, username: string): Promise<void> {
  await page.goto("/register");
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="new-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.waitForURL("**/", { timeout: 30_000 });
}

async function login(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/", { timeout: 30_000 });
}

async function createRoom(page: Page, roomName: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("房间名").fill(roomName);
  await page.getByRole("button", { name: "创建" }).click();
  await page.waitForURL(/\/rooms\/[^/]+$/, { timeout: 30_000 });
  const roomId = new URL(page.url()).pathname.split("/")[2] ?? "";
  expect(roomId.length).toBeGreaterThan(0);
  return roomId;
}

async function joinRoom(page: Page, inviteCode: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("邀请码").fill(inviteCode);
  await page.getByRole("button", { name: "加入" }).click();
  await page.waitForURL(/\/rooms\/[^/]+/, { timeout: 30_000 });
}

async function importCharacter(page: Page, spec: CharacterSpec): Promise<void> {
  await page.goto("/characters/import");
  await page.setInputFiles('input[type="file"][name="file"]', {
    name: spec.name + ".xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buildCharacterWorkbook(spec)
  });
  await page.getByRole("button", { name: "解析并导入" }).click();
  await page.waitForURL(/\/characters\/[^/]+\/edit\?imported=1/, { timeout: 60_000 });
}

async function submitCharacterToRoom(prepare: Page, roomId: string, characterName: string): Promise<void> {
  await prepare.goto("/rooms/" + roomId + "/prepare");
  const select = prepare
    .locator('select[name="characterId"]')
    .filter({ has: prepare.locator("option", { hasText: characterName }) })
    .first();
  await expect(select).toBeVisible({ timeout: 20_000 });
  const optionValue = await select.locator("option", { hasText: characterName }).first().getAttribute("value");
  expect(optionValue).not.toBeNull();
  await select.selectOption(optionValue!);
  await prepare.getByRole("button", { name: "带入已有角色" }).click();
  await expect(prepare.getByText(characterName).first()).toBeVisible({ timeout: 20_000 });
}

function roomIdOf(page: Page): string {
  const match = /\/rooms\/([^/]+)/.exec(page.url());
  return match?.[1] ?? "";
}

async function cleanup(usernames: readonly string[]): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { in: [...usernames] } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;
  await prisma.room.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => undefined);
  await prisma.character.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
}

async function chooseReaction(page: Page, label: "不应对" | "闪避" | "反击" | "寻找掩体"): Promise<void> {
  const panel = page.locator("section").filter({ hasText: "你需要应对" }).first();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.locator("select").first().selectOption({ label });
  await panel.getByRole("button", { name: "提交应对" }).click();
}

async function selectAttackSkill(page: Page, skillId: string): Promise<void> {
  const select = page.locator("select").filter({ has: page.locator('option[value="' + skillId + '"]') }).first();
  await expect(select).toBeVisible({ timeout: 20_000 });
  await select.selectOption(skillId);
}

async function setCombatHp(page: Page, unitName: string, hp: number): Promise<void> {
  const editor = page.locator("section").filter({ hasText: "KP 数值调整" }).first();
  await expect(editor).toBeVisible({ timeout: 20_000 });
  const unitSelect = editor.locator("select").first();
  const optionValue = await unitSelect.locator("option", { hasText: unitName }).first().getAttribute("value");
  expect(optionValue).not.toBeNull();
  await unitSelect.selectOption(optionValue!);
  await editor.getByLabel("HP", { exact: true }).fill(String(hp));
  await editor.getByLabel("最大 HP", { exact: true }).fill(String(hp));
  await editor.getByRole("button", { name: "应用数值" }).click();
  await expect(editor.getByLabel("HP", { exact: true })).toHaveValue(String(hp), { timeout: 20_000 });
}

async function selectUnitSide(page: Page, unitName: string, side: "我方" | "敌方"): Promise<void> {
  const buttons = page.getByRole("button", { name: side });
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const row = button.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
    const text = await row.innerText().catch(() => "");
    if (text.includes(unitName)) {
      await button.click();
      return;
    }
  }
  throw new Error("未找到参战单位选项：" + unitName + " / " + side);
}

test("真实开一把 COC7：双玩家注册建房/加入/导入角色/过审/放 Token/开战", async ({ browser }) => {
  const suffix = Date.now().toString(36).slice(-5);
  const kpName = USER_PREFIX + "kp" + suffix;
  const playerName = USER_PREFIX + "pl" + suffix;
  const roomName = "E2E 真实双人团 " + suffix;
  const contexts: BrowserContext[] = [];
  try {
    const kpContext = await browser.newContext();
    const playerContext = await browser.newContext();
    contexts.push(kpContext, playerContext);
    const kpPage = await kpContext.newPage();
    const playerPage = await playerContext.newPage();

    await register(kpPage, kpName);
    await register(playerPage, playerName);

    const roomId = await createRoom(kpPage, roomName);
    await kpPage.goto("/rooms/" + roomId + "/prepare");
    const prepareText = await kpPage.locator("body").innerText();
    const inviteMatch = /邀请码\s+([A-Z0-9]+)/.exec(prepareText);
    expect(inviteMatch).not.toBeNull();
    await joinRoom(playerPage, inviteMatch![1]!);
    expect(playerPage.url()).toContain("/rooms/" + roomId);

    const kpSpec: CharacterSpec = {
      name: "E2E KP角色",
      playerName: "KP",
      occupation: "猎人",
      attributes: { str: 50, con: 50, siz: 50, dex: 80, app: 50, int: 60, pow: 50, edu: 60, luck: 50 },
      skills: [
        { side: "LEFT", row: 34, name: "格斗：", specialization: "斗殴", total: 200 },
        { side: "RIGHT", row: 16, name: "闪避", total: 200 },
        { side: "RIGHT", row: 17, name: "图书馆使用", total: 60 },
        { side: "RIGHT", row: 18, name: "外语", specialization: "拉丁语", total: 80 },
        { side: "RIGHT", row: 19, name: "手枪", total: 200 },
        { side: "RIGHT", row: 20, name: "剑", total: 200 }
      ],
      weapons: [
        { row: 53, name: "徒手", type: "格斗", skillLabel: "斗殴", damage: "1D3+DB", rangeText: "接触" },
        { row: 54, name: "手枪", type: "射击", skillLabel: "手枪", damage: "1D10", rangeText: "15" },
        { row: 55, name: "长剑", type: "格斗", skillLabel: "剑", damage: "1D8+DB", rangeText: "接触" }
      ]
    };
    const playerSpec: CharacterSpec = {
      name: "E2E 玩家角色",
      playerName: "PL",
      occupation: "记者",
      attributes: { str: 50, con: 50, siz: 50, dex: 60, app: 50, int: 60, pow: 50, edu: 60, luck: 50 },
      skills: [
        { side: "LEFT", row: 34, name: "格斗：", specialization: "斗殴", total: 200 },
        { side: "RIGHT", row: 16, name: "闪避", total: 200 },
        { side: "RIGHT", row: 17, name: "侦查", total: 70 }
      ]
    };

    await importCharacter(kpPage, kpSpec);
    await importCharacter(playerPage, playerSpec);

    // C-3：真实导入页把「外语（拉丁语）」落成独立复合 skill key。
    const importedKp = await prisma.character.findFirstOrThrow({
      where: { name: kpSpec.name, user: { username: kpName } },
      select: { skills: true }
    });
    expect((importedKp.skills as Record<string, number>)["LANGUAGE_OTHER#拉丁语"]).toBe(80);
    expect((importedKp.skills as Record<string, number>)["格斗（剑）"]).toBe(200);
    const importedSword = await prisma.card.findFirstOrThrow({
      where: { characterId: (await prisma.character.findFirstOrThrow({ where: { name: kpSpec.name, user: { username: kpName } }, select: { id: true } })).id, name: "长剑" },
      select: { stats: true }
    });
    expect((importedSword.stats as Record<string, unknown>).skillId).toBe("格斗（剑）");

    await submitCharacterToRoom(kpPage, roomId, kpSpec.name);
    await submitCharacterToRoom(playerPage, roomId, playerSpec.name);

    // KP 审核两张角色
    await kpPage.goto("/rooms/" + roomId + "/prepare");
    for (const [index, name] of [kpSpec.name, playerSpec.name].entries()) {
      const row = kpPage
        .locator("li")
        .filter({ hasText: name })
        .filter({ has: kpPage.getByRole("button", { name: "通过" }) })
        .first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      const approve = row.getByRole("button", { name: "通过" });
      await expect(approve).toBeVisible({ timeout: 20_000 });
      await approve.click();
      await expect
        .poll(async () => {
          const entries = await prisma.roomCharacterEntry.findMany({
            where: { roomId },
            select: { status: true }
          });
          return entries.filter((entry) => entry.status === "APPROVED").length;
        }, { timeout: 20_000 })
        .toBeGreaterThanOrEqual(index + 1);
    }

    // KP 创建场景
    await kpPage.goto("/rooms/" + roomId + "/scenes");
    await kpPage.getByPlaceholder("例：红魔馆大厅").fill("E2E 真实战场");
    await kpPage.getByRole("button", { name: "创建场景" }).click();
    await expect(kpPage.getByText("当前场景").first()).toBeVisible({ timeout: 20_000 });

    // 放两个角色 Token
    await kpPage.goto("/rooms/" + roomId + "/prepare");
    for (const name of [kpSpec.name, playerSpec.name]) {
      const unitSelect = kpPage.locator('select[name="unitRef"]');
      await expect(unitSelect).toBeVisible({ timeout: 20_000 });
      const unitValue = await unitSelect.locator("option", { hasText: name }).first().getAttribute("value");
      expect(unitValue).not.toBeNull();
      await unitSelect.selectOption(unitValue!);
      await kpPage.getByRole("button", { name: "放置到本场景" }).click();
      await expect(kpPage.getByTitle(name)).toBeVisible({ timeout: 20_000 });
    }

    // 双方准备
    await kpPage.goto("/rooms/" + roomId + "/prepare");
    await kpPage.getByRole("button", { name: "我准备好了" }).click();
    await playerPage.goto("/rooms/" + roomId + "/prepare");
    await playerPage.getByRole("button", { name: "我准备好了" }).click();

    // KP 开始跑团；若默认选中了团本，需要先按真实流程应用预设。
    await kpPage.goto("/rooms/" + roomId + "/prepare");
    const applyPreset = kpPage.getByRole("button", { name: /应用团本预设/ }).first();
    if (await applyPreset.isVisible().catch(() => false)) {
      await applyPreset.click();
      await kpPage.waitForTimeout(1500);
    }
    const start = kpPage.getByRole("button", { name: "开始跑团" });
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();
    await kpPage.waitForURL("**/rooms/" + roomId, { timeout: 30_000 });

    // KP 从 Token 直接开战
    await kpPage.goto("/rooms/" + roomId);
    const playerToken = kpPage.getByTitle(playerSpec.name);
    await playerToken.hover();
    const combatLink = playerToken.locator("a", { hasText: /直接开战|申请战斗/ }).first();
    await expect(combatLink).toBeVisible({ timeout: 15_000 });
    await combatLink.focus();
    await kpPage.keyboard.press("Enter");
    await kpPage.waitForURL((url) => /\/rooms\/[^/]+\/combat\/new$/.test(url.pathname), { timeout: 30_000 });

    if (await kpPage.locator('input[name="allies"]').count() === 0) {
      await selectUnitSide(kpPage, kpSpec.name, "我方");
    }
    if (await kpPage.locator('input[name="enemies"]').count() === 0) {
      await selectUnitSide(kpPage, playerSpec.name, "敌方");
    }
    await expect(kpPage.locator('input[name="allies"]')).toHaveCount(1);
    await expect(kpPage.locator('input[name="enemies"]')).toHaveCount(1);
    await kpPage.getByRole("button", { name: "直接开战" }).click();
    await kpPage.waitForURL(
      (url) => /\/rooms\/[^/]+\/combat\/[^/]+$/.test(url.pathname) && url.pathname.endsWith("/combat/new") === false,
      { timeout: 30_000 }
    );
    const combatUrl = kpPage.url();
    expect(combatUrl).toContain("/combat/");

    // 两个玩家分别进入同一场战斗
    await playerPage.goto(combatUrl);
    await playerPage.waitForLoadState("domcontentloaded");
    await expect(kpPage.getByText("参战单位").first()).toBeVisible({ timeout: 30_000 });
    await expect(playerPage.getByText("参战单位").first()).toBeVisible({ timeout: 30_000 });
    await expect(kpPage.locator("span").filter({ hasText: kpSpec.name }).first()).toBeVisible({ timeout: 30_000 });
    await expect(playerPage.locator("span").filter({ hasText: playerSpec.name }).first()).toBeVisible({ timeout: 30_000 });

    // 通过 KP 数值面板把双方 HP 调高，保证真实多人战斗能完整跑几轮。
    await setCombatHp(kpPage, playerSpec.name, 200);
    await kpPage.waitForTimeout(1500);

    // A 玩家浏览器发起攻击，B 玩家浏览器真实选择闪避。
    await expect(kpPage.getByRole("button", { name: "攻击", exact: true })).toBeVisible({ timeout: 30_000 });
    await kpPage.getByRole("button", { name: "攻击", exact: true }).click();
    await chooseReaction(playerPage, "闪避");
    await expect(kpPage.getByText(/伤害结算/).first()).toBeVisible({ timeout: 30_000 });

    // B 玩家浏览器反击一次，A 玩家真实选择不应对。
    await expect(playerPage.getByRole("button", { name: "攻击", exact: true })).toBeVisible({ timeout: 30_000 });
    await playerPage.getByRole("button", { name: "攻击", exact: true }).click();
    await chooseReaction(kpPage, "不应对");
    await expect(playerPage.getByText(/伤害结算/).first()).toBeVisible({ timeout: 30_000 });

    // A 玩家下一回合使用战技：踢倒；B 玩家不应对，真实结算倒地。
    await expect(kpPage.getByRole("button", { name: "攻击", exact: true })).toBeVisible({ timeout: 30_000 });
    await kpPage.locator("select").filter({ hasText: "战技：踢倒" }).selectOption("TRIP");
    await kpPage.getByRole("button", { name: "使用战技" }).click();
    await chooseReaction(playerPage, "不应对");
    await expect(kpPage.getByText("倒地", { exact: false }).first()).toBeVisible({ timeout: 30_000 });

    // B 玩家跳过；A 玩家下一回合使用手枪三连射，B 玩家不应对。
    await expect(playerPage.getByRole("button", { name: "跳过", exact: true })).toBeVisible({ timeout: 30_000 });
    await playerPage.getByRole("button", { name: "跳过", exact: true }).click();
    await expect(kpPage.getByRole("button", { name: "攻击", exact: true })).toBeVisible({ timeout: 30_000 });
    await selectAttackSkill(kpPage, "FIREARMS_HANDGUN");
    await kpPage.getByLabel("射击次数").selectOption("3");
    await kpPage.getByRole("button", { name: "攻击", exact: true }).click();
    await chooseReaction(playerPage, "不应对");
    await expect(kpPage.getByText(/第 3\/3 发/).first()).toBeVisible({ timeout: 30_000 });

    // ---- D-4 / D-2 / P3：KP 工作台真实浏览器操作（医疗、环境伤害、状态、幸运、孤注一掷）----
    const tools = kpPage.locator("section").filter({ hasText: "KP 工作台" }).first();
    await expect(tools).toBeVisible({ timeout: 20_000 });
    const toolsTarget = tools.locator("select").first();
    const toolsTargetValue = await toolsTarget
      .locator("option", { hasText: playerSpec.name })
      .first()
      .getAttribute("value");
    expect(toolsTargetValue).not.toBeNull();
    await toolsTarget.selectOption(toolsTargetValue!);

    const readToolsHp = async (): Promise<number> => {
      const text = await tools.innerText();
      const match = /HP (\d+)\//.exec(text);
      return match ? Number(match[1]) : -1;
    };

    // D-2：火焰环境伤害 1d6，HP 真实下降并写入日志。
    const hpBeforeDamage = await readToolsHp();
    await tools.getByRole("button", { name: "环境 / 持续伤害" }).click();
    await tools.getByRole("button", { name: "施加环境伤害" }).click();
    await expect(kpPage.getByText(/【环境伤害·火焰】/).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(readToolsHp, { timeout: 30_000 }).toBeLessThan(hpBeforeDamage);

    // D-4：真实掷急救检定；无论成功/失败都必须在面板给出规则结果反馈。
    await tools.getByRole("button", { name: "医疗与恢复" }).click();
    const medicalAction = tools.locator("select").filter({ hasText: "急救（受伤后 1 小时内）" }).first();
    await medicalAction.selectOption("FIRST_AID");
    await tools.getByRole("button", { name: "执行医疗" }).click();
    await expect(tools.locator("p").filter({ hasText: /急救(成功|失败)/ }).first()).toBeVisible({ timeout: 30_000 });

    // D-4：自然恢复无检定、确定性 +2 HP，验证医疗结果会写回战斗席位。
    await medicalAction.selectOption("NATURAL_HEALING");
    await tools.getByLabel("恢复天数").fill("2");
    const hpBeforeNatural = await readToolsHp();
    await tools.getByRole("button", { name: "执行医疗" }).click();
    await expect(tools.locator("p").filter({ hasText: /自然恢复/ }).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(readToolsHp, { timeout: 30_000 }).toBe(hpBeforeNatural + 2);

    // P3：状态编辑器添加 POISON，再真实移除。
    await tools.getByRole("button", { name: "状态编辑器" }).click();
    await tools.locator('input[list="condition-types"]').fill("POISON");
    await tools.getByPlaceholder("说明（可选）").fill("E2E 毒气");
    await tools.getByRole("button", { name: "添加状态" }).click();
    const poisonRow = tools.locator("div").filter({ hasText: /^POISON/ }).last();
    await expect(poisonRow).toBeVisible({ timeout: 30_000 });
    await poisonRow.getByRole("button", { name: "移除" }).click();
    await expect(tools.locator("div").filter({ hasText: /^POISON/ })).toHaveCount(0, { timeout: 30_000 });

    // D-3：添加 HALLUCINATION（1 小时），推进 1 小时后由时间推进自动到期移除。
    await tools.locator('input[list="condition-types"]').fill("HALLUCINATION");
    await tools.getByLabel("时间单位").selectOption("HOUR");
    await tools.getByLabel("剩余").fill("1");
    await tools.getByRole("button", { name: "添加状态" }).click();
    await expect(tools.locator("div").filter({ hasText: /^HALLUCINATION/ }).last()).toBeVisible({ timeout: 30_000 });
    const timeBlock = tools.locator("div.rounded-lg").filter({ hasText: "推进叙事时间" }).first();
    await timeBlock.locator("select").selectOption("HOUR");
    await timeBlock.locator('input[inputmode="numeric"]').fill("1");
    await timeBlock.getByRole("button", { name: "推进时间" }).click();
    await expect(tools.locator("p").filter({ hasText: /已到期/ }).first()).toBeVisible({ timeout: 30_000 });
    await expect(tools.locator("div").filter({ hasText: /^HALLUCINATION/ })).toHaveCount(0, { timeout: 30_000 });

    // D-1：武器 / 伤害表 KP 参考面板（含霰弹枪距离档与重伤规则）。
    await tools.getByRole("button", { name: "武器 / 伤害表" }).click();
    await expect(tools.getByText("霰弹枪", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(tools.getByText("伤害与重伤规则参考").first()).toBeVisible({ timeout: 20_000 });

    // P3：幸运检定 + 孤注一掷。
    await tools.getByRole("button", { name: "幸运 / 孤注一掷 / 计算器" }).click();
    await tools.getByRole("button", { name: "投幸运检定" }).click();
    await expect(kpPage.getByText(/【幸运检定】/).first()).toBeVisible({ timeout: 30_000 });
    await tools.locator('input[list="kp-skill-options"]').fill("DODGE");
    await tools.getByPlaceholder("玩家如何孤注一掷").fill("E2E 孤注一掷");
    await tools.getByRole("button", { name: "孤注一掷", exact: true }).click();
    await expect(kpPage.getByText(/【孤注一掷/).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    await cleanup([kpName, playerName]);
  }
});
