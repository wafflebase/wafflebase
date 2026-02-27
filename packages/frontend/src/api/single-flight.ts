/**
 * Returns a function that coalesces concurrent calls into a single in-flight
 * promise. Once settled, the next call starts a new invocation.
 */
export function createSingleFlightRunner<T>(
  runner: () => Promise<T>,
): () => Promise<T> {
  let pending: Promise<T> | null = null;

  return async () => {
    if (!pending) {
      pending = (async () => {
        try {
          return await runner();
        } finally {
          pending = null;
        }
      })();
    }

    return pending;
  };
}
