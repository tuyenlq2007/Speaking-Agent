export type WordStatus = "pending" | "correct" | "incorrect" | "missing" | "current";

export interface DisplayToken {
  original: string;
  normalized: string;
}

export interface MatchedWord extends DisplayToken {
  status: WordStatus;
  recognized?: string;
}

export interface MatchResult {
  words: MatchedWord[];
  extras: string[];
  isCompleteMatch: boolean;
}

const wordPattern = /[a-z]+(?:['’][a-z]+)*/gi;

export function tokenizeForDisplay(value: string): DisplayToken[] {
  return (value.match(wordPattern) ?? []).map((original) => ({
    original,
    normalized: original.toLowerCase().replaceAll("’", "'")
  }));
}

export function normalizeText(value: string): string {
  return tokenizeForDisplay(value).map((token) => token.normalized).join(" ");
}

type Step = "equal" | "substitute" | "delete" | "insert";

export function matchWords(expectedText: string, recognizedText: string): MatchResult {
  const expected = tokenizeForDisplay(expectedText);
  const recognized = tokenizeForDisplay(recognizedText);
  const rows = expected.length + 1;
  const columns = recognized.length + 1;
  const costs = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  const steps = Array.from({ length: rows }, () => Array<Step | null>(columns).fill(null));

  for (let row = 1; row < rows; row += 1) {
    costs[row][0] = row;
    steps[row][0] = "delete";
  }
  for (let column = 1; column < columns; column += 1) {
    costs[0][column] = column;
    steps[0][column] = "insert";
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const equal = expected[row - 1].normalized === recognized[column - 1].normalized;
      const diagonal = costs[row - 1][column - 1] + (equal ? 0 : 1);
      const deletion = costs[row - 1][column] + 1;
      const insertion = costs[row][column - 1] + 1;
      const best = Math.min(diagonal, deletion, insertion);
      costs[row][column] = best;
      if (diagonal === best) steps[row][column] = equal ? "equal" : "substitute";
      else if (deletion === best) steps[row][column] = "delete";
      else steps[row][column] = "insert";
    }
  }

  const words: MatchedWord[] = [];
  const extras: string[] = [];
  let row = expected.length;
  let column = recognized.length;

  while (row > 0 || column > 0) {
    const step = steps[row][column];
    if (step === "equal" || step === "substitute") {
      const expectedToken = expected[row - 1];
      words.push({
        ...expectedToken,
        status: step === "equal" ? "correct" : "incorrect",
        recognized: recognized[column - 1].original
      });
      row -= 1;
      column -= 1;
    } else if (step === "delete") {
      words.push({ ...expected[row - 1], status: "missing" });
      row -= 1;
    } else {
      extras.push(recognized[column - 1].original);
      column -= 1;
    }
  }

  words.reverse();
  extras.reverse();
  return {
    words,
    extras,
    isCompleteMatch: words.every((word) => word.status === "correct") && extras.length === 0
  };
}

export function isSingleTargetMatch(target: string, transcript: string): boolean {
  return normalizeText(target) === normalizeText(transcript);
}
