import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleQueue } from "../src/domain/sampleQueue";

afterEach(() => vi.restoreAllMocks());

describe("topic sample queue", () => {
  it("uses every sample before repeating without changing the source", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const samples = ["First passage.", "Second passage.", "Third passage."];
    const next = createSampleQueue(samples);

    const cycle = [next(), next(), next()];
    expect(new Set(cycle)).toEqual(new Set(samples));
    expect(samples).toEqual(["First passage.", "Second passage.", "Third passage."]);
    expect(samples).toContain(next());
  });

  it("uses randomness to choose the first sample", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const first = createSampleQueue(["First.", "Second.", "Third."])();
    random.mockReturnValue(0.999);
    const second = createSampleQueue(["First.", "Second.", "Third."])();
    expect(first).not.toBe(second);
  });

  it("avoids repeating the last sample at the next cycle boundary", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.999).mockReturnValue(0);
    const next = createSampleQueue(["First.", "Second."]);
    expect(next()).toBe("First.");
    expect(next()).toBe("Second.");
    expect(next()).toBe("First.");
    expect(next()).toBe("Second.");
  });

  it("cycles duplicate entries only once per distinct passage", () => {
    const next = createSampleQueue(["First.", "First.", "Second."]);
    expect(new Set([next(), next()]).size).toBe(2);
  });

  it("supports a topic containing a single passage", () => {
    const next = createSampleQueue(["Only passage."]);
    expect([next(), next(), next()]).toEqual(["Only passage.", "Only passage.", "Only passage."]);
  });

  it("rejects an empty topic", () => {
    expect(() => createSampleQueue([])).toThrow("at least one sample");
  });
});
