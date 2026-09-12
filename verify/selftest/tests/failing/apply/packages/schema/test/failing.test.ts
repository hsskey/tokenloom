import { describe, expect, it } from "vitest";

describe("selftest", () => {
  it("깨지는 단언", () => {
    expect(1 + 1).toBe(3);
  });
});
