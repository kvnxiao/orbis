import { expect, test } from "vitest";

import { packedProbe } from "./packed-probe.mts";

test.each(["base", "before", "after"] as const)(
  "source exports complete planning with presenter order %s",
  async (order) => {
    await expect(packedProbe(order)).resolves.toBeUndefined();
  },
);
