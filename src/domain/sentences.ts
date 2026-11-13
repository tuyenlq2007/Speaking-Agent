const sentencePattern = /[^.!?\n]+(?:[.!?]+["'”’)}\]]*|(?=\n|$))/g;

/** Split a passage into the individual sentences that will be spoken and recorded. */
export function splitIntoSentences(value: string): string[] {
  return (value.replace(/\r\n?/g, "\n").match(sentencePattern) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[a-z]/i.test(sentence));
}
