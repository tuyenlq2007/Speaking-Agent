import { env, pipeline } from "@huggingface/transformers";

// Runs Whisper entirely in the browser; the model files are downloaded once and cached.
env.allowLocalModels = false;

const MODEL = "Xenova/whisper-base.en";

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

let transcriber: Promise<Transcriber> | null = null;

function load(): Promise<Transcriber> {
  transcriber ??= pipeline("automatic-speech-recognition", MODEL, {
    dtype: "q8",
    progress_callback: (progress: { status?: string; progress?: number }) => {
      if (progress.status === "progress" && typeof progress.progress === "number") {
        self.postMessage({ type: "progress", progress: progress.progress });
      }
    }
  }) as unknown as Promise<Transcriber>;
  transcriber.catch(() => { transcriber = null; });
  return transcriber;
}

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as { type: "load" } | { type: "transcribe"; id: number; audio: Float32Array };
  try {
    const run = await load();
    if (message.type === "load") {
      self.postMessage({ type: "ready" });
      return;
    }
    const output = await run(message.audio, { chunk_length_s: 30 });
    const text = (Array.isArray(output) ? output[0]?.text : output.text) ?? "";
    self.postMessage({ type: "result", id: message.id, text });
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.type === "transcribe" ? message.id : undefined,
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
