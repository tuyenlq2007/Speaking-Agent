import { describe, expect, it } from "vitest";
import { matchWords, normalizeText } from "../src/domain/matcher";

describe("text normalization", () => {
  it("normalizes case, punctuation, apostrophes, and whitespace", () => {
    expect(normalizeText("  I’M,   ready! ")).toBe("i'm ready");
  });
});

describe("sequence word matching", () => {
  it("matches equal sentences", () => {
    expect(matchWords("I like tea", "i like tea").isCompleteMatch).toBe(true);
  });

  it("reports substitutions", () => {
    expect(matchWords("I like tea", "I love tea").words.map((word) => word.status))
      .toEqual(["correct", "incorrect", "correct"]);
  });

  it("does not cascade after an omission", () => {
    expect(matchWords("I really like tea", "I like tea").words.map((word) => word.status))
      .toEqual(["correct", "missing", "correct", "correct"]);
  });

  it("retains inserted words as diagnostic extras", () => {
    const result = matchWords("I like tea", "I really like tea");
    expect(result.words.map((word) => word.status)).toEqual(["correct", "correct", "correct"]);
    expect(result.extras).toEqual(["really"]);
    expect(result.isCompleteMatch).toBe(false);
  });
});
