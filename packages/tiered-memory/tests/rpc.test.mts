import { spawnSync } from "node:child_process";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, expect, test } from "vitest";

type RecordValue = Record<string, unknown>;

interface RpcRun {
  records: RecordValue[];
  stderr: string;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runRpc(commands: readonly RecordValue[]): Promise<RpcRun> {
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
    await writeFile(inputPath, commands.map((command) => `${JSON.stringify(command)}\n`).join(""));
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
    if (result.error !== undefined || result.status !== 0) {
      throw new Error(
        `Pi RPC exited unsuccessfully (${String(result.status)}). stderr: ${stderr}`,
        {
          cause: result.error,
        },
      );
    }
    const lines = (await readFile(outputPath, "utf8")).trimEnd().split("\n");
    const records = lines.map((line): RecordValue => {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value)) {
        throw new Error(`Pi RPC emitted a non-object record. stderr: ${stderr}`);
      }
      return value;
    });
    return { records, stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

let run: RpcRun;

beforeAll(async () => {
  run = await runRpc([
    { id: "commands", type: "get_commands" },
    { id: "status", type: "prompt", message: "/tiered-memory status" },
    { id: "unknown", type: "prompt", message: "/tiered-memory unexpected" },
    { id: "entries", type: "get_entries" },
    { id: "messages", type: "get_messages" },
  ]);
}, 20_000);

function succeeded(id: string): boolean {
  return run.records.some(
    (record) => record.type === "response" && record.id === id && record.success === true,
  );
}

function responseData(id: string): RecordValue {
  const found = run.records.find((record) => record.type === "response" && record.id === id);
  if (found?.success !== true || !isRecord(found.data)) {
    throw new Error(`Pi RPC ${id} response failed or has no data. stderr: ${run.stderr}`);
  }
  return found.data;
}

function notification(matches: (message: string) => boolean): RecordValue | undefined {
  return run.records.find(
    (record) =>
      record.type === "extension_ui_request" &&
      record.method === "notify" &&
      typeof record.message === "string" &&
      matches(record.message),
  );
}

test("Pi RPC registers the tiered-memory command", () => {
  const commands = responseData("commands").commands;
  expect(Array.isArray(commands) ? commands : []).toContainEqual(
    expect.objectContaining({ name: "tiered-memory", source: "extension" }),
  );
});

test("Pi RPC notifies status and usage and saves one report matching the status text", () => {
  const status = notification((message) => message.startsWith("Tiered memory:"));
  expect(status?.notifyType).toBe("info");
  const usage = notification((message) => message === "Usage: /tiered-memory [on|off|status]");
  expect(usage?.notifyType).toBe("warning");
  expect(succeeded("status") && succeeded("unknown")).toBe(true);
  const entries = responseData("entries").entries;
  const custom = (Array.isArray(entries) ? entries : []).filter((entry) => isRecord(entry));
  const reports = custom.filter((entry) => entry.customType === "orbis-tiered-memory-report");
  expect(reports).toHaveLength(1);
  expect(reports[0]?.data).toEqual({ version: 1, text: status?.message });
  expect(custom.some((entry) => entry.customType === "orbis-tiered-memory-activation")).toBe(false);
});

test("Pi RPC status commands start no agent turn and add no messages", () => {
  expect(responseData("messages").messages).toEqual([]);
  expect(run.records.some((record) => record.type === "agent_start")).toBe(false);
});
