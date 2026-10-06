import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { z } from 'zod';

import { IDZod } from '../constants/common-zod';
import { ResZod } from '@shared/types';

/**
 * Undo a mistaken bulk edit (Orders.md §27, SuperAdmin). Each group is undone as its own batch:
 *  - designer: assignee removed (with the unlogged designer-state cascade);
 *  - tool-ok: approved tool note 'ok' removed (with the unlogged fulfillment cascade);
 *  - tool-note: another tool note removed;
 *  - tool-result: toolResult changed.
 */
export const BULK_UNDO_GROUPS = ['designer', 'tool-ok', 'tool-note', 'tool-result'] as const;
export type BulkUndoGroup = (typeof BULK_UNDO_GROUPS)[number];
export const BULK_UNDO_SKIP_REASONS = ['cancelled', 'held', 'edited-after', 'current-differs', 'changed-during-run', 'not-found'] as const;
export type BulkUndoSkipReason = (typeof BULK_UNDO_SKIP_REASONS)[number];
/** Max orders restored per run. */
export const BULK_UNDO_BATCH_MAX = 100;

export const BulkUndoScopeZod = z.object({
  /** The account that made the mistaken edit: matches the log's userId, userName or userEmail. */
  actor: z.string().trim().min(1),
  /** Incident window (ISO instants). Rewind target = state just before `from`. */
  from: z.coerce.date(),
  to: z.coerce.date(),
  group: z.enum(BULK_UNDO_GROUPS),
});
export class BulkUndoPreviewDto extends createZodDto(extendApi(BulkUndoScopeZod)) {}
export const BulkUndoRunZod = BulkUndoScopeZod.extend({
  ids: z.array(IDZod).min(1).max(BULK_UNDO_BATCH_MAX),
  reason: z.string().trim().min(10).max(500),
});
export class BulkUndoRunDto extends createZodDto(extendApi(BulkUndoRunZod)) {}

export const BulkUndoChangeZod = z.object({ field: z.string(), current: z.unknown(), restore: z.unknown() });
export const BulkUndoRowZod = z.object({
  orderId: z.string(),
  productionId: z.string(),
  status: z.enum(['restore', 'skip', 'restored']),
  reason: z.enum(BULK_UNDO_SKIP_REASONS).optional(),
  changes: z.array(BulkUndoChangeZod),
});
export type BulkUndoRow = z.infer<typeof BulkUndoRowZod>;
export const BulkUndoResultZod = z.object({
  /** Orders whose group field the actor really changed inside the window. */
  affected: z.number(),
  restorable: z.number(),
  skipped: z.number(),
  rows: z.array(BulkUndoRowZod),
  /** Display names of the user ids appearing as assignee values (for the before/after file). */
  userNames: z.record(z.string()),
});
export type BulkUndoResult = z.infer<typeof BulkUndoResultZod>;
export class BulkUndoResDto extends createZodDto(extendApi(ResZod.extend({ data: BulkUndoResultZod }))) {}
