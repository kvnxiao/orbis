import type { SourceBoundary } from "../domain/intervals.ts";
import { sameRevision } from "../domain/proposal.ts";
import { decodeSpanReference } from "../domain/references.ts";
import { memoryComponentSchema, readPresentationEntry } from "./entries.ts";
import type { DamagedPresentation, MemoryComponent, PresentationEntry } from "./entries.ts";
import { estimatePresentationTokens } from "./render.ts";
import type {
  ComponentState,
  PresentationLog,
  PresentationPlan,
  PresentationView,
  PresentedComponent,
  PresentedCorrection,
  PresentedRecord,
} from "./types.ts";

const components: readonly MemoryComponent[] = memoryComponentSchema.anyOf.map(
  (literal) => literal.const,
);

type ResetEntry = Extract<PresentationEntry, { kind: "reset" }>;

interface LogState {
  current: Partial<Record<MemoryComponent, PresentedComponent>>;
  corrections: PresentedCorrection[];
  suppressed: Set<string>;
}

// A fork rebinds inherited references to its own session, so boundaries compare by entry, range,
// and order rather than by reference text.
function sameBoundary(left: SourceBoundary, right: SourceBoundary): boolean {
  const leftSpan = decodeSpanReference(left.reference);
  const rightSpan = decodeSpanReference(right.reference);
  return (
    left.order === right.order &&
    leftSpan !== undefined &&
    rightSpan !== undefined &&
    leftSpan.location.projectId === rightSpan.location.projectId &&
    leftSpan.location.entryId === rightSpan.location.entryId &&
    leftSpan.range?.start === rightSpan.range?.start &&
    leftSpan.range?.end === rightSpan.range?.end
  );
}

function withoutComponent(
  current: Partial<Record<MemoryComponent, PresentedComponent>>,
  removed: MemoryComponent,
): Partial<Record<MemoryComponent, PresentedComponent>> {
  const next: Partial<Record<MemoryComponent, PresentedComponent>> = {};
  for (const name of components) {
    const presented = current[name];
    if (name !== removed && presented !== undefined) {
      next[name] = presented;
    }
  }
  return next;
}

function applyReset(state: LogState, entry: ResetEntry): void {
  state.current = {};
  for (const component of entry.components) {
    const { id, bodyDigest, revision, sourceBoundary } = component;
    state.current[component.component] = {
      id,
      component: component.component,
      bodyDigest,
      bodyRevision: revision,
      revision,
      sourceBoundary,
    };
  }
  for (const id of entry.superseded) {
    state.suppressed.add(id);
  }
}

function applyRecord(state: LogState, entry: PresentationEntry, position: number): void {
  switch (entry.kind) {
    case "component": {
      const { id, component, bodyDigest, revision, sourceBoundary } = entry;
      state.current[component] = {
        id,
        component,
        bodyDigest,
        bodyRevision: revision,
        revision,
        sourceBoundary,
      };
      return;
    }
    case "boundary": {
      const presented = state.current[entry.component];
      if (presented?.id === entry.componentId && presented.bodyDigest === entry.bodyDigest) {
        state.current[entry.component] = {
          ...presented,
          revision: entry.revision,
          sourceBoundary: entry.sourceBoundary,
        };
      }
      return;
    }
    case "reset":
      applyReset(state, entry);
      return;
    case "correction":
      state.corrections.push({
        component: entry.component,
        revision: entry.affectedRevision,
        position,
      });
      state.current = withoutComponent(state.current, entry.component);
      return;
  }
}

/**
 * Fold validated presentation records into the presentation they establish.
 *
 * `branch` lists the records in the selected branch's effective projection, in branch order, each
 * with its entry id and confirmation; records that a context edit omitted or replaced are not in
 * it. `pending` lists records sent but not yet on the branch, in send order. Only records of
 * `scope.projectId`, written by a session in `scope.sessionIds` (the current memory session and its
 * fork ancestors), and anchored on an entry in `branchIds` are accepted, so a record planned on an
 * abandoned branch never counts. A reset replaces every component's presented body with its
 * baseline and suppresses its `superseded` identities, pending or confirmed. A correction removes
 * its component's presented body.
 */
