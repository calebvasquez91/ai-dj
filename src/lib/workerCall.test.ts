import { describe, expect, it, vi } from "vitest";
import { callWorker, type WorkerLike } from "./workerCall";

/** A stand-in worker: records what was posted and lets the test deliver replies in any order. */
function fakeWorker() {
  const target = new EventTarget();
  const posted: { id: number; [k: string]: unknown }[] = [];
  const worker: WorkerLike = {
    postMessage: (message) => void posted.push(message as { id: number }),
    addEventListener: (type, listener) => target.addEventListener(type, listener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener),
  };
  const reply = (data: unknown) => target.dispatchEvent(Object.assign(new Event("message"), { data }));
  const fail = () => target.dispatchEvent(new Event("error"));
  return { worker, posted, reply, fail };
}

describe("callWorker", () => {
  it("delivers each reply only to the call that asked, whatever order replies arrive in", async () => {
    const { worker, posted, reply } = fakeWorker();
    const a = callWorker<string>(worker, { track: "a" }, [], 1000);
    const b = callWorker<string>(worker, { track: "b" }, [], 1000);
    const c = callWorker<string>(worker, { track: "c" }, [], 1000);
    expect(new Set(posted.map((p) => p.id)).size).toBe(3);
    const idOf = (track: string) => posted.find((p) => p.track === track)!.id;
    reply({ id: idOf("c"), result: "result-c" });
    reply({ id: idOf("a"), result: "result-a" });
    reply({ id: idOf("b"), result: "result-b" });
    expect(await Promise.all([a, b, c])).toEqual(["result-a", "result-b", "result-c"]);
  });

  it("ignores a reply that carries someone else's id and keeps waiting", async () => {
    vi.useFakeTimers();
    const { worker, reply } = fakeWorker();
    const p = callWorker<string>(worker, {}, [], 500);
    reply({ id: -1, result: "stray" });
    vi.advanceTimersByTime(600);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });

  it("resolves null on timeout and on a worker error, so callers can fall back", async () => {
    vi.useFakeTimers();
    const slow = fakeWorker();
    const timedOut = callWorker<string>(slow.worker, {}, [], 100);
    vi.advanceTimersByTime(101);
    expect(await timedOut).toBeNull();
    vi.useRealTimers();

    const broken = fakeWorker();
    const errored = callWorker<string>(broken.worker, {}, [], 1000);
    broken.fail();
    expect(await errored).toBeNull();
  });
});
