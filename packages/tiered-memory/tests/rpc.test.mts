import { spawnSync } from "node:child_process";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("Pi RPC sends status notifications and saves reports without starting an agent turn", async () => {
  const packageRoot = resolve(
    dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),
    "..",
  );
  const manifest: unknown = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (!isRecord(manifest) || !isRecord(manifest.bin) || typeof manifest.bin.pi !== "string") {
    throw new Error("Installed Pi package does not declare a CLI binary.");
  }

  const root = await mkdtemp(join(tmpdir(), "orbis-tiered-memory-rpc-"));
  try {
    const inputPath = join(root, "commands.jsonl");
    const outputPath = join(root, "events.jsonl");
    await writeFile(
      inputPath,
      [
        { id: "status", type: "prompt", message: "/tiered-memory status" },
        { id: "unknown", type: "prompt", message: "/tiered-memory unexpected" },
        { id: "entries", type: "get_entries" },
        { id: "messages", type: "get_messages" },
      ]
        .map((command) => JSON.stringify(command))
        .join("\n") + "\n",
    );
    const input = await open(inputPath, "r");
    const output = await open(outputPath, "w");
    let result;
    try {
      result = spawnSync(
        process.execPath,
        [
          "--import",
          new URL("./network-guard.mts", import.meta.url).href,
          resolve(packageRoot, manifest.bin.pi),
          "--mode",
          "rpc",
          "--no-extensions",
          "--extension",
          resolve(import.meta.dirname, "../src/index.ts"),
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--no-context-files",
          "--no-builtin-tools",
          "--no-approve",
          "--offline",
          "--session-dir",
          join(root, "sessions"),
        ],
        {
          cwd: root,
          env: {
            HOME: root,
            TMPDIR: root,
            XDG_CONFIG_HOME: root,
            XDG_CACHE_HOME: root,
            PI_CODING_AGENT_DIR: join(root, "agent"),
            PI_OFFLINE: "1",
            PI_TELEMETRY: "0",
            NO_COLOR: "1",
          },
          stdio: [input.fd, output.fd, "pipe"],
          encoding: "utf8",
          timeout: 15_000,
          killSignal: "SIGKILL",
        },
      );
    } finally {
      await input.close();
      await output.close();
    }

    const stderr = result.stderr;
    expect(result.error, `Pi RPC failed. stderr: ${stderr}`).toBeUndefined();
    expect(result.status, `Pi RPC exited unsuccessfully. stderr: ${stderr}`).toBe(0);
    const lines = (await readFile(outputPath, "utf8")).trimEnd().split("\n");
    const records = lines.map((line): RecordValue => {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value)) {
        throw new Error(`Pi RPC emitted a non-object record. stderr: ${stderr}`);
      }
      return value;
    });
    for (const id of ["status", "unknown", "entries", "messages"]) {
      expect(
        records.find((record) => record.type === "response" && record.id === id)?.success,
        `Pi RPC ${id} response failed. stderr: ${stderr}`,
      ).toBe(true);
    }

    const status = records.find(
      (record) =>
        record.type === "extension_ui_request" &&
        record.method === "notify" &&
        typeof record.message === "string" &&
        record.message.startsWith("Tiered memory:"),
    );
    expect(status?.notifyType).toBe("info");
    const usage = records.find(
      (record) =>
        record.type === "extension_ui_request" &&
        record.method === "notify" &&
        record.message === "Usage: /tiered-memory [on|off|status]",
    );
    expect(usage?.notifyType).toBe("warning");

    const entriesResponse = records.find(
      (record) => record.type === "response" && record.id === "entries",
    );
    if (!isRecord(entriesResponse?.data) || !Array.isArray(entriesResponse.data.entries)) {
      throw new Error(`Pi RPC did not return session entries. stderr: ${stderr}`);
    }
    const entries = entriesResponse.data.entries.filter((value: unknown): value is RecordValue =>
      isRecord(value),
    );
    const reports = entries.filter(
      (entry: RecordValue) => entry.customType === "orbis-tiered-memory-report",
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]?.data).toEqual({ version: 1, text: status?.message });
    expect(
      entries.some((entry: RecordValue) => entry.customType === "orbis-tiered-memory-activation"),
    ).toBe(false);

    const messagesResponse = records.find(
      (record) => record.type === "response" && record.id === "messages",
    );
    expect(isRecord(messagesResponse?.data) && messagesResponse.data.messages).toEqual([]);
    expect(records.some((record) => record.type === "agent_start")).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
