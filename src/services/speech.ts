export type RecognitionErrorCode =
  | "permission-denied"
  | "no-speech"
  | "network"
  | "unavailable"
  | "aborted";

export class RecognitionError extends Error {
  constructor(public readonly code: RecognitionErrorCode) {
    super(code);
    this.name = "RecognitionError";
  }
}

export interface VoiceSelection {
  voice: SpeechSynthesisVoice | null;
  exactBritishVoice: boolean;
}

export function selectBritishVoice(voices: SpeechSynthesisVoice[]): VoiceSelection {
  const british = voices.find((voice) => voice.lang.toLowerCase() === "en-gb");
  if (british) return { voice: british, exactBritishVoice: true };
  const english = voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
  return { voice: english ?? null, exactBritishVoice: false };
}

export class SpeechService {
  private operationToken = 0;

  constructor(private readonly synthesis: SpeechSynthesis = window.speechSynthesis) {}

  getVoiceSelection(): VoiceSelection {
    return selectBritishVoice(this.synthesis.getVoices());
  }

  cancel(): void {
    this.operationToken += 1;
    this.synthesis.cancel();
  }

  speak(text: string): Promise<void> {
    this.cancel();
    const token = this.operationToken;
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const selection = this.getVoiceSelection();
      utterance.lang = "en-GB";
      utterance.voice = selection.voice;
      utterance.rate = 0.86;
      utterance.onend = () => {
        if (token === this.operationToken) resolve();
      };
      utterance.onerror = () => {
        if (token === this.operationToken) reject(new Error("synthesis"));
      };
      this.synthesis.speak(utterance);
    });
  }
}

function mapRecognitionError(error: string): RecognitionErrorCode {
  if (error === "not-allowed" || error === "service-not-allowed") return "permission-denied";
  if (error === "no-speech") return "no-speech";
  if (error === "network") return "network";
  if (error === "aborted") return "aborted";
  return "unavailable";
}

/** How long the learner may stay silent after speaking before the sentence counts as finished. */
export const DEFAULT_SILENCE_MS = 3000;

export class RecognitionService {
  private active: SpeechRecognitionLike | null = null;
  private operationToken = 0;
  readonly supported: boolean;

  constructor(
    private readonly Recognition: SpeechRecognitionConstructor | undefined =
      window.SpeechRecognition ?? window.webkitSpeechRecognition,
    private readonly silenceMs: number = DEFAULT_SILENCE_MS
  ) {
    this.supported = Boolean(Recognition);
  }

  stop(): void {
    this.operationToken += 1;
    if (this.active) {
      this.active.onresult = null;
      this.active.onerror = null;
      this.active.onend = null;
      this.active.abort();
      this.active = null;
    }
  }

  listen(onTranscript?: (transcript: string, isFinal: boolean) => void): Promise<string> {
    this.stop();
    if (!this.Recognition) return Promise.reject(new RecognitionError("unavailable"));
    const recognition = new this.Recognition();
    const token = this.operationToken;
    this.active = recognition;
    recognition.lang = "en-GB";
    // Keep listening through pauses; we decide when the learner has finished.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    return new Promise((resolve, reject) => {
      let settled = false;
      let latestTranscript = "";
      let silenceTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanUp = () => {
        clearTimeout(silenceTimer);
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        if (this.active === recognition) this.active = null;
      };
      recognition.onresult = (event) => {
        if (settled || token !== this.operationToken) return;
        const parts: string[] = [];
        let allFinal = event.results.length > 0;
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const part = result?.[0]?.transcript?.trim();
          if (part) parts.push(part);
          if (!result?.isFinal) allFinal = false;
        }
        latestTranscript = parts.join(" ").trim();
        if (latestTranscript) onTranscript?.(latestTranscript, allFinal);
        if (!latestTranscript) return;
        // Every new result restarts the silence window, so slow speakers are not cut off.
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (settled || token !== this.operationToken) return;
          settled = true;
          cleanUp();
          recognition.stop();
          resolve(latestTranscript);
        }, this.silenceMs);
      };
      recognition.onerror = (event) => {
        if (settled || token !== this.operationToken) return;
        settled = true;
        cleanUp();
        reject(new RecognitionError(mapRecognitionError(event.error)));
      };
      recognition.onend = () => {
        if (settled || token !== this.operationToken) return;
        settled = true;
        cleanUp();
        if (latestTranscript) resolve(latestTranscript);
        else reject(new RecognitionError("no-speech"));
      };
      try {
        recognition.start();
      } catch {
        settled = true;
        cleanUp();
        reject(new RecognitionError("unavailable"));
      }
    });
  }
}
