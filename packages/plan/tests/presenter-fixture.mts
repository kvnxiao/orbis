import { vi } from "vitest";

import { registerPlanPresenter } from "../src/presentation.ts";
import type { PlanPresenter } from "../src/presentation.ts";
import * as terminal from "../src/terminal.ts";
import type { RuntimeFixture } from "./runtime-fixture.mts";

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
  const select = async () => {
    f.runtime.chooseInterface("fixture");
    await Promise.resolve();
  };
  const round = vi.spyOn(terminal, "terminalRound").mockImplementationOnce(select);
  const review = vi.spyOn(terminal, "terminalReview").mockImplementationOnce(select);
  return Object.assign(
    () => {
      unregister();
      round.mockRestore();
      review.mockRestore();
    },
    { unregister },
  );
}
