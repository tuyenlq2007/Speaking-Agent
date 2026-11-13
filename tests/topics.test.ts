import { describe, expect, it } from "vitest";
import { sampleSentences, sampleTopics } from "../src/data/sampleSentences";
import { splitIntoSentences } from "../src/domain/sentences";

describe("practice topics", () => {
  it("provides distinct, populated topics with usable practice passages", () => {
    expect(sampleTopics.map((topic) => topic.label)).toEqual(["Traditional QA", "AI QA", "Introduce Yourself", "Introduce AI QA"]);
    expect(new Set(sampleTopics.map((topic) => topic.id)).size).toBe(sampleTopics.length);
    for (const topic of sampleTopics) {
      expect(topic.label.trim()).not.toBe("");
      expect(topic.samples.length).toBeGreaterThan(0);
      for (const sample of topic.samples) {
        expect(sample.length).toBeLessThanOrEqual(6000);
        expect(splitIntoSentences(sample).length).toBeGreaterThan(0);
      }
    }
    expect(sampleTopics.flatMap((topic) => topic.samples)).toEqual(sampleSentences);
  });
});
