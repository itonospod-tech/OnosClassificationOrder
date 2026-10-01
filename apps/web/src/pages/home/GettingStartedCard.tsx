import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, ChevronDown, ChevronRight, FileText, PackageSearch, Store } from 'lucide-react';

import { PATHS } from '@/constants/paths';

import { usePermission } from '@/hooks/usePermission';

import { cn } from '@/utils/cn';

const COLLAPSED_KEY = 'onos.dashboard.gettingStarted.collapsed';

interface GuideLink {
  key: string;
  to: string;
  icon: React.ReactNode;
  /** Permission code needed to open the page; omitted = public page. */
  perm?: string;
}

/**
 * "Getting started" block on top of the Dashboard — modelled on the legacy OnosPod
 * dashboard, which kept its guides here rather than in the sidebar
 * (MenuRestructure-CEO.md §8.2 #4). It is the replacement entry point for the DTF
 * role guide once that leaves the sidebar (§9.1), so it must exist BEFORE the
 * menu entry is removed.
 *
 * Collapsing is a per-viewer convenience only, remembered in localStorage; when
 * storage is unavailable the block simply starts expanded.
 */
export default function GettingStartedCard() {
  const { t } = useTranslation('dashboard');
  const { has, isAdmin } = usePermission();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Storage blocked (private window etc.) — the toggle still works for this visit.
      }
      return next;
    });
  };

  const links: GuideLink[] = [
    { key: 'dtfGuide', to: PATHS.DTF_GUIDE, icon: <BookOpen size={18} />, perm: 'page.guide_dtf' },
    { key: 'orderGuide', to: PATHS.ORDER_GUIDE, icon: <FileText size={18} /> },
    { key: 'catalog', to: PATHS.CATALOG, icon: <Store size={18} /> },
    { key: 'track', to: PATHS.TRACK, icon: <PackageSearch size={18} /> },
  ];
  const visible = links.filter((l) => !l.perm || isAdmin || has(l.perm));
  if (visible.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-4 py-3 text-left bg-transparent border-none cursor-pointer"
      >
        {collapsed ? (
          <ChevronRight size={16} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={16} className="text-muted-foreground" />
        )}
        <span className="text-sm font-semibold text-foreground">{t('gettingStarted.title')}</span>
        {!collapsed && (
          <span className="hidden text-xs text-muted-foreground sm:inline">{t('gettingStarted.subtitle')}</span>
        )}
      </button>
      {!collapsed && (
        <ul className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((l) => (
            <li key={l.key}>
              <Link
                to={l.to}
                className={cn(
                  'group flex h-full items-start gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors',
                  'hover:border-indigo-300 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
                )}
              >
                <span className="mt-0.5 text-indigo-600 dark:text-indigo-400">{l.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                    {t(`gettingStarted.links.${l.key}.title`)}
                    <ArrowRight
                      size={14}
                      className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t(`gettingStarted.links.${l.key}.description`)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
