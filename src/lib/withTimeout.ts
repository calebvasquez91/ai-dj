/**
 * Rejects if `promise` hasn't settled within `ms`. The underlying work is not cancelled (a promise can't be) — this
 * only stops a caller waiting on something that may never finish, so a one-at-a-time queue can move on.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "Operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
