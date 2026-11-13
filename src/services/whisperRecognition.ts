import { Endpointer } from "./endpointer";
import { RecognitionError } from "./speech";

const SAMPLE_RATE = 16000;

/** Whisper emits tags such as [BLANK_AUDIO] or (silence) for non-speech audio. */
export function cleanWhisperText(text: string): string {
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

function concatenate(chunks: Float32Array[]): Float32Array {
  const audio = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }
  return audio;
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "progress"; progress: number }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id?: number; message: string };

/** Records one sentence from the microphone and transcribes it with Whisper running in the browser. */
export class WhisperRecognitionService {
  readonly supported: boolean;
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve(text: string): void; reject(error: Error): void }>();
  private onProgress: ((percent: number) => void) | undefined;
  private cancelRecording: (() => void) | null = null;
  private token = 0;

  constructor() {
    this.supported = typeof Worker !== "undefined"
      && typeof AudioContext !== "undefined"
      && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") this.onProgress?.(message.progress);
      else if (message.type === "result") {
        this.pending.get(message.id)?.resolve(message.text);
        this.pending.delete(message.id);
      } else if (message.type === "error" && message.id !== undefined) {
        this.pending.get(message.id)?.reject(new Error(message.message));
        this.pending.delete(message.id);
      }
    };
    this.worker = worker;
    return worker;
  }

  /** Download and initialise the model ahead of the first recording. */
  warmUp(onProgress?: (percent: number) => void): Promise<void> {
    if (!this.supported) return Promise.reject(new RecognitionError("unavailable"));
    this.onProgress = onProgress;
    if (this.ready) return this.ready;
    const worker = this.getWorker();
    this.ready = new Promise<void>((resolve, reject) => {
      const listener = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "ready") {
          worker.removeEventListener("message", listener);
          resolve();
        } else if (event.data.type === "error" && event.data.id === undefined) {
          worker.removeEventListener("message", listener);
          this.ready = null;
          reject(new RecognitionError("unavailable"));
        }
      };
      worker.addEventListener("message", listener);
      worker.postMessage({ type: "load" });
    });
    return this.ready;
  }

  stop(): void {
    this.token += 1;
    this.cancelRecording?.();
    this.cancelRecording = null;
  }

  private transcribe(audio: Float32Array): Promise<string> {
    const id = this.nextId++;
    const worker = this.getWorker();
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
    });
  }

  private async record(token: number): Promise<Float32Array> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      throw new RecognitionError(name === "NotAllowedError" || name === "SecurityError" ? "permission-denied" : "unavailable");
    }

    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const endpointer = new Endpointer();
    const chunks: Float32Array[] = [];

    return new Promise<Float32Array>((resolve, reject) => {
      let finished = false;
      const finish = (outcome: "finish" | "no-speech" | "aborted") => {
        if (finished) return;
        finished = true;
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        this.cancelRecording = null;
        if (outcome === "finish") resolve(concatenate(chunks));
        else reject(new RecognitionError(outcome));
      };
      this.cancelRecording = () => finish("aborted");
      processor.onaudioprocess = (event) => {
        if (token !== this.token) return finish("aborted");
        const samples = new Float32Array(event.inputBuffer.getChannelData(0));
        chunks.push(samples);
        const decision = endpointer.push(samples, context.sampleRate);
        if (decision !== "continue") finish(decision);
      };
      source.connect(processor);
      processor.connect(context.destination);
    });
  }

  async listen(_onTranscript?: (transcript: string, isFinal: boolean) => void): Promise<string> {
    if (!this.supported) throw new RecognitionError("unavailable");
    this.stop();
    const token = this.token;
    const audio = await this.record(token);
    if (token !== this.token) throw new RecognitionError("aborted");
    let text: string;
    try {
      await this.warmUp();
      text = cleanWhisperText(await this.transcribe(audio));
    } catch (error) {
      if (error instanceof RecognitionError) throw error;
      throw new RecognitionError("unavailable");
    }
    if (token !== this.token) throw new RecognitionError("aborted");
    if (!text) throw new RecognitionError("no-speech");
    return text;
  }
}
