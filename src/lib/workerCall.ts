/**
 * One request/response call to a Web Worker that may have several calls in flight. Every request carries an id and
 * the worker echoes it back with `{ id, result }`, so a reply is only ever delivered to the call that asked for it
 * (a bare "first message wins" listener hands the same result to every pending call). Resolves null on timeout or a
 * worker error, so callers can fall back, matching how the analysis worker was already treated.
 */

export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: "message" | "error", listener: EventListener): void;
  removeEventListener(type: "message" | "error", listener: EventListener): void;
}

let nextRequestId = 1;

export function callWorker<T>(
  worker: WorkerLike,
  request: Record<string, unknown>,
  transfer: Transferable[],
  timeoutMs: number
): Promise<T | null> {
  const id = nextRequestId++;
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeoutId);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    }
    function handleMessage(event: Event) {
      const data = (event as MessageEvent<{ id?: number; result?: T }>).data;
      if (data?.id !== id) return; // someone else's reply
      cleanup();
      resolve(data.result ?? null);
    }
    function handleError() {
      cleanup();
      resolve(null);
    }
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({ id, ...request }, transfer);
  });
}
