import { expect, test } from "@playwright/test";

function luminance(color: string): number {
  const match = /rgba?\(([^)]+)\)/.exec(color);
  if (match === null || match[1] === undefined) return 1;
  const parts = match[1].split(",").map((item) => Number(item.trim()));
  const [r = 255, g = 255, b = 255] = parts;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

test("白天模式对比度：浅色强调字变深、深色遮罩上的字保持浅色", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "day";
    const host = document.createElement("div");
    host.id = "contrast-samples";
    host.innerHTML = `
      <div id="sample-amber" class="text-amber-200 bg-amber-400/5">浅黄气泡文字</div>
      <div id="sample-emerald" class="text-emerald-300 bg-emerald-400/10">绿色提示</div>
      <div id="sample-sakura" class="text-sakura-300 bg-sakura-500/10">粉色提示</div>
      <div id="sample-overlay" class="text-white/80 bg-black/60">深色遮罩文字</div>
    `;
    document.body.appendChild(host);
  });

  const amber = await page.locator("#sample-amber").evaluate((el) => getComputedStyle(el).color);
  const emerald = await page.locator("#sample-emerald").evaluate((el) => getComputedStyle(el).color);
  const sakura = await page.locator("#sample-sakura").evaluate((el) => getComputedStyle(el).color);
  const overlay = await page.locator("#sample-overlay").evaluate((el) => getComputedStyle(el).color);

  expect(luminance(amber)).toBeLessThan(0.5);
  expect(luminance(emerald)).toBeLessThan(0.5);
  expect(luminance(sakura)).toBeLessThan(0.5);
  expect(luminance(overlay)).toBeGreaterThan(0.8);
});
