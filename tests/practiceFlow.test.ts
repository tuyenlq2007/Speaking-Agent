import { describe, expect, it } from "vitest";
import {
  beginListening,
  completeModelPlayback,
  consumeTranscript,
  failRecoverably,
  retryAfterError,
  startPractice,
  MAX_ATTEMPTS
} from "../src/domain/practiceFlow";

function reachInitialListening(sentence = "I like tea") {
  return beginListening(completeModelPlayback(startPractice(sentence)));
}

function reachRetryListening(sentence = "I like tea") {
  const reviewed = consumeTranscript(reachInitialListening(sentence), "I love tea");
  return beginListening(completeModelPlayback(reviewed));
}

describe("practice flow", () => {
  it("constructs the incorrect-word queue in sentence order", () => {
    const state = consumeTranscript(reachInitialListening("We really like tea"), "We love coffee");
    expect(state.practiceQueue).toEqual([1, 2, 3]);
    expect(state.phase).toBe("speaking-model-final-sentence");
  });

  it("replays the complete sentence instead of entering word practice", () => {
    const reviewed = consumeTranscript(reachInitialListening(), "I love tea");
    const ready = completeModelPlayback(reviewed);
    expect(ready.phase).toBe("ready-for-final-reading");
    expect(reviewed.practiceQueue).toEqual([1]);
  });

  it("finishes immediately when the first reading matches", () => {
    const state = consumeTranscript(reachInitialListening(), "I like tea");
    expect(state.phase).toBe("results");
    expect(state.successful).toBe(true);
    expect(state.attempts).toBe(1);
  });

  it("stops after one failed retry", () => {
    const state = consumeTranscript(reachRetryListening(), "I love tea");
    expect(state.phase).toBe("results");
    expect(state.successful).toBe(false);
    expect(state.attempts).toBe(MAX_ATTEMPTS);
  });

  it("preserves attempt counts for recoverable recognition errors", () => {
    const listening = reachRetryListening();
    const errored = failRecoverably(listening, "no-speech", "ready-for-final-reading");
    const retried = retryAfterError(errored);
    expect(retried.phase).toBe("ready-for-final-reading");
    expect(retried.attempts).toBe(1);
  });
});
