import { describe, expect, it } from "vitest";
import { pool } from "../src/pool";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("pool", () => {
  it("returns results in input order when workers finish in reverse order", async () => {
    const delays: Record<string, number> = { a: 30, b: 15, c: 0 };
    const results = await pool(["a", "b", "c"], 3, async (item) => {
      await sleep(delays[item] as number);
      return item.toUpperCase();
    });
    expect(results).toEqual(["A", "B", "C"]);
  });

  it("does not exceed the worker limit when more items are queued", async () => {
    let inFlight = 0;
    let peak = 0;
    await pool([1, 2, 3, 4, 5, 6], 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(item);
      inFlight -= 1;
    });
    expect(peak).toBe(2);
  });

  it("processes every item with one worker when the limit is zero", async () => {
    const results = await pool([1, 2, 3], 0, async (item) => item * 10);
    expect(results).toEqual([10, 20, 30]);
  });

  it("processes every item when the limit is negative", async () => {
    const results = await pool([1, 2, 3], -4, async (item) => item * 10);
    expect(results).toEqual([10, 20, 30]);
  });

  it("returns an empty array for empty input", async () => {
    const results = await pool([], 4, async (item: number) => item);
    expect(results).toEqual([]);
  });

  it("rejects with the worker error when one worker rejects", async () => {
    const failing = pool([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error("worker 2 failed");
      await sleep(5);
      return item;
    });
    await expect(failing).rejects.toThrow("worker 2 failed");
  });
});
