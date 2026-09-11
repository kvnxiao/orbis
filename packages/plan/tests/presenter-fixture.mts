import { vi } from "vitest";

import { registerPlanPresenter } from "../src/presentation.ts";
import type { PlanPresenter } from "../src/presentation.ts";
import * as terminal from "../src/terminal.ts";
import type { RuntimeFixture } from "./runtime-fixture.mts";

async function requestPresenterSelection(
  _ctx: unknown,
  _read: unknown,
  _dispatch: unknown,
  _signal: unknown,
  switchView?: () => void,
) {
  switchView?.();
  await Promise.resolve();
}

export function selectPresenter(
  f: RuntimeFixture,
  present: PlanPresenter["present"],
): (() => void) & { unregister: () => void } {
  const unregister = registerPlanPresenter(f.api, {
    version: 1,
    id: "fixture",
    label: "Fixture",
    present,
  });
  const choice = vi.spyOn(f.ctx.ui, "select").mockResolvedValueOnce("fixture");

  const round = vi
    .spyOn(terminal, "terminalRound")
    .mockImplementationOnce(requestPresenterSelection);
  const review = vi
    .spyOn(terminal, "terminalReview")
    .mockImplementationOnce(requestPresenterSelection);
  return Object.assign(
    () => {
      unregister();
      choice.mockRestore();
      round.mockRestore();
      review.mockRestore();
    },
    { unregister },
  );
}
