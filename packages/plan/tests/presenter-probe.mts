import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPlanPresenter } from "@orbis/plan/presentation";

export default function presenterProbe(pi: ExtensionAPI): void {
  registerPlanPresenter(pi, {
    version: 1,
    id: "scripted-probe",
    label: "Scripted fixture (submits and approves)",
    async present(request) {
      if (request.snapshot.kind === "round") {
        for (const question of request.snapshot.round.questions) {
          request.updateDraft({
            identity: request.identity,
            action: {
              type: "answer",
              questionId: question.id,
              answer: { custom: "Fixture decision" },
            },
          });
        }
      }
      await Promise.resolve();
      return {
        identity: request.identity,
        action: { type: request.snapshot.kind === "round" ? "submit" : "approve" },
      };
    },
  });
}