export function reconstructLog(
  branch: readonly PresentedRecord[],
  pending: readonly PresentedRecord[],
  scope: {
    projectId: string;
    sessionIds: ReadonlySet<string>;
    branchIds: ReadonlySet<string>;
  },
  damaged: readonly DamagedPresentation[],
): PresentationLog {
  const records = [...branch, ...pending].filter(
    ({ entry }) =>
      entry.lineage.projectId === scope.projectId &&
      scope.sessionIds.has(entry.lineage.sessionId) &&
      scope.branchIds.has(entry.anchorId),
  );
  const state: LogState = { current: {}, corrections: [], suppressed: new Set() };
  for (const [position, { entry }] of records.entries()) {
    applyRecord(state, entry, position);
  }
  const accumulatedTokens = records
    .filter(({ entry }) => !state.suppressed.has(entry.id))
    .reduce((total, record) => total + record.tokens, 0);
  return { records, ...state, accumulatedTokens, damaged: [...damaged] };
}

function changeFor(
  state: ComponentState,
  presented: PresentedComponent | undefined,
  fields: Pick<PresentationEntry, "lineage" | "anchorId">,
  newId: () => string,
): PresentationEntry | undefined {
  const { component, revision, sourceBoundary, body, bodyDigest } = state;
  if (presented?.bodyDigest !== bodyDigest) {
    return {
      version: 1,
      kind: "component",
      id: newId(),
      ...fields,
      component,
      revision,
      sourceBoundary,
      body,
      bodyDigest,
      ...(presented === undefined ? {} : { supersedes: presented.id }),
    };
  }
  if (
    sameRevision(presented.revision, revision) &&
    sameBoundary(presented.sourceBoundary, sourceBoundary)
  ) {
    return undefined;
  }
  return {
    version: 1,
    kind: "boundary",
    id: newId(),
    ...fields,
    component,
    componentId: presented.id,
    bodyRevision: presented.bodyRevision,
    bodyDigest,
    revision,
    sourceBoundary,
  };
}

// The presented body is corrected when it is the invalid revision, or, while the view has no valid
// body for the component, when it is any older revision that would otherwise stay current. A
// correction removes the presented body, so a presented body is never already corrected.
function correctionsFor(
  view: PresentationView,
  log: PresentationLog,
  fields: Pick<PresentationEntry, "lineage" | "anchorId">,
  newId: () => string,
): PresentationEntry[] {
  const corrections: PresentationEntry[] = [];
  for (const invalid of view.invalidated) {
    const presented = log.current[invalid.component];
    if (
      presented === undefined ||
      (!sameRevision(presented.revision, invalid.revision) &&
        view.components[invalid.component] !== undefined)
    ) {
      continue;
    }
    corrections.push({
      version: 1,
      kind: "correction",
      id: newId(),
      lineage: fields.lineage,
      anchorId: fields.anchorId,
      component: invalid.component,
      affectedRevision: presented.revision,
      presented: { id: presented.id, bodyRevision: presented.bodyRevision },
      cause: invalid.cause,
    });
  }
  return corrections;
}

function resetFor(
  baseline: readonly ComponentState[],
  superseded: readonly string[],
  fields: Pick<PresentationEntry, "lineage" | "anchorId">,
  newId: () => string,
): ResetEntry {
  return {
    version: 1,
    kind: "reset",
    id: newId(),
    ...fields,
    components: baseline.map(({ component, revision, sourceBoundary, body, bodyDigest }) => ({
      id: newId(),
      component,
      revision,
      sourceBoundary,
      body,
      bodyDigest,
    })),
    superseded: [...superseded],
    reason: "budget",
    tokensBefore: 0,
    tokensAfter: 0,
  };
}

function planReset(
  view: PresentationView,
  log: PresentationLog,
  appended: { corrections: readonly PresentationEntry[]; tokens: number },
  budgetTokens: number,
  newId: () => string,
): PresentationPlan {
  const { corrections } = appended;
  const fields = { lineage: view.lineage, anchorId: view.anchorId };
  const superseded = [
    ...log.records.map(({ entry }) => entry.id).filter((id) => !log.suppressed.has(id)),
    ...corrections.map((entry) => entry.id),
  ];
  const tokensBefore = log.accumulatedTokens + appended.tokens;
  const full = components.flatMap((name) => {
    const state = view.components[name];
    return state === undefined ? [] : [state];
  });
  const noteOnly = full.filter((state) => state.component !== "index");
  let required = 0;
  for (const baseline of noteOnly.length === full.length ? [full] : [full, noteOnly]) {
    const record = resetFor(baseline, superseded, fields, newId);
    const tokensAfter = estimatePresentationTokens(record);
    if (tokensAfter <= budgetTokens) {
      return { kind: "reset", corrections, record: { ...record, tokensBefore, tokensAfter } };
    }
    required = tokensAfter;
  }
  return { kind: "over-budget", requiredTokens: required, budgetTokens };
}

