import { FulfillmentStage } from '../enums/fulfillment-stage';

/**
 * Who may send an order back to Support ("Soát tool") from the kanban. ONE definition used by BOTH the
 * server guard (`FulfillmentTaskService.resolveTransition`) and the dialog chip (`ReworkBackDialog`),
 * so the two can never disagree: a chip that renders but is refused, or a route that exists but no chip
 * shows, would make the experiment in `documents/Plans/ToolCheck-Redesign.md` silently read 0.
 */
export const TOOL_CHECK_REWORK_STAGE = FulfillmentStage.Print;

export function canSendBackToToolCheck(factoryFlag: boolean | undefined, stage: FulfillmentStage | string | undefined): boolean {
  return factoryFlag === true && stage === TOOL_CHECK_REWORK_STAGE;
}

/** Reads the flag out of the all-staff `GET /factories/options` list; an id mismatch or an empty list means OFF. */
export function factoryAllowsToolCheckRework(
  options: { _id: string; allowToolCheckRework?: boolean }[],
  factoryId: string | null | undefined,
): boolean {
  if (!factoryId) return false;

  return options.find((f) => f._id === String(factoryId))?.allowToolCheckRework === true;
}
