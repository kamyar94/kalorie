/**
 * Runs `run` over the items with at most `limit` at a time (reading 30 phone photos at once would
 * use too much memory) and settles every one: a failure does not stop the others. Results keep the
 * items' order; onSettled hears how many are done after each one.
 */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
  onSettled?: (done: number) => void,
): Promise<PromiseSettledResult<R>[]> => {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await run(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
      done += 1;
      onSettled?.(done);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
};
