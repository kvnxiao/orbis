import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll } from "vitest";

import { restoreNetworkGuard } from "./network-guard.mts";

const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
const previousMissingKey = process.env.ORBIS_TIERED_MEMORY_TEST_MISSING_KEY;
const agentDirectory = await mkdtemp(join(tmpdir(), "orbis-tiered-memory-test-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDirectory;
delete process.env.ORBIS_TIERED_MEMORY_TEST_MISSING_KEY;

afterAll(async () => {
  restoreNetworkGuard();
  if (previousAgentDirectory === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
  }
  if (previousMissingKey === undefined) {
    delete process.env.ORBIS_TIERED_MEMORY_TEST_MISSING_KEY;
  } else {
    process.env.ORBIS_TIERED_MEMORY_TEST_MISSING_KEY = previousMissingKey;
  }
  await rm(agentDirectory, { recursive: true, force: true });
});
