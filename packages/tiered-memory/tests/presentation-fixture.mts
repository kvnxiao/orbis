import { join } from "node:path";

import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { presentationsIn } from "../src/pi/presentation-log.ts";
import type { PresentationEntry } from "../src/presentation/entries.ts";
import type { ActingRequest, Fixture, FixtureOptions } from "./pi-fixture.mts";
import { committedId, noteContent, sourceReference, storeFor } from "./store-fixture.mts";

export type CreateFixture = (options?: FixtureOptions) => Promise<Fixture>;

export async function presenting(
  createFixture: CreateFixture,
  options: FixtureOptions = {},
): Promise<Fixture> {
  return await createFixture({ services: {}, ...options });
}

// Reloads first, so session start registers the prompt's source before capture.
export async function commitNote(f: Fixture, body: string, sourceText: string): Promise<string> {
  await f.reload();
  const { runtime } = f.memory();
  const ctx = f.session.extensionRunner.createContext();
  const proposal = runtime.captureProposal(ctx, noteContent({ "current-work.md": body }), [
    await sourceReference(f, sourceText),
  ]);
  return committedId(await runtime.commitProposal(ctx, proposal));
}

export function textOfMessage(message: Message): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

export function payloadTexts(request: ActingRequest | undefined): string[] {
  return (request?.messages ?? []).map((message) => textOfMessage(message));
}

export function noteBlocks(request: ActingRequest | undefined): string[] {
  return payloadTexts(request).filter((text) =>
    text.startsWith("[Tiered memory: current-work note,"),
  );
}

export function correctionBlocks(request: ActingRequest | undefined): string[] {
  return payloadTexts(request).filter((text) => text.startsWith("[Tiered memory: correction]"));
}

export function branchRecords(f: Fixture): PresentationEntry[] {
  return presentationsIn(f.session.sessionManager.getBranch()).records.map(({ entry }) => entry);
}

export function contextOf(f: Fixture): ExtensionContext {
  return f.session.extensionRunner.createContext();
}

export async function statusReport(f: Fixture): Promise<string> {
  await f.command("status");
  return f.report();
}

export async function statusLines(f: Fixture): Promise<string[]> {
  return (await statusReport(f)).split("\n");
}

export function compactEverythingButTheLastTurn(f: Fixture): void {
  f.settings.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 1 } });
}

export async function presentedNote(
  createFixture: CreateFixture,
  options: FixtureOptions = {},
): Promise<{ f: Fixture; revision: string }> {
  const f = await presenting(createFixture, options);
  await f.session.prompt("Remember the blue setting.");
  const revision = await commitNote(f, "Use the blue setting.", "Remember the blue setting.");
  await f.session.prompt("Continue the work.");
  return { f, revision };
}

export async function notePath(f: Fixture): Promise<string> {
  const store = await storeFor(f);
  return join(store.sessionDir, "current", "current-work.md");
}

export function actingRequests(f: Fixture): ActingRequest[] {
  return f.requests.filter((request) => !request.summary);
}

export function summaryRequests(f: Fixture): ActingRequest[] {
  return f.requests.filter((request) => request.summary);
}
