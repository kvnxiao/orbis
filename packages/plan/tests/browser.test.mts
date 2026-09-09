import { chromium } from "playwright";
import { expect, test } from "vitest";

import { PlanBrowser, renderMarkdown } from "../src/browser.ts";
import { presentReview, presentRound, transitionInteraction } from "../src/state.ts";

async function fixture() {
  let state = presentRound(
    { phase: "research", decisions: {} },
    {
      planId: "plan",
      roundId: "round",
      expectedRevision: 0,
      questions: ["storage", "scope"].map((id) => ({
        id,
        prerequisites: [],
        prompt: `Choose ${id}`,
        context: "**Verified fact** with [a source](https://example.com)",
        options: [
          { id: "local", label: "Local", explanation: "Works offline" },
          { id: "remote", label: "Remote", explanation: "Shares access" },
        ],
        recommendation: { optionId: "local", reason: "Offline access is required" },
      })),
    },
  );
  let version = 0;
  const server = new PlanBrowser(
    () => ({ state, version, saving: "Saved" }),
    (expected, roundId, revision, action) => {
      if (expected !== version) {
        throw new Error("Stale state");
      }
      state = transitionInteraction(state, roundId, revision, action);
      version += 1;
    },
  );
  const url = new URL(await server.start());
  return {
    server,
    url,
    headers: { Authorization: `Bearer ${url.hash.slice(1)}`, "Content-Type": "application/json" },
    read: () => state,
    review() {
      state = presentReview(
        { phase: "research", decisions: {} },
        {
          planId: "plan",
          expectedRevision: 0,
          markdown:
            "# Implementation\n\nUse the **approved** approach.\n\n## Verification\nRun tests.",
        },
      );
      version += 1;
    },
  };
}

test("browser rejects unauthorized, foreign-origin and stale mutations", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(() => {
    f.server.close();
  });
  const endpoint = `${f.url.origin}/action`;
  const body = JSON.stringify({
    version: 0,
    roundId: "round",
    revision: 1,
    action: { type: "answer", questionId: "storage", answer: { optionId: "local" } },
  });
  expect((await fetch(`${f.url.origin}/state`)).status).toBe(401);
  expect(
    (
      await fetch(endpoint, {
        method: "POST",
        headers: { ...f.headers, Origin: "https://example.com" },
        body,
      })
    ).status,
  ).toBe(403);
  expect((await fetch(endpoint, { method: "POST", headers: f.headers, body })).status).toBe(200);
  expect(f.read().decisions).toEqual({});
  expect((await fetch(endpoint, { method: "POST", headers: f.headers, body })).status).toBe(409);
  expect((await fetch(endpoint, { method: "POST", headers: f.headers, body: "{" })).status).toBe(
    409,
  );
  expect(f.read().round?.drafts.storage?.answer).toEqual({ optionId: "local" });
  f.server.close();
  await expect(fetch(`${f.url.origin}/state`, { headers: f.headers })).rejects.toThrow(
    "fetch failed",
  );
});

test.skipIf(process.env.ORBIS_BROWSER !== "1")(
  "browser review preserves feedback drafts and requires explicit approval",
  { timeout: 30000 },
  async ({ onTestFinished }) => {
    const f = await fixture();
    f.review();
    onTestFinished(() => {
      f.server.close();
    });
    const browser = await chromium.launch(
      process.platform === "win32" ? { channel: "msedge" } : {},
    );
    onTestFinished(async () => {
      await browser.close();
    });
    const page = await browser.newPage();
    await page.goto(f.url.href);
    await page.getByRole("heading", { name: "Implementation", exact: true }).waitFor();
    await page.getByLabel("Request changes").fill("Include rollback");
    await expect.poll(() => f.read().reviews?.at(-1)?.feedbackDraft).toBe("Include rollback");
    await page.reload();
    await page.getByLabel("Request changes").waitFor();
    expect(await page.getByLabel("Request changes").inputValue()).toBe("Include rollback");
    expect(f.read().phase).toBe("review");
    await page.getByRole("button", { name: "Approve this revision" }).click();
    await expect.poll(() => f.read().phase).toBe("saving");
  },
);

