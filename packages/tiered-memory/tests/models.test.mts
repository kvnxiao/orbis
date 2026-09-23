import { expect, test, vi } from "vitest";

import { resolveModel } from "../src/models.ts";
import { defaultLimits } from "../src/settings.ts";
import { fixture, fixtureModel } from "./pi-fixture.mts";

test("Pi resolves independent role overrides and caps work to each model", async ({
  onTestFinished,
}) => {
  const observer = {
    ...fixtureModel,
    id: "observer/nested",
    name: "Observer",
    contextWindow: 10000,
    maxTokens: 1500,
  };
  const consolidator = {
    ...fixtureModel,
    id: "consolidator",
    name: "Consolidator",
    contextWindow: 12000,
    maxTokens: 3000,
  };
  const f = await fixture({
    models: [observer, consolidator],
    personal: {
      observerModel: "tiered-fixture/observer/nested",
      consolidatorModel: "tiered-fixture/consolidator",
    },
  });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain(
    "observer model: tiered-fixture/observer/nested (personal); tiered-fixture/observer/nested; input cap 8192 estimated tokens, output cap 1500 tokens",
  );
  expect(f.report()).toContain(
    "consolidator model: tiered-fixture/consolidator (personal); tiered-fixture/consolidator; input cap 8192 estimated tokens, output cap 2048 tokens",
  );
});

test("Pi suspends only the unresolved role", async ({ onTestFinished }) => {
  const f = await fixture({ personal: { observerModel: "unknown/missing" } });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain(
    "observer model: unknown/missing (personal); unknown/missing; suspended: Model identifier is unresolved.",
  );
  expect(f.report()).toContain(
    "consolidator model: active session model (default); tiered-fixture/fixture; input cap",
  );
});

test("Pi suspends a worker whose output cannot hold the mandatory note", async ({
  onTestFinished,
}) => {
  const tiny = { ...fixtureModel, id: "tiny", name: "Tiny", maxTokens: 512 };
  const f = await fixture({ models: [tiny], personal: { observerModel: "tiered-fixture/tiny" } });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain(
    "observer model: tiered-fixture/tiny (personal); tiered-fixture/tiny; suspended: Model capacity is smaller than mandatory memory budgets.",
  );
});

test("Pi reports acting model capacity independently from worker capacity", async ({
  onTestFinished,
}) => {
  const tiny = { ...fixtureModel, id: "acting-tiny", name: "Tiny actor", contextWindow: 512 };
  const f = await fixture({ model: tiny });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain("Acting model: mandatory work note does not fit remaining context");
});

test("Pi reports missing credentials without substituting the session provider", async ({
  onTestFinished,
}) => {
  const noAuth = {
    ...fixtureModel,
    provider: "tiered-noauth",
    id: "observer",
    name: "No credentials",
  };
  const f = await fixture({
    noAuthModel: noAuth,
    personal: { observerModel: "tiered-noauth/observer" },
  });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain(
    "observer model: tiered-noauth/observer (personal); tiered-noauth/observer; suspended: Credentials unavailable. Check this provider’s authentication and retry.",
  );
  expect(f.report()).toContain(
    "consolidator model: active session model (default); tiered-fixture/fixture; input cap",
  );
});

test("omitted override uses the exact active SDK model outside the registry", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const active = { ...fixtureModel, id: "session-only", contextWindow: 3200, maxTokens: 1500 };
  const ctx = { ...f.session.extensionRunner.createContext(), model: active };
  const authentication = vi.spyOn(ctx.modelRegistry, "getApiKeyAndHeaders");
  const lookup = vi.spyOn(ctx.modelRegistry, "find");
  onTestFinished(() => {
    authentication.mockRestore();
    lookup.mockRestore();
  });
  const result = await resolveModel(
    ctx,
    { enabled: true, limits: { ...defaultLimits } },
    "observer",
  );
  expect(result).toMatchObject({
    state: "ready",
    id: "tiered-fixture/session-only",
    inputTokens: 1700,
    outputTokens: 1500,
  });
  expect(authentication.mock.calls[0]?.[0]).toBe(active);
  expect(lookup).not.toHaveBeenCalled();
});

test("omitted override keeps active model capacities when registry metadata differs", async ({
  onTestFinished,
}) => {
  const f = await fixture();
  onTestFinished(async () => {
    await f.dispose();
  });
  const active = { ...fixtureModel, contextWindow: 4000, maxTokens: 1500 };
  const ctx = { ...f.session.extensionRunner.createContext(), model: active };
  const result = await resolveModel(
    ctx,
    { enabled: true, limits: { ...defaultLimits } },
    "observer",
  );
  expect(result).toMatchObject({
    state: "ready",
    id: "tiered-fixture/fixture",
    inputTokens: 2500,
    outputTokens: 1500,
  });
});

test("Pi model selection updates the omitted role without changing an explicit override", async ({
  onTestFinished,
}) => {
  const other = { ...fixtureModel, id: "other", name: "Other", maxTokens: 1500 };
  const f = await fixture({
    models: [other],
    personal: { observerModel: "tiered-fixture/fixture" },
  });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.session.setModel(other);
  await f.command("status");
  expect(f.report()).toContain(
    "observer model: tiered-fixture/fixture (personal); tiered-fixture/fixture; input cap 8192 estimated tokens, output cap 2048 tokens",
  );
  expect(f.report()).toContain(
    "consolidator model: active session model (default); tiered-fixture/other; input cap 8192 estimated tokens, output cap 1500 tokens",
  );
});

test("credential-command errors never enter status or persisted reports", async ({
  onTestFinished,
}) => {
  const sentinel = "ORBIS_CREDENTIAL_SENTINEL";
  const noAuth = {
    ...fixtureModel,
    provider: "tiered-noauth",
    id: "observer",
    name: "Credential command",
  };
  const f = await fixture({
    noAuthModel: noAuth,
    credentialCommand: `!node -e "process.stderr.write('${sentinel}');process.exit(1)"`,
    personal: { observerModel: "tiered-noauth/observer" },
  });
  onTestFinished(async () => {
    await f.dispose();
  });
  await f.command("status");
  expect(f.report()).toContain(
    "observer model: tiered-noauth/observer (personal); tiered-noauth/observer; suspended:",
  );
  expect(f.report()).not.toContain(sentinel);
  expect(JSON.stringify(f.session.sessionManager.getBranch())).not.toContain(sentinel);
});
