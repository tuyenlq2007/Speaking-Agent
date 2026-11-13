import { describe, expect, it, vi } from "vitest";
import { RecognitionService, selectBritishVoice } from "../src/services/speech";

function voice(name: string, lang: string): SpeechSynthesisVoice {
  return { name, lang, default: false, localService: true, voiceURI: name };
}

describe("voice selection", () => {
  it("prefers an exact British English voice", () => {
    const selected = selectBritishVoice([voice("US", "en-US"), voice("UK", "en-GB")]);
    expect(selected.voice?.name).toBe("UK");
    expect(selected.exactBritishVoice).toBe(true);
  });

  it("falls back to another English voice", () => {
    const selected = selectBritishVoice([voice("French", "fr-FR"), voice("US", "en-US")]);
    expect(selected.voice?.name).toBe("US");
    expect(selected.exactBritishVoice).toBe(false);
  });
});

describe("recognition adapter", () => {
  it("configures recognition for British English", async () => {
    let instance: FakeRecognition | undefined;
    const transcripts: string[] = [];
    class FakeRecognition extends EventTarget implements SpeechRecognitionLike {
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 0;
      onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
      onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn(() => queueMicrotask(() => {
        this.onresult?.({
          results: { 0: { 0: { transcript: "hel", confidence: 0.5 }, length: 1, isFinal: false }, length: 1 }
        } as unknown as SpeechRecognitionEventLike);
        this.onresult?.({
          results: { 0: { 0: { transcript: "hello", confidence: 1 }, length: 1, isFinal: true }, length: 1 }
        } as unknown as SpeechRecognitionEventLike);
      }));
      stop = vi.fn();
      abort = vi.fn();
      constructor() { super(); instance = this; }
    }

    const service = new RecognitionService(FakeRecognition);
    await expect(service.listen((transcript) => transcripts.push(transcript))).resolves.toBe("hello");
    expect(transcripts).toEqual(["hel", "hello"]);
    expect(instance?.lang).toBe("en-GB");
    expect(instance?.continuous).toBe(false);
    expect(instance?.interimResults).toBe(true);
  });
});
