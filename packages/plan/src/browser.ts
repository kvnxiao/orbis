import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { Marked, Renderer } from "marked";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { ReviewAction, RoundAction, RoundState } from "./state.ts";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
const renderer = new Renderer();
renderer.html = ({ text }) => escapeHtml(text);
renderer.image = ({ text }) => escapeHtml(text);
renderer.link = function ({ href, tokens }) {
  const text = this.parser.parseInline(tokens);
  try {
    const url = new URL(href);
    if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
      return text;
    }
    return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  } catch {
    return text;
  }
};
const markdown = new Marked({ renderer, async: false });
export function renderMarkdown(content: string): string {
  return markdown.parse(content, { async: false });
}

const actionSchema = Type.Union([
  Type.Object({ type: Type.Literal("approve") }, { additionalProperties: false }),
  Type.Object(
    { type: Type.Literal("feedback"), text: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("edit-feedback"), text: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("focus"), questionId: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("edit"), questionId: Type.String(), unfinished: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("answer"),
      questionId: Type.String(),
      answer: Type.Union([
        Type.Object({ optionId: Type.String() }, { additionalProperties: false }),
        Type.Object({ custom: Type.String() }, { additionalProperties: false }),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("clarify"),
      questionId: Type.String(),
      request: Type.String(),
      id: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal("submit") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("cancel") }, { additionalProperties: false }),
]);
const requestSchema = Type.Object(
  {
    version: Type.Integer({ minimum: 0 }),
    roundId: Type.String(),
    revision: Type.Integer({ minimum: 1 }),
    action: actionSchema,
  },
  { additionalProperties: false },
);

export interface BrowserSnapshot {
  state: RoundState | undefined;
  version: number;
  saving: string;
}

function button(label: string, action: string, data = "") {
  return `<button type="button" data-action="${action}" ${data}>${escapeHtml(label)}</button>`;
}
export function renderBrowser(snapshot: BrowserSnapshot, review = false): string {
  const state = snapshot.state;
  const plan = state?.reviews?.at(-1);
  if (
    plan !== undefined &&
    state !== undefined &&
    ["review", "saving", "accepted"].includes(state.phase)
  ) {
    return `<header><p>Planning · ${escapeHtml(state.phase)} · revision ${String(plan.revision)}</p><p>${escapeHtml(snapshot.saving)}</p></header><article class="plan"><h1>Review plan</h1><section class="prose">${renderMarkdown(plan.markdown)}</section>${state.phase === "review" ? `<label for="feedback">Request changes</label><textarea id="feedback" rows="4">${escapeHtml(plan.feedbackDraft)}</textarea>${button("Send requested changes", "feedback")}${button("Approve this revision", "approve")}${button("Cancel planning", "cancel")}` : `<p>${state.phase === "accepted" ? "Approved and saved. Planning is finished." : "Saving this revision. Approval is not complete until the file and session record are saved."}</p>`}</article>`;
  }
  const round = state?.round;
  if (round === undefined || state === undefined) {
    return "<h1>Planning</h1><p>Start or resume a plan from Pi with /plan.</p>";
  }
  const question = round.questions.find((item) => item.id === round.focus);
  if (question === undefined) {
    return "<p>Question is unavailable. Reopen the current round from Pi.</p>";
  }
  const draft = round.drafts[question.id];
  const nav = round.questions
    .map((item) =>
      button(
        `${item.prompt} — ${round.drafts[item.id]?.answer === undefined ? "unanswered" : round.drafts[item.id]?.revision !== item.revision ? "reconfirm" : "draft"}`,
        "focus",
        `data-id="${escapeHtml(item.id)}" aria-current="${item.id === question.id ? "step" : "false"}"`,
      ),
    )
    .join("");
  const content = review
    ? `<h1>Review draft answers</h1>${round.questions.map((item) => `<section><h2>${escapeHtml(item.prompt)}</h2><p>${escapeHtml(JSON.stringify(round.drafts[item.id]?.answer ?? "Unanswered"))}</p>${round.drafts[item.id]?.revision !== item.revision ? "<p>Reconfirmation required</p>" : ""}</section>`).join("")}${button("Submit whole round", "submit")}`
    : `<h1>${escapeHtml(question.prompt)}</h1><section class="prose">${renderMarkdown(question.context)}</section>
    ${question.options.map((option) => `<section class="option">${button(option.label, "answer", `data-id="${escapeHtml(option.id)}" aria-pressed="${String(draft?.answer?.optionId === option.id)}"`)}<div class="prose">${renderMarkdown(option.explanation)}</div></section>`).join("")}
    ${question.recommendation === undefined ? "" : `<aside><strong>Recommendation</strong><div class="prose">${renderMarkdown(question.recommendation.reason)}</div>${button(`Accept ${question.options.find((item) => item.id === question.recommendation?.optionId)?.label ?? "recommendation"}`, "answer", `data-id="${escapeHtml(question.recommendation.optionId)}"`)}</aside>`}
    ${draft !== undefined && draft.revision !== question.revision ? "<p role=alert>The question changed. Reconfirm your answer before submitting.</p>" : ""}
    <label for="custom">Custom answer</label><textarea id="custom" rows="4">${escapeHtml(draft?.unfinished ?? "")}</textarea>${button("Use custom answer", "custom")}
    <p>Draft answer: ${escapeHtml(draft?.answer === undefined ? "Unanswered" : (draft.answer.custom ?? question.options.find((item) => item.id === draft.answer?.optionId)?.label ?? "Reconfirmation required"))}</p>
    ${round.clarifications
      .filter((item) => item.questionId === question.id)
      .map(
        (item) =>
          `<section class="prose"><h2>Clarification</h2>${renderMarkdown(item.request)}${renderMarkdown(item.response ?? "Awaiting the main Pi agent's response.")}</section>`,
      )
      .join("")}
    <label for="clarification">Ask the main Pi agent</label><textarea id="clarification" rows="3"></textarea>${button("Ask for clarification", "clarify")}`;
  return `<header><p>Planning · ${escapeHtml(state.phase)} · revision ${String(round.revision)}</p><p>${escapeHtml(snapshot.saving)}</p></header><nav aria-label="Questions">${nav}</nav><article>${content}</article><footer>${button(review ? "Back to questions" : "Review drafts", "review")}${button("Cancel planning", "cancel")}<p>Drafts remain unsubmitted until you submit the whole round. To switch interfaces, select Use terminal in Pi.</p></footer>`;
}

export class PlanBrowser {
  private server: Server | undefined;
  private ready: Promise<string> | undefined;
  private closed = false;
  private rejectStartup: ((error: Error) => void) | undefined;
  private readonly credential = randomBytes(32).toString("hex");
  private origin = "";
  private readonly read: () => BrowserSnapshot;
  private readonly mutate: (
    version: number,
    roundId: string,
    revision: number,
    action: RoundAction | ReviewAction,
  ) => void;

  constructor(
    read: () => BrowserSnapshot,
    mutate: (
      version: number,
      roundId: string,
      revision: number,
      action: RoundAction | ReviewAction,
    ) => void,
  ) {
    this.read = read;
    this.mutate = mutate;
  }

  async start(): Promise<string> {
    if (this.closed) {
      throw new Error("Browser server closed. Reopen it from Pi.");
    }
    if (this.ready !== undefined) {
      return await this.ready;
    }
    const server = createServer((request, response) => {
      this.respond(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500, { "Content-Type": "application/json" });
        }
        response.end(
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        );
      });
    });
    this.server = server;
    this.ready = new Promise<string>((resolve, reject) => {
      this.rejectStartup = reject;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.rejectStartup = undefined;
        if (this.closed) {
          server.close();
          reject(new Error("Browser server closed during startup."));
          return;
        }
        const address = server.address();
        if (address === null || typeof address === "string") {
          server.close();
          reject(
            new Error("Browser server has no loopback address. Switch to terminal with /plan-ui."),
          );
          return;
        }
        this.origin = `http://127.0.0.1:${String(address.port)}`;
        resolve(`${this.origin}/#${this.credential}`);
      });
    });
    return await this.ready;
  }

  close(): void {
    this.closed = true;
    this.rejectStartup?.(new Error("Browser server closed during startup."));
    this.rejectStartup = undefined;
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = undefined;
  }

  private async respond(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    if (
      request.headers.host !== new URL(this.origin).host ||
      (request.headers.origin !== undefined && request.headers.origin !== this.origin)
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", this.origin);
    if (request.method === "GET" && ["/", "/client.js", "/style.css"].includes(url.pathname)) {
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      response.setHeader(
        "Content-Type",
        file.endsWith("html")
          ? "text/html; charset=utf-8"
          : file.endsWith("js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8",
      );
      response.end(await readFile(new URL(`./browser/${file}`, import.meta.url)));
      return;
    }
    const supplied = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (
      supplied.length !== this.credential.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(this.credential))
    ) {
      response.writeHead(401);
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && url.pathname === "/action") {
      if (request.headers["content-type"] !== "application/json") {
        response.writeHead(415);
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) {
          throw new Error("Expected HTTP body bytes.");
        }
        bytes += chunk.length;
        if (bytes > 1048576) {
          response.writeHead(413);
          response.end();
          return;
        }
        chunks.push(chunk);
      }
      try {
        const input: unknown = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
        if (!Value.Check(requestSchema, input)) {
          throw new Error("Invalid planning action. Reload and retry.");
        }
        this.mutate(input.version, input.roundId, input.revision, input.action);
      } catch (error) {
        response.writeHead(409);
        response.end(
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        );
        return;
      }
    } else if (request.method !== "GET" || url.pathname !== "/state") {
      response.writeHead(404);
      response.end();
      return;
    }
    const snapshot = this.read();
    const reviewing =
      snapshot.state !== undefined &&
      ["review", "saving", "accepted"].includes(snapshot.state.phase);
    response.end(
      JSON.stringify({
        html: renderBrowser(snapshot, url.searchParams.get("review") === "1"),
        version: snapshot.version,
        roundId: reviewing ? "review" : snapshot.state?.round?.id,
        revision: reviewing
          ? snapshot.state?.reviews?.at(-1)?.revision
          : snapshot.state?.round?.revision,
        focus: snapshot.state?.round?.focus,
      }),
    );
  }
}
