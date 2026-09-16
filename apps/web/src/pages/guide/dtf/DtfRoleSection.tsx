import React from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArrowRight, Info, ListOrdered, RotateCcw } from 'lucide-react';

import { cn } from '@/utils/cn';

import type { DtfFlowNodeId, DtfRole, DtfRoleId } from './dtfGuideRoles';
import { dtfRoleAnchorId, dtfStepAnchorId, isDtfRoleId, TOC_MIN_STEPS } from './dtfGuideRoles';
import { pickerOffset, scrollToElement } from './dtfScroll';
import DtfStepBlock from './DtfStepBlock';

interface HandoffProps {
  label: string;
  text: string;
  nodes?: DtfFlowNodeId[];
  onSelectRole?: (id: DtfRoleId) => void;
}

function Handoff({ label, text, nodes = [], onSelectRole }: HandoffProps) {
  const { t } = useTranslation('dtfGuide');
  const roleNodes = nodes.filter(isDtfRoleId);
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-relaxed text-foreground">{text}</dd>
      {roleNodes.length > 0 && onSelectRole && (
        <dd className="mt-2 flex flex-wrap gap-1.5">
          {roleNodes.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelectRole(id)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowRight size={12} aria-hidden />
              {t('section.openRole', { role: t(`roles.${id}.short`) })}
            </button>
          ))}
        </dd>
      )}
    </div>
  );
}

interface ListBlockProps {
  title: string;
  icon: LucideIcon;
  items: string[];
  tone: 'error' | 'note';
}

function ListBlock({ title, icon: Icon, items, tone }: ListBlockProps) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border p-4',
        tone === 'error'
          ? 'border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20'
          : 'border-sky-200 bg-sky-50/50 dark:border-sky-900/60 dark:bg-sky-950/20',
      )}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon size={16} aria-hidden className={tone === 'error' ? 'text-red-500' : 'text-sky-600'} />
        {title}
      </h3>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-relaxed text-foreground">
            <span
              aria-hidden
              className={cn('mt-2 h-1.5 w-1.5 shrink-0 rounded-full', tone === 'error' ? 'bg-red-400' : 'bg-sky-500')}
            />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface DtfRoleSectionProps {
  role: DtfRole;
  /** Chuyển vai từ nút trong phần này — nút sẽ bị gỡ khỏi DOM nên trang tự đưa focus về tiêu đề vai mới. */
  onSelectRole: (id: DtfRoleId) => void;
}

/** Hướng dẫn một vai: mục tiêu, nhận/giao, (mục lục), các bước, khi có lỗi, lưu ý. */
function DtfRoleSection({ role, onSelectRole }: DtfRoleSectionProps) {
  const { t } = useTranslation('dtfGuide');
  const base = `roles.${role.id}`;
  const Icon = role.icon;
  const anchorId = dtfRoleAnchorId(role.id);
  const total = role.steps.length;

  const scrollToStep = (stepId: string) => {
    scrollToElement(document.getElementById(dtfStepAnchorId(role.id, stepId)), pickerOffset());
  };

  return (
    <section id={anchorId} aria-labelledby={`${anchorId}-title`} className="min-w-0 scroll-mt-20 space-y-8">
      <header className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2
              id={`${anchorId}-title`}
              tabIndex={-1}
              className="break-words text-xl font-semibold text-foreground focus:outline-none"
            >
              {t(`${base}.name`)}
            </h2>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('section.goal')} · {t('section.stepCount', { n: total })}
            </p>
            <p className="mt-1.5 max-w-3xl break-words text-sm leading-relaxed text-muted-foreground">
              {t(`${base}.goal`)}
            </p>
          </div>
        </div>

        {role.alert && (
          <div
            role="note"
            className="mt-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm leading-relaxed text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" aria-hidden />
            <p className="min-w-0 break-words">{t(`${base}.alert`)}</p>
          </div>
        )}

        <dl className="mt-4 grid gap-3 md:grid-cols-3">
          <Handoff label={t('section.entry')} text={t(`${base}.entry`)} />
          <Handoff label={t('section.from')} text={t(`${base}.from`)} nodes={role.from} onSelectRole={onSelectRole} />
          <Handoff label={t('section.to')} text={t(`${base}.to`)} nodes={role.to} onSelectRole={onSelectRole} />
        </dl>
      </header>

      {total >= TOC_MIN_STEPS && (
        <nav aria-label={t('section.toc')} className="rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ListOrdered size={16} className="text-muted-foreground" aria-hidden />
            {t('section.toc')}
          </p>
          <ol className="mt-2 grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
            {role.steps.map((step, i) => (
              <li key={step.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => scrollToStep(step.id)}
                  className="flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 break-words">{t(`${base}.steps.${step.id}.title`)}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <ol aria-label={t('section.steps')} className="min-w-0 space-y-14 lg:space-y-16">
        {role.steps.map((step, i) => (
          <li key={step.id} className="min-w-0">
            <DtfStepBlock roleId={role.id} step={step} index={i} total={total} eager={i === 0} />
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        <ListBlock
          tone="error"
          icon={RotateCcw}
          title={t('section.errors')}
          items={role.errorKeys.map((k) => t(`${base}.errors.${k}`))}
        />
        <ListBlock
          tone="note"
          icon={Info}
          title={t('section.notes')}
          items={role.noteKeys.map((k) => t(`${base}.notes.${k}`))}
        />
      </div>
    </section>
  );
}

export default DtfRoleSection;
