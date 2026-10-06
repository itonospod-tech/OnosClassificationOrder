/**
 * Guard for the external tool's result door (`setDesignReviewResult`). The queue only takes orders whose
 * `toolResult` is empty, so setting `toolResult` WITHOUT a real `toolResultNote` drops the order out of the
 * queue for good with no outcome: a silent half-write (that is how thousands of orders got stuck).
 * Better the tool gets a loud error than an order vanishes.
 *
 * Rule: a non-empty `toolResult` REQUIRES a non-empty `toolResultNote`. Absent, `null` and blank are all
 * refused (no business case sets a result while clearing the outcome, and we do not know what the tool
 * really sends, so the guard is strict). Only clearing `toolResult` itself (null/empty — the way back into
 * the queue) needs no note.
 */
export type MissingNoteReason = 'absent' | 'null' | 'blank';

export function missingToolResultNote(input: {
  toolResult: string | null;
  toolResultNote?: string | null;
}): MissingNoteReason | null {
  const hasResult = typeof input.toolResult === 'string' && input.toolResult.trim() !== '';
  if (!hasResult) return null;
  if (input.toolResultNote === undefined) return 'absent';
  if (input.toolResultNote === null) return 'null';
  if (input.toolResultNote.trim() === '') return 'blank';

  return null;
}
