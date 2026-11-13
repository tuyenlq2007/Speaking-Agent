import { matchWords, tokenizeForDisplay, type MatchedWord } from "./matcher";

// One first reading and, when needed, one retry.
export const MAX_ATTEMPTS = 2;

export type SpeakingPhase =
  | "speaking-model-sentence"
  | "speaking-model-final-sentence";

export type ReadyPhase =
  | "ready-for-initial-reading"
  | "ready-for-final-reading";

export type ListeningPhase =
  | "listening-initial-reading"
  | "listening-final-reading";

export type PracticePhase =
  | "input"
  | SpeakingPhase
  | ReadyPhase
  | ListeningPhase
  | "reviewing-initial-reading"
  | "results"
  | "recoverable-error";

export type PracticeError =
  | "permission-denied"
  | "no-speech"
  | "network"
  | "unavailable"
  | "aborted"
  | "synthesis";

export interface PracticeState {
  phase: PracticePhase;
  sentence: string;
  words: MatchedWord[];
  practiceQueue: number[];
  wordsNeedingWork: number[];
  attempts: number;
  transcript: string;
  successful: boolean;
  error?: PracticeError;
  retryPhase?: SpeakingPhase | ReadyPhase;
}

export function createInputState(): PracticeState {
  return {
    phase: "input",
    sentence: "",
    words: [],
    practiceQueue: [],
    wordsNeedingWork: [],
    attempts: 0,
    transcript: "",
    successful: false
  };
}

export function startPractice(sentence: string): PracticeState {
  const words: MatchedWord[] = tokenizeForDisplay(sentence).map((token) => ({
    ...token,
    status: "pending"
  }));
  return {
    ...createInputState(),
    sentence: sentence.trim(),
    words,
    phase: "speaking-model-sentence"
  };
}

export function completeModelPlayback(state: PracticeState): PracticeState {
  const transitions: Record<SpeakingPhase, ReadyPhase> = {
    "speaking-model-sentence": "ready-for-initial-reading",
    "speaking-model-final-sentence": "ready-for-final-reading"
  };
  if (!(state.phase in transitions)) return state;
  return { ...state, phase: transitions[state.phase as SpeakingPhase], error: undefined, retryPhase: undefined };
}

export function beginListening(state: PracticeState): PracticeState {
  const transitions: Record<ReadyPhase, ListeningPhase> = {
    "ready-for-initial-reading": "listening-initial-reading",
    "ready-for-final-reading": "listening-final-reading"
  };
  if (!(state.phase in transitions)) return state;
  return { ...state, phase: transitions[state.phase as ReadyPhase], error: undefined };
}

export function consumeTranscript(state: PracticeState, transcript: string): PracticeState {
  if (state.phase === "listening-initial-reading") {
    const result = matchWords(state.sentence, transcript);
    const attempts = state.attempts + 1;
    const practiceQueue = result.words
      .map((word, index) => (word.status === "correct" ? -1 : index))
      .filter((index) => index >= 0);
    if (result.isCompleteMatch) {
      return {
        ...state,
        phase: "results",
        words: result.words,
        practiceQueue,
        transcript,
        attempts,
        successful: true
      };
    }
    return {
      ...state,
      phase: "speaking-model-final-sentence",
      words: result.words,
      practiceQueue,
      transcript,
      attempts
    };
  }

  if (state.phase === "listening-final-reading") {
    const result = matchWords(state.sentence, transcript);
    const attempts = state.attempts + 1;
    if (result.isCompleteMatch) {
      return { ...state, phase: "results", words: result.words, transcript, attempts, successful: true };
    }
    if (attempts >= MAX_ATTEMPTS) {
      const remaining = result.words
        .map((word, index) => (word.status === "correct" ? -1 : index))
        .filter((index) => index >= 0);
      return {
        ...state,
        phase: "results",
        words: result.words,
        transcript,
        attempts,
        successful: false,
        wordsNeedingWork: [...new Set([...state.wordsNeedingWork, ...remaining])]
      };
    }
    return {
      ...state,
      phase: "speaking-model-final-sentence",
      words: result.words,
      transcript,
      attempts
    };
  }

  return state;
}

export function failRecoverably(
  state: PracticeState,
  error: PracticeError,
  retryPhase: SpeakingPhase | ReadyPhase
): PracticeState {
  return { ...state, phase: "recoverable-error", error, retryPhase };
}

export function retryAfterError(state: PracticeState): PracticeState {
  if (state.phase !== "recoverable-error" || !state.retryPhase) return state;
  return { ...state, phase: state.retryPhase, error: undefined, retryPhase: undefined };
}
