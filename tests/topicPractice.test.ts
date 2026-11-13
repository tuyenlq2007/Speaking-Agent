import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { sampleTopics } from "../src/data/sampleSentences";
import { splitIntoSentences } from "../src/domain/sentences";
import { SpeechService } from "../src/services/speech";
import { WhisperRecognitionService } from "../src/services/whisperRecognition";

let container: HTMLDivElement;
let root: Root;
let finishPlayback: (() => void) | undefined;
let finishReading: ((transcript: string) => void) | undefined;
let spokenSentence = "";

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Math, "random").mockReturnValue(0.999);
  vi.stubGlobal("speechSynthesis", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("AudioContext", class {});
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn() }, configurable: true });
  vi.spyOn(WhisperRecognitionService.prototype, "warmUp").mockResolvedValue();
  vi.spyOn(SpeechService.prototype, "getVoiceSelection").mockReturnValue({ voice: null, exactBritishVoice: true });
  vi.spyOn(SpeechService.prototype, "cancel").mockImplementation(() => {});
  vi.spyOn(SpeechService.prototype, "speak").mockImplementation((sentence) => {
    spokenSentence = sentence;
    return new Promise((resolve) => { finishPlayback = resolve; });
  });
  vi.spyOn(WhisperRecognitionService.prototype, "listen").mockImplementation(() =>
    new Promise((resolve) => { finishReading = resolve; })
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    responseData: { translatedText: "Bản dịch." }, responseStatus: 200
  }), { status: 200 })));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  finishPlayback = undefined;
  finishReading = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(App)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function selectTopic(index = 0) {
  const select = container.querySelector<HTMLSelectElement>("#practice-topic");
  expect(select, "topic selector").not.toBeNull();
  await act(async () => {
    select!.value = sampleTopics[index].id;
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}

async function readSentence(transcript?: string) {
  const expected = spokenSentence;
  expect(finishPlayback).toBeDefined();
  await act(async () => finishPlayback!());
  expect(finishReading).toBeDefined();
  await act(async () => finishReading!(transcript ?? expected));
}

describe("topic practice", () => {
  it("loads a passage from the selected topic and can replace it with another", async () => {
    await selectTopic();
    const first = container.querySelector("textarea")!.value;
    expect(sampleTopics[0].samples).toContain(first);
    await clickButton("Đoạn ngẫu nhiên khác");
    const second = container.querySelector("textarea")!.value;
    expect(sampleTopics[0].samples).toContain(second);
    expect(second).not.toBe(first);

    await selectTopic(1);
    expect(sampleTopics[1].samples).toContain(container.querySelector("textarea")!.value);
  });

  it.each([0, 1])("automatically starts another passage from topic %i after completion", async (topicIndex) => {
    await selectTopic(topicIndex);
    const passage = container.querySelector("textarea")!.value;
    const sentences = splitIntoSentences(passage);
    await clickButton("Bắt đầu luyện");
    expect(spokenSentence).toBe(sentences[0]);
    for (const sentence of sentences) {
      expect(spokenSentence).toBe(sentence);
      await readSentence();
    }
    expect(container.querySelector(".result-card")).toBeNull();
    expect(container.querySelector(".practice-topic")!.textContent).toContain(sampleTopics[topicIndex].label);
    expect(spokenSentence).not.toBe(sentences[0]);
    expect(sampleTopics[topicIndex].samples.some((sample) => sample.startsWith(spokenSentence))).toBe(true);
    expect(container.querySelector(".practice-topic")!.textContent).toContain("Đoạn 2");
    expect(container.querySelector(".eyebrow")!.textContent).toContain("CÂU 1 /");
  });

  it("continues after the final sentence exhausts its retry", async () => {
    await selectTopic();
    const sentences = splitIntoSentences(container.querySelector("textarea")!.value);
    await clickButton("Bắt đầu luyện");
    for (let index = 0; index < sentences.length - 1; index += 1) await readSentence();
    await readSentence("completely unrelated words");
    expect(spokenSentence).toBe(sentences.at(-1));
    await readSentence("completely unrelated words");
    expect(container.querySelector(".practice-topic")!.textContent).toContain("Đoạn 2");
  });

  it("keeps custom passages finite and shows their results", async () => {
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "I like tea.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickButton("Bắt đầu luyện");
    await readSentence();
    expect(container.querySelector(".result-card")).not.toBeNull();
    expect(container.querySelector(".sentence-result")!.textContent).toContain("I like tea.");
  });

  it("switches to custom practice when the learner edits a topic sample", async () => {
    await selectTopic(1);
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "I like coffee.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector<HTMLSelectElement>("#practice-topic")!.value).toBe("");
    await clickButton("Bắt đầu luyện");
    await readSentence();
    expect(container.querySelector(".result-card")).not.toBeNull();
  });

  it("practices the complete long introduction and automatically starts it again", async () => {
    await selectTopic(2);
    const passage = container.querySelector("textarea")!.value;
    expect(passage.length).toBeGreaterThan(1500);
    expect(passage).toMatch(/^I’m a Senior QA Automation Engineer\./);
    expect(passage).toMatch(/They can also support complex troubleshooting workflows\.$/);
    const sentences = splitIntoSentences(passage);
    await clickButton("Bắt đầu luyện");
    for (const sentence of sentences) {
      expect(spokenSentence).toBe(sentence);
      await readSentence();
    }
    expect(container.querySelector(".practice-topic")!.textContent).toContain("Introduce Yourself · Đoạn 2");
    expect(spokenSentence).toBe("I’m a Senior QA Automation Engineer.");
  });

  it("returns to topic selection when the learner exits practice", async () => {
    await selectTopic();
    await clickButton("Bắt đầu luyện");
    await clickButton("Đổi chủ đề");
    expect(container.querySelector("#practice-topic")).not.toBeNull();
    expect(container.querySelector(".practice-card")).toBeNull();
    await act(async () => finishPlayback?.());
    expect(container.querySelector(".practice-card")).toBeNull();
  });
});
