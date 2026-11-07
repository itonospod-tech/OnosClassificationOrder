import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { BookOpenText, CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import type { AdminWalletRow, CustomerWalletTxn, WalletOperationMode } from 'shared';
import { normalizeExternalTxnId, previewWalletOperation, requiresStatementCheck, WALLET_BIG_AMOUNT_USD } from 'shared';

import { RepositoryRemote } from '@/services';

import { StatCards } from '@/components/common/StatCards';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { formatUsd } from './walletFormat';

/** Mirrors the API cap (`TopupWalletZod` / `AdjustWalletZod` / `UpdateCreditLimitZod`). */
const MAX_AMOUNT = 1_000_000;

type Step = 'form' | 'review' | 'done';

interface WalletActionDialogProps {
  mode: WalletOperationMode;
  seller: { customerId: string; name: string };
  onClose: () => void;
  /** Called when the dialog closes after something was written, so the parent can refresh. */
  onChanged: () => void;
  /**
   * After a lost connection nobody knows whether the write landed. The dialog offers a shortcut to the
   * ledger (parent closes the dialog and reloads it) so the operator can LOOK before pressing again or
   * editing the amount — the one place where a changed amount would be a genuinely new operation.
   */
  onViewLedger: () => void;
}

interface DoneState {
  replayed: boolean;
  unchanged: boolean;
  balance: number;
  creditLimit: number;
  txn?: CustomerWalletTxn;
}

const hasAtMostTwoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const isWebLink = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/**
 * Staff money dialog: top up, adjust, or change the credit limit of ONE seller. This is the path that moves
 * real money, so it is deliberately slow and explicit:
 *
 *  1. Form → 2. Review (re-reads the wallet from the server, shows balance before → after, and for large
 *     amounts asks for a tick) → 3. Result (what the server actually wrote).
 *  - One idempotency key (`requestId`) is made when the dialog opens and re-sent on every retry, so a double
 *    click or a retry after a timeout cannot write twice; the server answers `replayed` instead. The key is
 *    replaced only if the MODE or the AMOUNT changed after an attempt (otherwise the server would rightly refuse a
 *    different amount under the old key). Editing the note or the reference does NOT mint a new key — doing so
 *    was a double-spend hole, because a retry after a lost connection with a corrected note looked like a new
 *    operation to the server.
 *  - The submit button is locked from the click until the answer, and the dialog cannot be dismissed meanwhile.
 *  - It is mounted fresh for each operation (the parent renders it conditionally), so state never leaks
 *    from one seller or operation to the next.
 */
export default function WalletActionDialog({ mode, seller, onClose, onChanged, onViewLedger }: WalletActionDialogProps) {
  const { t } = useTranslation('wallets');
  const [step, setStep] = useState<Step>('form');
  const [amountInput, setAmountInput] = useState('');
  const [note, setNote] = useState('');
  const [externalTxnId, setExternalTxnId] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [wallet, setWallet] = useState<AdminWalletRow | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [connectionLost, setConnectionLost] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);
  const [wrote, setWrote] = useState(false);

  // The idempotency key of THIS dialog. Created once; see the class comment for when it is replaced.
  const attempt = useRef<{ requestId: string; fingerprint?: string }>({ requestId: crypto.randomUUID() });
  const submitLock = useRef(false);

  const loadWallet = async (): Promise<AdminWalletRow | null> => {
    try {
      setLoadingWallet(true);
      const res = await RepositoryRemote.customerWallet.getWallet(seller.customerId);
      const fresh = res.data?.data as AdminWalletRow;
      setWallet(fresh);
      return fresh;
    } catch (err) {
      handleAxiosError(err);
      return null;
    } finally {
      setLoadingWallet(false);
    }
  };

  useEffect(() => {
    void loadWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amount = Number(amountInput);
  const hasAmount = amountInput.trim() !== '' && Number.isFinite(amount);

  const amountError = (): string => {
    if (!hasAmount) return t('dialog.errors.amountRequired');
    if (!hasAtMostTwoDecimals(amount)) return t('dialog.errors.amountDecimals');
    if (Math.abs(amount) > MAX_AMOUNT) return t('dialog.errors.amountMax');
    if (mode === 'topup' && amount <= 0) return t('dialog.errors.amountSign');
    if (mode === 'adjust' && amount === 0) return t('dialog.errors.amountZero');
    if (mode === 'credit' && amount < 0) return t('dialog.errors.limitNegative');
    if (mode === 'credit' && wallet && amount === wallet.creditLimit) return t('dialog.errors.limitSame');
    return '';
  };
  const noteError = note.trim() ? '' : t('dialog.errors.noteRequired');
  const urlError = mode === 'topup' && attachmentUrl.trim() && !isWebLink(attachmentUrl.trim()) ? t('dialog.errors.urlInvalid') : '';
  const formInvalid = !!amountError() || !!noteError || !!urlError;

  const preview = wallet && hasAmount && !amountError() ? previewWalletOperation(wallet, mode, amount) : null;

  // The tick that slows a big operation down. For a limit it is the INCREASE that counts (lowering a limit is
  // the safe direction and must not be slowed), for money it is the size in either direction.
  const change = mode === 'credit' ? amount - (wallet?.creditLimit ?? 0) : amount;
  const bigAmount = hasAmount && requiresStatementCheck(change) && (mode !== 'credit' || change > 0);

  const goToReview = async () => {
    if (formInvalid) return;
    setError('');
    setAcknowledged(false);
    // Re-read the wallet: the balance in the list (or at open) may be old, and this step decides money.
    const fresh = await loadWallet();
    if (!fresh) return;
    setStep('review');
  };

  const submit = async () => {
    if (submitLock.current || !preview || preview.blocked) return;
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    setConnectionLost(false);
    try {
      const trimmedNote = note.trim();
      const ext = externalTxnId.trim();
      const link = attachmentUrl.trim();
      // `bigAmount` is the same threshold the server now enforces (`requiresStatementCheck`), so the tick the
      // operator gave above has to travel with the request — otherwise the API rejects it.
      const ack = bigAmount ? { largeAmountAck: acknowledged } : {};
      const payload =
        mode === 'topup'
          ? {
              amount,
              note: trimmedNote,
              ...(ext ? { externalTxnId: ext } : {}),
              ...(link ? { attachmentUrl: link } : {}),
              ...ack,
            }
          : mode === 'adjust'
            ? { amount, note: trimmedNote, ...ack }
            : { creditLimit: amount, note: trimmedNote };
      // The key must depend ONLY on what decides money: the mode and the amount. It must NOT depend on
      // note/externalTxnId/attachmentUrl — those are metadata, and the server compares the amount alone when it
      // detects a replay. Including them used to mint a NEW key whenever the operator edited a note after a failed
      // attempt, so fixing a typo in the note after a lost connection wrote the money a SECOND time (`adjust` has
      // no externalTxnId, so the unique index could not catch it either).
      // A genuinely different operation means a different amount here, or a freshly opened dialog (a new mount
      // makes a new key — see the component comment).
      const fingerprint = `${mode}:${amount}`;
      if (attempt.current.fingerprint && attempt.current.fingerprint !== fingerprint) {
        attempt.current = { requestId: crypto.randomUUID() };
      }
      attempt.current.fingerprint = fingerprint;
      const requestId = attempt.current.requestId;

      if (mode === 'credit') {
        const res = await RepositoryRemote.customerWallet.setCreditLimit(seller.customerId, {
          creditLimit: amount,
          note: trimmedNote,
          // Only an INCREASE is slowed down; `bigAmount` already encodes that (see where it is computed).
          ...(bigAmount ? { largeIncreaseAck: acknowledged } : {}),
        });
        const data = res.data?.data as { balance: number; creditLimit: number };
        setDone({ replayed: false, unchanged: false, balance: data.balance, creditLimit: data.creditLimit });
      } else {
        const body = { requestId, ...payload } as Parameters<typeof RepositoryRemote.customerWallet.topup>[1];
        const res =
          mode === 'topup'
            ? await RepositoryRemote.customerWallet.topup(seller.customerId, body)
            : await RepositoryRemote.customerWallet.adjust(
                seller.customerId,
                body as Parameters<typeof RepositoryRemote.customerWallet.adjust>[1],
              );
        const data = res.data?.data as { balance: number; creditLimit: number; txn?: CustomerWalletTxn; replayed?: boolean };
        setDone({
          replayed: !!data.replayed,
          unchanged: false,
          balance: data.txn?.balanceAfter ?? data.balance,
          creditLimit: data.creditLimit,
          txn: data.txn,
        });
      }
      setWrote(true);
      setStep('done');
    } catch (err) {
      // Stay on the review step with the SAME key: pressing again is a safe retry.
      const message = handleAxiosError(err);
      // No response at all: the write may well have gone through, so say that instead of a vague "unknown error".
      const lost = axios.isAxiosError(err) && !err.response;
      setConnectionLost(lost);
      setError(lost ? t('dialog.review.networkError') : message);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const close = () => {
    if (submitting) return;
    if (wrote) onChanged();
    onClose();
  };

  const confirmLabel = t(`dialog.confirm.${mode}`, { amount: formatUsd(amount) });
  const amountLabel = t(
    mode === 'topup' ? 'dialog.fields.amountTopup' : mode === 'adjust' ? 'dialog.fields.amountAdjust' : 'dialog.fields.amountCredit',
  );

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(`dialog.title.${mode}`, { name: seller.name })}</DialogTitle>
          <DialogDescription className="sr-only">{t('dialog.review.heading')}</DialogDescription>
        </DialogHeader>

        {step === 'form' && (
          <div className="space-y-4">
            {wallet && (
              <StatCards
                cols={3}
                items={[
                  { label: t('dialog.current.balance'), value: formatUsd(wallet.balance), tone: wallet.balance < 0 ? 'danger' : 'neutral' },
                  { label: t('dialog.current.creditLimit'), value: formatUsd(wallet.creditLimit) },
                  { label: t('dialog.current.available'), value: formatUsd(wallet.balance + wallet.creditLimit) },
                ]}
              />
            )}

            <div className="space-y-1.5">
              <Label htmlFor="wallet-amount">{amountLabel}</Label>
              <Input
                id="wallet-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                autoFocus
              />
              {mode !== 'topup' && (
                <p className="text-xs text-muted-foreground">{t(mode === 'adjust' ? 'dialog.hints.adjust' : 'dialog.hints.credit')}</p>
              )}
              {amountInput !== '' && amountError() && <p className="text-xs text-tone-danger">{amountError()}</p>}
            </div>

            {mode === 'topup' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="wallet-ext">{t('dialog.fields.externalTxnId')}</Label>
                  <Input id="wallet-ext" value={externalTxnId} onChange={(e) => setExternalTxnId(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t('dialog.hints.externalTxnId')}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wallet-url">{t('dialog.fields.attachmentUrl')}</Label>
                  <Input
                    id="wallet-url"
                    type="url"
                    inputMode="url"
                    value={attachmentUrl}
                    onChange={(e) => setAttachmentUrl(e.target.value)}
                    placeholder="https://"
                  />
                  <p className="text-xs text-muted-foreground">{t('dialog.hints.attachmentUrl')}</p>
                  {urlError && <p className="text-xs text-tone-danger">{urlError}</p>}
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="wallet-note">{t(mode === 'credit' ? 'dialog.fields.noteCredit' : 'dialog.fields.note')}</Label>
              <Input
                id="wallet-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={mode === 'topup' ? t('dialog.hints.notePlaceholderTopup') : undefined}
                maxLength={500}
              />
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={close}>
                {t('dialog.buttons.cancel')}
              </Button>
              <Button onClick={goToReview} disabled={formInvalid || loadingWallet}>
                {loadingWallet && <Loader2 size={16} className="mr-1.5 animate-spin" />}
                {t('dialog.buttons.next')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <p className="text-sm font-medium">{t('dialog.review.heading')}</p>

            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <div className="text-xs text-muted-foreground">{t('dialog.review.amount')}</div>
              <div
                className={cn(
                  'mt-1 text-3xl font-semibold tabular-nums',
                  mode === 'credit' ? 'text-foreground' : amount < 0 ? 'text-tone-danger' : 'text-tone-success',
                )}
              >
                {mode !== 'credit' && amount > 0 ? '+' : ''}
                {formatUsd(amount)}
              </div>
            </div>

            {preview ? (
              <dl className="space-y-2 text-sm">
                <Row label={t('dialog.review.seller')} value={seller.name} />
                <Row
                  label={t('dialog.review.balance')}
                  value={`${formatUsd(preview.balanceBefore)} → ${formatUsd(preview.balanceAfter)}`}
                  emphasis={mode !== 'credit'}
                />
                <Row
                  label={t('dialog.review.limit')}
                  value={`${formatUsd(preview.creditLimitBefore)} → ${formatUsd(preview.creditLimitAfter)}`}
                  emphasis={mode === 'credit'}
                />
                <Row label={t('dialog.review.available')} value={formatUsd(preview.availableAfter)} />
                <Row label={t('dialog.review.note')} value={note.trim()} />
                {mode === 'topup' && (
                  <>
                    <Row label={t('dialog.review.externalTxnId')} value={normalizeExternalTxnId(externalTxnId) ?? t('dialog.review.none')} />
                    <Row label={t('dialog.review.attachment')} value={attachmentUrl.trim() || t('dialog.review.none')} />
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t('dialog.review.loading')}</p>
            )}

            {preview?.blocked && (
              <Notice tone="danger">{t('dialog.review.blocked')}</Notice>
            )}
            {preview && !preview.blocked && preview.overLimitAfter && (
              <Notice tone="warning">{t('dialog.review.overLimit')}</Notice>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            {connectionLost && (
              <Button variant="outline" size="sm" onClick={onViewLedger} disabled={submitting}>
                <BookOpenText size={16} className="mr-1.5" />
                {t('dialog.review.viewLedger')}
              </Button>
            )}

            {bigAmount && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-tone-warning/40 bg-tone-warning/10 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">
                    {t(mode === 'credit' ? 'dialog.review.bigLimit' : 'dialog.review.bigAmount', {
                      threshold: formatUsd(WALLET_BIG_AMOUNT_USD),
                    })}
                  </span>
                  <span>{t(mode === 'credit' ? 'dialog.review.checkLimit' : 'dialog.review.checkStatement')}</span>
                </span>
              </label>
            )}

            {error && <p className="text-xs text-muted-foreground">{t('dialog.review.retryHint')}</p>}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep('form')} disabled={submitting}>
                {t('dialog.buttons.back')}
              </Button>
              <Button
                onClick={submit}
                disabled={submitting || !preview || preview.blocked || (bigAmount && !acknowledged)}
              >
                {submitting && <Loader2 size={16} className="mr-1.5 animate-spin" />}
                {submitting ? t('dialog.buttons.processing') : confirmLabel}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'done' && done && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
              <CheckCircle2 size={20} className={done.replayed ? 'text-tone-warning' : 'text-tone-success'} />
              <div className="space-y-1 text-sm">
                <p className="font-medium">{t(done.replayed ? 'dialog.done.replayed' : 'dialog.done.applied')}</p>
                {mode === 'credit' ? (
                  <p className="text-muted-foreground">
                    {t('dialog.done.creditLimit')}: <span className="font-semibold tabular-nums">{formatUsd(done.creditLimit)}</span>
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {t('dialog.done.balance')}:{' '}
                    {done.txn && (
                      <span className="tabular-nums">
                        {formatUsd(done.txn.balanceBefore)} →{' '}
                      </span>
                    )}
                    <span className="font-semibold tabular-nums">{formatUsd(done.balance)}</span>
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={close}>{t('dialog.buttons.close')}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words text-right tabular-nums', emphasis && 'font-semibold')}>{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'danger' | 'warning'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-sm',
        tone === 'danger' ? 'border-tone-danger/40 bg-tone-danger/10 text-tone-danger' : 'border-tone-warning/40 bg-tone-warning/10',
      )}
    >
      <TriangleAlert size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
