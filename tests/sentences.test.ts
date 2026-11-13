import { describe, expect, it } from "vitest";
import { splitIntoSentences } from "../src/domain/sentences";

describe("passage sentence splitting", () => {
  it("splits punctuation-delimited sentences and preserves punctuation", () => {
    expect(splitIntoSentences("Hello there! How are you? I'm fine."))
      .toEqual(["Hello there!", "How are you?", "I'm fine."]);
  });

  it("treats line breaks as sentence boundaries", () => {
    expect(splitIntoSentences("Read this line\nThen read this one"))
      .toEqual(["Read this line", "Then read this one"]);
  });

  it("ignores fragments without English letters", () => {
    expect(splitIntoSentences("...\nA real sentence.")).toEqual(["A real sentence."]);
  });
});
