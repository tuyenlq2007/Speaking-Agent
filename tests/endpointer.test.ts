import { describe, expect, it } from "vitest";
import { Endpointer } from "../src/services/endpointer";
import { cleanWhisperText } from "../src/services/whisperRecognition";

const RATE = 16000;
const chunk = (ms: number, level: number) => new Float32Array((RATE * ms) / 1000).fill(level);
const options = { speechThreshold: 0.01, minSilenceMs: 1200, maxSilenceMs: 3000, pauseFactor: 1.5, noSpeechMs: 8000, maxMs: 40000 };

describe("endpointer", () => {
  it("finishes quickly after a speaker who does not pause", () => {
    const endpointer = new Endpointer(options);
    expect(endpointer.push(chunk(2000, 0.1), RATE)).toBe("continue");
    expect(endpointer.push(chunk(1100, 0), RATE)).toBe("continue");
    expect(endpointer.push(chunk(100, 0), RATE)).toBe("finish");
  });

  it("waits longer for a speaker who pauses mid-sentence", () => {
    const endpointer = new Endpointer(options);
    expect(endpointer.push(chunk(500, 0.1), RATE)).toBe("continue");
    expect(endpointer.push(chunk(1000, 0), RATE)).toBe("continue");
    expect(endpointer.push(chunk(500, 0.1), RATE)).toBe("continue");
    // A one second pause allows 1.5 seconds of silence before finishing.
    expect(endpointer.push(chunk(1400, 0), RATE)).toBe("continue");
    expect(endpointer.push(chunk(100, 0), RATE)).toBe("finish");
  });

  it("never waits longer than the maximum silence", () => {
    const endpointer = new Endpointer(options);
    endpointer.push(chunk(500, 0.1), RATE);
    endpointer.push(chunk(2800, 0), RATE);
    endpointer.push(chunk(500, 0.1), RATE);
    expect(endpointer.push(chunk(2900, 0), RATE)).toBe("continue");
    expect(endpointer.push(chunk(100, 0), RATE)).toBe("finish");
  });

  it("reports no speech when nothing is said", () => {
    const endpointer = new Endpointer(options);
    expect(endpointer.push(chunk(7000, 0), RATE)).toBe("continue");
    expect(endpointer.push(chunk(1000, 0), RATE)).toBe("no-speech");
  });

  it("stops at the maximum length", () => {
    const endpointer = new Endpointer({ ...options, maxMs: 5000 });
    expect(endpointer.push(chunk(5000, 0.1), RATE)).toBe("finish");
  });
});

describe("cleanWhisperText", () => {
  it("removes non-speech tags", () => {
    expect(cleanWhisperText(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanWhisperText("I check the logs. (silence)")).toBe("I check the logs.");
  });
});
