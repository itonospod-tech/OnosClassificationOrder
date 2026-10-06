/**
 * Guard for the external tool's result door (`setDesignReviewResult`). The queue only takes orders whose
 * `toolResult` is empty, so writing `toolResult` WITHOUT `toolResultNote` drops the order out of the queue
 * for good with no note: a silent half-write (that is how thousands of orders got stuck). Better the tool
 * gets an error than an order vanishes.
 *
 * Allowed: clearing `toolResult` (null/empty — the way back into the queue), and an EXPLICIT
 * `toolResultNote: null` (the tool states its intent; omission is the bug). Refused: a non-empty
 * `toolResult` with the note field absent (`undefined`).
 */
export function missingToolResultNote(input: { toolResult: string | null; toolResultNote?: string | null }): boolean {
  const hasResult = typeof input.toolResult === 'string' && input.toolResult.trim() !== '';

  return hasResult && input.toolResultNote === undefined;
}
