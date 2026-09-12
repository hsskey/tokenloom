/**
 * Runs up to `limit` workers while returning results in input order.
 * Non-positive limits still use one worker so work cannot succeed without running.
 * The first worker rejection rejects the pool; already running workers are not cancelled.
 * An `undefined` item marks the end of the shared work queue.
 */
export async function pool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}