test("Markdown escapes embedded HTML and rejects executable URLs and remote images", () => {
  const html = renderMarkdown(
    "<script>alert(1)</script>\n\n[x](javascript:alert)\n\n<img src=x onerror=alert(1)>\n\n![tracking](https://example.com/pixel)",
  );
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain("&lt;script&gt;");
  expect(renderMarkdown("**strong** and `code`")).toContain("<strong>strong</strong>");
});

test("teardown invalidates an in-flight browser startup", async ({ onTestFinished }) => {
  const server = new PlanBrowser(
    () => ({ state: undefined, version: 0, saving: "" }),
    () => undefined,
  );
  onTestFinished(() => {
    server.close();
  });
  const pending = server.start();
  server.close();
  await expect(pending).rejects.toThrow("closed");
});

test.skipIf(process.env.ORBIS_BROWSER !== "1")(
  "a stale browser draft remains recoverable without blocking navigation",
  { timeout: 30000 },
  async ({ onTestFinished }) => {
    const f = await fixture();
    onTestFinished(() => {
      f.server.close();
    });
    const browser = await chromium.launch(
      process.platform === "win32" ? { channel: "msedge" } : {},
    );
    onTestFinished(async () => {
      await browser.close();
    });
    const page = await browser.newPage();
    await page.goto(f.url.href);
    await page.getByRole("heading", { name: "Choose storage" }).waitFor();
    await page.getByLabel("Custom answer").fill("Keep my unfinished text");
    await fetch(`${f.url.origin}/action`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        version: 0,
        roundId: "round",
        revision: 1,
        action: { type: "answer", questionId: "scope", answer: { optionId: "local" } },
      }),
    });
    await page.getByLabel("Recovered draft text").waitFor();
    expect(await page.getByLabel("Recovered draft text").inputValue()).toBe(
      "Keep my unfinished text",
    );
    await page.getByRole("button", { name: "Choose scope — draft" }).click();
    await page.getByRole("heading", { name: "Choose scope" }).waitFor();
    await page.getByRole("button", { name: "Restore as an unsubmitted draft" }).click();
    await expect
      .poll(() => f.read().round?.drafts.storage?.unfinished)
      .toBe("Keep my unfinished text");
    expect(f.read().decisions).toEqual({});
  },
);

test.skipIf(process.env.ORBIS_BROWSER !== "1")(
  "browser preserves custom text, renders Markdown, and submits only from explicit review",
  { timeout: 30000 },
  async ({ onTestFinished }) => {
    const f = await fixture();
    onTestFinished(() => {
      f.server.close();
    });
    const browser = await chromium.launch(
      process.platform === "win32" ? { channel: "msedge" } : {},
    );
    onTestFinished(async () => {
      await browser.close();
    });
    const page = await browser.newPage();
    await page.goto(f.url.href);
    await page.getByRole("heading", { name: "Choose storage" }).waitFor();
    expect(await page.locator("strong").first().textContent()).toBe("Verified fact");
    await page.getByLabel("Custom answer").fill("Offline with import");
    await expect.poll(() => f.read().round?.drafts.storage?.unfinished).toBe("Offline with import");
    await page.getByRole("button", { name: "Choose scope — unanswered" }).click();
    await page.getByRole("heading", { name: "Choose scope" }).waitFor();
    await page.getByRole("button", { name: "Accept Local" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => f.read().round?.drafts.scope?.answer?.optionId).toBe("local");
    await page.getByRole("button", { name: "Choose storage — unanswered" }).click();
    await page.getByLabel("Custom answer").waitFor();
    expect(await page.getByLabel("Custom answer").inputValue()).toBe("Offline with import");
    await page.getByRole("button", { name: "Use custom answer" }).click();
    await expect
      .poll(() => f.read().round?.drafts.storage?.answer?.custom)
      .toBe("Offline with import");
    expect(f.read().decisions).toEqual({});
    await page.reload();
    await page.getByRole("button", { name: "Review drafts" }).click();
    await page.getByRole("heading", { name: "Review draft answers" }).waitFor();
    expect(f.read().decisions).toEqual({});
    await page.getByRole("button", { name: "Submit whole round" }).click();
    await expect.poll(() => f.read().phase).toBe("research");
    expect(f.read().decisions.storage?.answer).toEqual({ custom: "Offline with import" });
  },
);
