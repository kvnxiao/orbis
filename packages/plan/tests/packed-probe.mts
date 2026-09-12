import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionContext,
  ExtensionUIContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import type { Component, TUI } from "@earendil-works/pi-tui";

/** Verify public imports and presenter registration without model traffic. */
export async function packedProbe(order: "base" | "before" | "after" = "after"): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "orbis-plan-packed-"));
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(cwd, "agent");
  let cleanupSession: (() => Promise<void>) | undefined;
  try {
    const manager = SessionManager.create(cwd, join(cwd, "sessions"));
    const packagePath = fileURLToPath(import.meta.resolve("@orbis/plan"));
    const presenterPath = fileURLToPath(new URL("./presenter-probe.mts", import.meta.url));
    let paths = [packagePath];
    switch (order) {
      case "base":
        break;
      case "before":
        paths = [presenterPath, packagePath];
        break;
      case "after":
        paths = [packagePath, presenterPath];
        break;
    }
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: join(cwd, "agent"),
      settingsManager: SettingsManager.inMemory(),
      additionalExtensionPaths: paths,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const { session } = await createAgentSession({
      cwd,
      agentDir: join(cwd, "agent"),
      resourceLoader: loader,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory(),
    });
    cleanupSession = async () => {
      try {
        await session.abort();
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      } finally {
        session.dispose();
      }
    };
    await session.bindExtensions({});
    initTheme("dark", false);
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Local fixture" }],
      api: "openai-responses",
      provider: "fixture",
      model: "fixture",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const extension = loader
      .getExtensions()
      .extensions.find((item) => item.tools.has("plan_start"));
    assert.ok(extension !== undefined);
    const base = session.extensionRunner.createContext();
    let phase: "round" | "review" = "round";
    const ui: ExtensionUIContext = {
      ...base.ui,
      async select(title, _items, options) {
        if (title === "Implement approved plan?") {
          return "Decide later";
        }
        if (title === "Planning presenter") {
          return "scripted-probe";
        }
        await new Promise<void>((resolve) => {
          const close = () => {
            resolve();
          };
          options?.signal?.addEventListener("abort", close, { once: true });
          if (options?.signal?.aborted === true) {
            close();
          }
        });
        return undefined;
      },
      async custom<T>(
        factory: (
          tui: TUI,
          theme: Theme,
          keys: KeybindingsManager,
          done: (result: T) => void,
        ) => Component | Promise<Component>,
      ): Promise<T> {
        const completed = Promise.withResolvers<T>();
        const component: unknown = await Reflect.apply(factory, undefined, [
          {
            terminal: { rows: 30, columns: 100 },
            requestRender() {
              return undefined;
            },
          },
          {
            fg: (_color: string, text: string) => text,
            bg: (_color: string, text: string) => text,
          },
          getKeybindings(),
          completed.resolve,
        ]);
        assert.ok(
          typeof component === "object" &&
            component !== null &&
            "handleInput" in component &&
            typeof component.handleInput === "function",
        );
        let keys = ["\x10"];
        if (order === "base") {
          keys =
            phase === "round"
              ? ["\r", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\r", "\r"]
              : ["\t", "\r"];
        }
        for (const key of keys) {
          Reflect.apply(component.handleInput, component, [key]);
        }
        const result = await completed.promise;
        if ("dispose" in component && typeof component.dispose === "function") {
          Reflect.apply(component.dispose, component, []);
        }
        return result;
      },
      notify() {
        return undefined;
      },
      setStatus() {
        return undefined;
      },
    };
    const ctx: ExtensionContext = { ...base, mode: "tui", ui };
    const start = extension.tools.get("plan_start")?.definition;
    const round = extension.tools.get("plan_round")?.definition;
    const review = extension.tools.get("plan_review")?.definition;
    assert.ok(start !== undefined && round !== undefined && review !== undefined);
    const entry = await start.execute(
      "start",
      { objective: "Packed fixture" },
      undefined,
      undefined,
      ctx,
    );
    const details: unknown = entry.details;
    assert.ok(
      typeof details === "object" &&
        details !== null &&
        "plan" in details &&
        typeof details.plan === "object" &&
        details.plan !== null &&
        "planId" in details.plan &&
        typeof details.plan.planId === "string",
    );
    const planId = details.plan.planId;
    const answers = await round.execute(
      "round",
      {
        planId,
        roundId: "round",
        expectedRevision: 0,
        questions: [
          {
            id: "scope",
            prompt: "Scope?",
            context: "Fixture",
            prerequisites: [],
            options: [
              { id: "local", label: "Local", explanation: "Offline" },
              { id: "remote", label: "Remote", explanation: "Shared" },
            ],
            recommendation: { optionId: "local", reason: "Offline fixture" },
          },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    assert.match(JSON.stringify(answers.details), /"outcome":"answers"/);
    phase = "review";
    const markdown = "# Packed plan\r\n\r\né **unchanged**\r\n";
    const accepted = await review.execute(
      "review",
      { planId, expectedRevision: 0, markdown },
      undefined,
      undefined,
      ctx,
    );
    assert.match(JSON.stringify(accepted.details), /"outcome":"approval"/);
    assert.equal(await readFile(join(cwd, ".pi", "plans", planId + "-1.md"), "utf8"), markdown);
  } finally {
    try {
      await cleanupSession?.();
    } finally {
      if (previousAgentDirectory === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
      }
      await rm(cwd, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  const fetch = globalThis.fetch;
  const connect = Reflect.get(Socket.prototype, "connect");
  globalThis.fetch = async () =>
    await Promise.reject(new Error("Network is disabled in the packed probe."));
  Socket.prototype.connect = function () {
    throw new Error("Network is disabled in the packed probe.");
  };
  try {
    for (const order of ["base", "before", "after"] as const) {
      // oxlint-disable-next-line no-await-in-loop -- Each probe owns a complete disposable session.
      await packedProbe(order);
    }
  } finally {
    globalThis.fetch = fetch;
    Socket.prototype.connect = connect;
  }
  process.stdout.write("Packed base and presenter workflows passed.\n");
}
