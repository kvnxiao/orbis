/**
 * Estimate the tokens of text as its UTF-16 length divided by four, rounded up.
 *
 * Every memory budget uses this one estimate; it is not provider-reported usage and is labeled as
 * an estimate wherever status reports it.
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
