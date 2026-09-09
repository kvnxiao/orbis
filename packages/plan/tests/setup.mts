import { Socket } from "node:net";

import { afterAll } from "vitest";

const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const message = "External network connections are disabled in Vitest; use local fixtures.";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  if (!loopback.has(url.hostname)) {
    throw new Error(message);
  }
  return await originalFetch(input, { ...init, redirect: "error" });
};

const connect = Reflect.get(Socket.prototype, "connect");
Socket.prototype.connect = function (this: Socket, ...args: unknown[]): Socket {
  const values: unknown[] = Array.isArray(args[0]) ? args[0] : args;
  const first = values[0];
  let host: unknown = "localhost";
  if (typeof first === "object" && first !== null) {
    if ("host" in first) {
      host = first.host;
    } else if ("hostname" in first) {
      host = first.hostname;
    }
  } else if (typeof first === "number" && typeof values[1] === "string") {
    host = values[1];
  }
  if (host !== undefined && (typeof host !== "string" || !loopback.has(host))) {
    throw new Error(message);
  }
  const result: unknown = Reflect.apply(connect, this, args);
  if (!(result instanceof Socket)) {
    throw new Error("Socket.connect did not return its socket.");
  }
  return result;
};

afterAll(() => {
  Socket.prototype.connect = connect;
  globalThis.fetch = originalFetch;
});
