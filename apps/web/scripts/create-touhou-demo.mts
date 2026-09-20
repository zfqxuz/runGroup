/**
 * 一次性浏览器脚本：用 bdmin 身份创建东方团本 + 3 张角色卡。
 * 运行：E2E_BASE_URL=http://localhost:3100 npx tsx scripts/create-touhou-demo.mts
 * 依赖 Playwright 浏览器环境（见 scripts/run-e2e-web.sh 的 PLAYWRIGHT_BROWSERS_PATH）。
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const USERNAME = process.env.SEED_USERNAME ?? "bdmin";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo1234";

async function expectNameInList(page: import("playwright").Page, name: string): Promise<void> {
  await page.goto("/characters");
  await page.getByText(name, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("用户名").fill(USERNAME);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/");
    console.log("logged in as", USERNAME);

    // 1. 创建东方团本
    await page.goto("/modules/mine");
    await page.locator('select[name="system"]').selectOption("TOUHOU");
    await page.locator('select[name="era"]').selectOption("FANTASY");
    await page.getByRole("button", { name: "新建空白团本" }).click();
    await page.waitForURL(/\/modules\/[^/]+$/, { timeout: 30_000 });
    console.log("module created", page.url());

    // 2. 创建 3 张角色卡
    const names = ["博丽灵梦", "雾雨魔理沙", "十六夜咲夜"];
    for (const name of names) {
      await page.goto("/characters/new?system=TOUHOU");
      await page.getByLabel("角色名").fill(name);
      await page.getByLabel("玩家名").fill("bdmin");
      await page.getByLabel("性别").fill(name === "十六夜咲夜" ? "女" : "女");
      const raceSelect = page.locator("select").filter({ has: page.getByRole("option", { name: "妖怪" }) });
      if (await raceSelect.count() > 0) await raceSelect.first().selectOption({ label: "妖怪" }).catch(() => undefined);
      await page.getByRole("button", { name: "掷 5 组" }).click();
      await page.getByRole("button", { name: "选用" }).first().click();
      await page.getByRole("button", { name: "下一步" }).click();
      await page.getByRole("button", { name: "创建角色" }).click();
      await page.waitForURL(/\/characters(\?|$)/, { timeout: 30_000 });
      await expectNameInList(page, name);
      console.log("character created", name);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
