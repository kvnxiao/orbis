import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  buildSessionProjection,
  DEFAULT_COMPACTION_SETTINGS,
  estimateTokens,
} from "@earendil-works/pi-coding-agent";
import type { ContextWithSystemEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { estimateTextTokens } from "../domain/tokens.ts";
import { presentationEntryOf } from "./presentation-log.ts";

// Pi 0.99.1 does not export its `VIRTUAL_MODEL_API` constant; this is its value.
const virtualModelApi = "pi-virtual";

/**
 * Name the limits one acting request is checked against.
 *
 * - `known`: `source` is `physical` when `ctx.model` is the model Pi dispatches, `virtual-response`
 *   for the model of a virtual selection's latest successful response in effective context, or
 *   `virtual-declared` for a virtual selection's declared limits when it has no such response.
 *   Virtual limits are estimates of the next dispatch.
 * - `unknown`: a virtual selection whose limits Pi does not report; nothing is checked.
 * - `none`: no model is active, and nothing is checked.
 */
export type RequestLimits =
  | {
      kind: "known";
      source: "physical" | "virtual-response" | "virtual-declared";
      modelId: string;
      contextWindow: number;
      maxTokens: number;
    }
  | { kind: "unknown"; modelId: string; reason: string }
  | { kind: "none" };

type KnownLimits = Extract<RequestLimits, { kind: "known" }>;

// The model of the latest successful response in Pi's effective projection whose raw entry follows
// the selection; a compacted, omitted, or replaced response does not count.
function routedResponseModel(
  ctx: Pick<ExtensionContext, "modelRegistry" | "sessionManager">,
): Model<Api> | undefined {
  const branch = ctx.sessionManager.getBranch();
  const selectedAt = branch.findLastIndex((entry) => entry.type === "model_change");
  const positions = new Map(branch.map((entry, index) => [entry.id, index]));
  const response = buildSessionProjection([...branch]).entries.findLast(
    ({ sourceEntry, messages }) => {
      const [message] = messages;
      return (
        sourceEntry.type === "message" &&
        (positions.get(sourceEntry.id) ?? -1) > selectedAt &&
        message === sourceEntry.message &&
        message.role === "assistant" &&
        message.api !== virtualModelApi &&
        message.stopReason !== "error" &&
        message.stopReason !== "aborted"
      );
    },
  )?.sourceEntry;
  return response?.type === "message" && response.message.role === "assistant"
    ? ctx.modelRegistry.find(response.message.provider, response.message.model)
    : undefined;
}

/**
 * Return the limits of the next acting request from the context the request hooks receive.
 *
 * A virtual selection uses the limits Pi reports for it: the model of the latest successful
 * assistant response in Pi's effective projection whose raw entry follows the branch's latest
 * `model_change` entry, which recorded the virtual selection, resolved through `ctx.modelRegistry`;
 * or the virtual entry's declared limits when that selection has no such response or its model is
 * not registered. Failed and aborted responses can still name the virtual model, so they are
 * skipped. A response that compaction summarized, or that a context edit omits or replaces, is
 * skipped too, so the next earlier effective response supplies the limits.
 */
export function requestLimits(
  ctx: Pick<ExtensionContext, "model" | "modelRegistry" | "sessionManager">,
): RequestLimits {
  const model = ctx.model;
  if (model === undefined) {
    return { kind: "none" };
  }
  const modelId = `${model.provider}/${model.id}`;
  if (model.api !== virtualModelApi) {
    const { contextWindow, maxTokens } = model;
    return { kind: "known", source: "physical", modelId, contextWindow, maxTokens };
  }
  const physical = routedResponseModel(ctx);
  if (physical !== undefined) {
    const { contextWindow, maxTokens } = physical;
    return { kind: "known", source: "virtual-response", modelId, contextWindow, maxTokens };
  }
  if (model.contextWindow > 0 && model.maxTokens > 0) {
    const { contextWindow, maxTokens } = model;
    return { kind: "known", source: "virtual-declared", modelId, contextWindow, maxTokens };
  }
  return { kind: "unknown", modelId, reason: "the virtual model declares no limits" };
}

/**
 * Cap the generation headroom a request reserves: the package's own finite reserve, equal to Pi
 * 0.99.1's default compaction `reserveTokens`; it does not follow configured compaction settings.
 * Pi clamps a request's output to the context window minus its estimated input, so reserving a
 * model's full `maxTokens` would overstate what the next request needs.
 */
export const generationHeadroomTokens: number = DEFAULT_COMPACTION_SETTINGS.reserveTokens;

/**
 * Estimate one request's token footprint by part.
 *
 * `systemTokens` uses the larger of the transcript's current system prompt and
 * `ctx.getSystemPrompt()`; `toolTokens` covers the current tool declarations; `mandatoryTokens` is
 * package-owned presentation that carries the current-work note, only the note portion of a reset
 * that also carries the index; `optionalTokens` is optional package-owned memory, such as an index
 * record or that reset's index portion; `transcriptTokens` is every other message. `reserveTokens`
 * is the generation headroom: the model's maximum output, capped at `generationHeadroomTokens`.
 */
export interface RequestFootprint {
  systemTokens: number;
  toolTokens: number;
  transcriptTokens: number;
  mandatoryTokens: number;
  optionalTokens: number;
  reserveTokens: number;
}

/**
 * Record a capacity stop for status, which attributes Pi's following aborted assistant entry to it
 * rather than to user cancellation.
 *
 * `cause` is `context-window` when the request with the complete note exceeds the model's context
 * window, or `presentation-budget` when the complete presentation baseline exceeds
 * `presentationTokens`. `anchorId` is the branch leaf when the request stopped. `requiredTokens`
 * includes `headroomTokens` of generation headroom, which is 0 for a presentation-budget stop.
 * `estimate` is true for a virtual selection's limits.
 */
export interface CapacityStop {
  cause: "context-window" | "presentation-budget";
  modelId: string | undefined;
  anchorId: string | undefined;
  requiredTokens: number;
  availableTokens: number;
  headroomTokens: number;
  estimate: boolean;
}

/**
 * Report whether a request fits: with optional memory; only after optional memory yields, which
 * `context_with_system` applies by returning the transcript without those messages; or not at all,
 * in which case the request must stop before provider dispatch.
 */
export type CapacityDecision =
  | { kind: "fits" }
  | { kind: "without-optional" }
  | { kind: "stop"; stop: CapacityStop };

/**
 * Measure the footprint of the request that `context_with_system` assembled.
 *
 * Reads the system prompt and tool declarations from the event's transcript and never changes them.
 * `presented` names the presentation identities, from message `details`, that count as mandatory or
 * optional. `reduced` maps a presentation identity to the mandatory rendering of that message: its
 * tokens count as mandatory and the rest of the message's tokens as optional.
 */
export function requestFootprint(
  event: ContextWithSystemEvent,
  ctx: Pick<ExtensionContext, "getSystemPrompt">,
  presented: {
    mandatory: ReadonlySet<string>;
    optional: ReadonlySet<string>;
    reduced: ReadonlyMap<string, ContextWithSystemEvent["messages"][number]>;
  },
  limits: KnownLimits,
): RequestFootprint {
  const footprint: RequestFootprint = {
    systemTokens: Math.max(
      estimateTextTokens(getCurrentSystemPrompt(event.messages)),
      estimateTextTokens(ctx.getSystemPrompt()),
    ),
    toolTokens: estimateTextTokens(
      JSON.stringify(
        getCurrentTools(event.messages).map(({ name, description, parameters }) => ({
          name,
          description,
          parameters,
        })),
      ),
    ),
    transcriptTokens: 0,
    mandatoryTokens: 0,
    optionalTokens: 0,
    reserveTokens: Math.min(limits.maxTokens, generationHeadroomTokens),
  };
  for (const message of event.messages) {
    if (message.role === "system") {
      continue;
    }
    const tokens = estimateTokens(message);
    const id = presentationEntryOf(message)?.id;
    const reduced = id === undefined ? undefined : presented.reduced.get(id);
    if (reduced !== undefined) {
      const kept = estimateTokens(reduced);
      footprint.mandatoryTokens += kept;
      footprint.optionalTokens += Math.max(tokens - kept, 0);
    } else if (id !== undefined && presented.mandatory.has(id)) {
      footprint.mandatoryTokens += tokens;
    } else if (id !== undefined && presented.optional.has(id)) {
      footprint.optionalTokens += tokens;
    } else {
      footprint.transcriptTokens += tokens;
    }
  }
  return footprint;
}

/**
 * Decide whether a footprint fits a context window, removing optional memory before the mandatory
 * note is evaluated.
 *
 * With a presented note, the request stops whenever the request with the complete note and no
 * optional memory exceeds the window, including when the conversation alone already does: the
 * complete note must fit or no provider request is dispatched. A request without a presented note
 * is never stopped.
 */
export function evaluateCapacity(
  footprint: RequestFootprint,
  limits: KnownLimits,
  anchorId: string | undefined,
): CapacityDecision {
  const required =
    footprint.systemTokens +
    footprint.toolTokens +
    footprint.transcriptTokens +
    footprint.reserveTokens +
    footprint.mandatoryTokens;
  if (required + footprint.optionalTokens <= limits.contextWindow) {
    return { kind: "fits" };
  }
  if (required <= limits.contextWindow) {
    return { kind: "without-optional" };
  }
  if (footprint.mandatoryTokens === 0) {
    return { kind: "fits" };
  }
  return {
    kind: "stop",
    stop: {
      cause: "context-window",
      modelId: limits.modelId,
      anchorId,
      requiredTokens: required,
      availableTokens: limits.contextWindow,
      headroomTokens: footprint.reserveTokens,
      estimate: limits.source !== "physical",
    },
  };
}

/**
 * Stop the current acting request before provider dispatch.
 *
 * When `ctx.signal` is already aborted, keeps that cancellation and records nothing. Otherwise
 * calls `record` with the stop, then `ctx.abort()`, and returns without waiting for idle, retrying,
 * or compacting.
 */
export function stopForCapacity(
  ctx: Pick<ExtensionContext, "signal" | "abort">,
  stop: CapacityStop,
  record: (stop: CapacityStop) => void,
): "stopped" | "already-cancelled" {
  if (ctx.signal?.aborted === true) {
    return "already-cancelled";
  }
  record(stop);
  ctx.abort();
  return "stopped";
}
