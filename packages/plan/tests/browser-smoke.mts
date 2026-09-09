import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";

const url = process.argv[2];
if (url === undefined) {
  throw new Error("Supply the planning browser URL from Pi.");
}
const browser = await chromium.launch(process.platform === "win32" ? { channel: "msedge" } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(url);
  await page.getByLabel("Custom answer").waitFor();
  assert.equal(await page.getByLabel("Custom answer").inputValue(), "switch draft");
  const saved = page.waitForResponse(
    (response) => response.url().includes("/action") && response.status() === 200,
  );
  await page.getByLabel("Custom answer").fill("browser edit preserved");
  await saved;
  await page.reload();
  await page.getByLabel("Custom answer").waitFor();
  assert.equal(await page.getByLabel("Custom answer").inputValue(), "browser edit preserved");
  const evidenceDirectory = resolve(import.meta.dirname, "../implementation/evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, "plan-browser.png"), fullPage: true });
  process.stdout.write(
    JSON.stringify({
      browser: browser.version(),
      draft: "browser edit preserved",
      reload: "preserved",
    }),
  );
} finally {
  await browser.close();
}
