/** Visit each distinct passage in random order before starting a fresh cycle. */
export function createSampleQueue(samples: readonly string[]): () => string {
  const unique = [...new Set(samples)];
  if (!unique.length) throw new Error("A topic needs at least one sample.");

  let queue: string[] = [];
  let previous: string | undefined;

  return () => {
    if (!queue.length) {
      queue = [...unique];
      for (let index = queue.length - 1; index > 0; index -= 1) {
        const otherIndex = Math.floor(Math.random() * (index + 1));
        [queue[index], queue[otherIndex]] = [queue[otherIndex], queue[index]];
      }
      if (queue.length > 1 && queue[0] === previous) {
        const otherIndex = 1 + Math.floor(Math.random() * (queue.length - 1));
        [queue[0], queue[otherIndex]] = [queue[otherIndex], queue[0]];
      }
    }
    previous = queue.shift()!;
    return previous;
  };
}
