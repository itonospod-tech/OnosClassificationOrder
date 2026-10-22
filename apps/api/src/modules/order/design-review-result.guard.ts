/**
 * Guard for the external tool's result door (`setDesignReviewResult`).
 *
 * Contract with the tool (see Tool/tool/src/orderApi.js):
 *   - automated run: sends `toolResult` ('has-tool' | 'no-tool') and OMITS `toolResultNote`. The note is
 *     filled in later by a human in "Soát design" ('ok' | 'error'). An ABSENT note is therefore normal and
 *     must go through, otherwise the tool loops on the same order forever (06/10/2026 incident: the strict
 *     version of this guard refused every automated result and the queue stopped moving).
 *   - "Soát design" submit: sends both fields.
 *
 * What we still refuse: a non-empty `toolResult` together with an EXPLICIT `null` or blank `toolResultNote`.
 * No caller has a business reason to set a result while clearing the outcome, and that exact shape wipes a
 * note a human already entered. Clearing `toolResult` itself (null/empty — the way back into the queue) needs
 * no note.
 */
export type MissingNoteReason = 'null' | 'blank';

export function missingToolResultNote(input: {
  toolResult: string | null;
  toolResultNote?: string | null;
}): MissingNoteReason | null {
  const hasResult = typeof input.toolResult === 'string' && input.toolResult.trim() !== '';
  if (!hasResult) return null;
  if (input.toolResultNote === undefined) return null;
  if (input.toolResultNote === null) return 'null';
  if (input.toolResultNote.trim() === '') return 'blank';

  return null;
}
