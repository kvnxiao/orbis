import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, JsonObject } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Register scripted modal scenarios for an isolated interactive host. */
export default function terminalProbe(pi: ExtensionAPI): void {
  let mode: "round" | "review" = "round";
  for (const name of ["round", "review"] as const) {
    pi.registerCommand("probe-" + name, {
      description: "Run the package tools with the scripted " + name + " fixture",
      async handler(_args, ctx) {
        await ctx.waitForIdle();
        mode = name;
        pi.sendUserMessage("Run the scripted planning fixture.");
      },
    });
  }
  pi.registerProvider("plan-probe", {
    api: "plan-probe-api",
    apiKey: "fixture",
    baseUrl: "http://127.0.0.1",
    models: [
      {
        id: "probe",
        name: "Planning fixture",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 2000,
      },
    ],
    streamSimple(_model, context, options) {
      const stream = createAssistantMessageEventStream();
      const previous = context.messages.at(-1);
      let details: unknown;
      if (previous?.role === "toolResult") {
        const content = previous.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        try {
          details = JSON.parse(content);
        } catch {
          details = undefined;
        }
      }
      let call: { name: string; arguments: JsonObject } | undefined;
      if (previous?.role === "user") {
        call = { name: "plan_open", arguments: { objective: "Scripted terminal verification" } };
      } else if (
        typeof details === "object" &&
        details !== null &&
        "plan" in details &&
        typeof details.plan === "object" &&
        details.plan !== null &&
        "planId" in details.plan &&
        typeof details.plan.planId === "string"
      ) {
        call =
          mode === "round"
            ? {
                name: "plan_round",
                arguments: {
                  planId: details.plan.planId,
                  roundId: "probe",
                  expectedRevision: 0,
                  questions: ["storage", "scope"].map((id) => ({
                    id,
                    prerequisites: [],
                    prompt: "Choose " + id,
                    context: "**Fixture:** local and remote choices.",
                    options: [
                      { id: "local", label: "Local", explanation: "Works offline." },
                      { id: "remote", label: "Remote", explanation: "Shares access." },
                    ],
                    recommendation: { optionId: "local", reason: "Offline fixture." },
                  })),
                },
              }
            : {
                name: "plan_review",
                arguments: {
                  planId: details.plan.planId,
                  expectedRevision: 0,
                  markdown:
                    "# Fixture plan\n\n## Objective\nVerify review.\n\n## Approach\nPreserve Markdown.\n\n## Verification\nInspect approval and saved bytes.\n",
                },
              };
      }
      const message: AssistantMessage = {
        role: "assistant",
        content:
          call === undefined
            ? [{ type: "text", text: "Fixture interaction finished." }]
            : [
                {
                  type: "toolCall",
                  id: "probe-" + String(context.messages.length),
                  name: call.name,
                  arguments: call.arguments,
                },
              ],
        api: "plan-probe-api",
        provider: "plan-probe",
        model: "probe",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: call === undefined ? "stop" : "toolUse",
        timestamp: Date.now(),
      };
      if (options?.signal?.aborted === true) {
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...message, content: [], stopReason: "aborted" },
        });
      } else {
        stream.push({ type: "done", reason: call === undefined ? "stop" : "toolUse", message });
      }
      return stream;
    },
  });
}
