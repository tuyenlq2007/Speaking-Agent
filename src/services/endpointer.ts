export interface EndpointOptions {
  /** RMS level (0–1) above which a chunk counts as speech. */
  speechThreshold: number;
  /** Shortest silence after speech that ends the sentence. */
  minSilenceMs: number;
  /** Longest silence we ever wait, used for speakers who pause a lot. */
  maxSilenceMs: number;
  /** The allowed silence is this many times the longest pause heard so far. */
  pauseFactor: number;
  /** Give up when nothing is said for this long. */
  noSpeechMs: number;
  /** Hard cap for one recording. */
  maxMs: number;
}

export const defaultEndpointOptions: EndpointOptions = {
  speechThreshold: 0.012,
  minSilenceMs: 1200,
  maxSilenceMs: 3000,
  pauseFactor: 1.5,
  noSpeechMs: 8000,
  maxMs: 40000
};

export type EndpointDecision = "continue" | "finish" | "no-speech";

export function rootMeanSquare(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / samples.length);
}

/** Decides when a recording is complete, tolerating slow speakers with long pauses. */
export class Endpointer {
  private elapsedMs = 0;
  private silentMs = 0;
  private longestPauseMs = 0;
  private speechStarted = false;

  constructor(private readonly options: EndpointOptions = defaultEndpointOptions) {}

  push(samples: Float32Array, sampleRate: number): EndpointDecision {
    const chunkMs = (samples.length / sampleRate) * 1000;
    this.elapsedMs += chunkMs;
    if (rootMeanSquare(samples) >= this.options.speechThreshold) {
      // A pause in the middle of the sentence tells us how patient to be with this speaker.
      if (this.speechStarted) this.longestPauseMs = Math.max(this.longestPauseMs, this.silentMs);
      this.speechStarted = true;
      this.silentMs = 0;
    } else {
      this.silentMs += chunkMs;
    }

    const { minSilenceMs, maxSilenceMs, pauseFactor } = this.options;
    const allowedSilenceMs = Math.min(maxSilenceMs, Math.max(minSilenceMs, this.longestPauseMs * pauseFactor));
    if (this.speechStarted && this.silentMs >= allowedSilenceMs) return "finish";
    if (!this.speechStarted && this.elapsedMs >= this.options.noSpeechMs) return "no-speech";
    if (this.elapsedMs >= this.options.maxMs) return this.speechStarted ? "finish" : "no-speech";
    return "continue";
  }
}
