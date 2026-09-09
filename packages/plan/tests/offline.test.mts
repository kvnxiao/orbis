import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Socket } from "node:net";

import { expect, test } from "vitest";

test("blocks external TCP connections before resolving or connecting", () => {
  const socket = new Socket();
  try {
    expect(() => socket.connect(443, "example.invalid")).toThrow(
      "External network connections are disabled in Vitest",
    );
  } finally {
    socket.destroy();
  }
});

test.each([
  ["http", httpRequest],
  ["https", httpsRequest],
] as const)("blocks external %s client requests", async (protocol, request) => {
  const attempt = new Promise<void>((_resolve, reject) => {
    const outgoing = request(`${protocol}://example.invalid/`);
    outgoing.once("error", reject);
    outgoing.end();
  });
  await expect(attempt).rejects.toThrow("External network connections are disabled in Vitest");
});

test.each(["http", "https"])(
  "blocks external %s fetch requests before provider traffic can leave the process",
  async (protocol) => {
    await expect(fetch(`${protocol}://example.invalid/`)).rejects.toThrow(
      "External network connections are disabled in Vitest",
    );
  },
);