/**
 * Choose the records that bring presentation to the view without moving existing records.
 *
 * Rules, in precedence order:
 *
 * - An invalidated component whose presented body is not yet corrected gets a correction record
 *   naming the presented revision: the invalid revision itself, or, while the view has no valid
 *   body for that component, an older presented revision. A component that was never presented
 *   needs none.
 * - A component whose body digest differs from its presented body gets a complete component record
 *   superseding that body; the other component is not repeated.
 * - A component with an unchanged body and a newer revision or source boundary gets a boundary
 *   record, never another full copy.
 * - When accumulated presentation plus these records would exceed `budgetTokens`, the plan is the
 *   corrections followed by one reset baseline of every valid component, superseding every
 *   unsuppressed record; its `tokensBefore` counts accumulated presentation plus the records that
 *   triggered it. When that baseline exceeds the budget, the index yields; when the note alone
 *   still exceeds it, the plan is `over-budget` and nothing is sent, so an unchanged baseline that
 *   cannot fit never resets repeatedly.
 *
 * `newId` supplies fresh presentation identities. Makes no model call and reads nothing else.
 */
export function planPresentation(
  view: PresentationView,
  log: PresentationLog,
  budgetTokens: number,
  newId: () => string,
): PresentationPlan {
  const fields = { lineage: view.lineage, anchorId: view.anchorId };
  const corrections = correctionsFor(view, log, fields, newId);
  const changes = components.flatMap((name) => {
    const state = view.components[name];
    const change =
      state === undefined ? undefined : changeFor(state, log.current[name], fields, newId);
    return change === undefined ? [] : [change];
  });
  const records = [...corrections, ...changes];
  const appended = records.reduce((total, entry) => total + estimatePresentationTokens(entry), 0);
  if (log.accumulatedTokens + appended <= budgetTokens) {
    return records.length === 0 ? { kind: "current" } : { kind: "append", records };
  }
  const plan = planReset(view, log, { corrections, tokens: appended }, budgetTokens, newId);
  if (
    plan.kind === "reset" &&
    corrections.length === 0 &&
    log.accumulatedTokens <= budgetTokens &&
    presentsBaseline(log, plan.record)
  ) {
    return { kind: "current" };
  }
  return plan;
}

// Reports whether the presented components already equal a reset baseline, as when an earlier reset
// already yielded the index; another reset would only repeat that baseline.
function presentsBaseline(log: PresentationLog, record: ResetEntry): boolean {
  const presented = components.filter((name) => log.current[name] !== undefined);
  return (
    presented.length === record.components.length &&
    record.components.every((baseline) => {
      const current = log.current[baseline.component];
      return (
        current !== undefined &&
        current.bodyDigest === baseline.bodyDigest &&
        sameRevision(current.revision, baseline.revision) &&
        sameBoundary(current.sourceBoundary, baseline.sourceBoundary)
      );
    })
  );
}

/**
 * Report whether a package-owned presentation message must stay out of acting context.
 *
 * `details` is the message's `details`. It stays out when it fails `readPresentationEntry`, when
 * the log did not accept it (another project or session lineage, an off-branch anchor, or an
 * omitted or replaced projection), when a reset superseded it, or when it is a component or
 * boundary record that precedes a correction of its component in the log, so no older revision
 * becomes current again; a record after that correction stays. Damaged records stay preserved in
 * the session file; persisted records and native compaction inputs are unaffected. A reset record
 * stays, and the correction text marks its corrected component.
 */
export function suppressedInActingContext(details: unknown, log: PresentationLog): boolean {
  const read = readPresentationEntry(details);
  if (read.kind === "damaged") {
    return true;
  }
  const { entry } = read;
  const position = log.records.findIndex((record) => record.entry.id === entry.id);
  if (log.suppressed.has(entry.id) || position === -1) {
    return true;
  }
  if (entry.kind !== "component" && entry.kind !== "boundary") {
    return false;
  }
  return log.corrections.some(
    (correction) => correction.component === entry.component && correction.position > position,
  );
}
