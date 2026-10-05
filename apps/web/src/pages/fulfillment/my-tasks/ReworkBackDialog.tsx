import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FulfillmentStage, ProductionOrder } from 'shared';
import { FULFILLMENT_STAGE_ORDER, FULFILLMENT_STAGES } from 'shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { getStageLabel } from '@/utils/fulfillmentStageLabel';

type Target = 'designer' | 'tool-check' | FulfillmentStage;

interface Props {
  order: ProductionOrder;
  myStage: FulfillmentStage;
  /** Factory flag `allowToolCheckRework`: adds the "Soát tool" target (Print stage only, mirrored on the server). */
  allowToolCheck?: boolean;
  onClose: () => void;
  onSubmit: (target: Target, reason: string) => Promise<void>;
}

export function ReworkBackDialog({ order, myStage, allowToolCheck, onClose, onSubmit }: Props) {
  const { t } = useTranslation(['fulfillmentWorkflow', 'common']);
  const myIdx = FULFILLMENT_STAGE_ORDER[myStage];
  const previousStages = useMemo(() => FULFILLMENT_STAGES.filter((s) => FULFILLMENT_STAGE_ORDER[s] < myIdx), [myIdx]);

  const defaultTarget: Target = previousStages.length > 0 ? previousStages[previousStages.length - 1]! : 'designer';
  const [target, setTarget] = useState<Target>(defaultTarget);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = reason.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(target, reason.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reworkDialog.title', { code: order.productionId })}</DialogTitle>
          <DialogDescription>{t('reworkDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('reworkDialog.pushTo')}</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              <button type="button" onClick={() => setTarget('designer')} className={chipClass(target === 'designer')}>
                {t('reworkDialog.designer')}
              </button>
              {allowToolCheck && myStage === 'print' && (
                <button type="button" onClick={() => setTarget('tool-check')} className={chipClass(target === 'tool-check')}>
                  {t('reworkDialog.toolCheck')}
                </button>
              )}
              {previousStages.map((s) => (
                <button key={s} type="button" onClick={() => setTarget(s)} className={chipClass(target === s)}>
                  {getStageLabel(t, s)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="reason" className="text-xs">
              {t('reworkDialog.reasonLabel')} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder={t('reworkDialog.reasonPlaceholder')}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {t('reworkDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function chipClass(active: boolean): string {
  const base = 'inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md border transition-colors';
  return active
    ? `${base} bg-primary text-primary-foreground border-primary`
    : `${base} bg-background text-foreground border-border hover:bg-accent`;
}
