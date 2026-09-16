import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Mail } from 'lucide-react';

import { PATHS } from '@/constants/paths';

import logoUrl from '@/assets/images/logo.png';

const COLUMNS: { titleKey: string; links: { key: string; href?: string; to?: string }[] }[] = [
  {
    titleKey: 'order',
    links: [
      { key: 'how', href: '#how' },
      { key: 'why', href: '#why' },
      { key: 'benefits', href: '#benefits' },
      { key: 'orderGuide', to: PATHS.ORDER_GUIDE },
      { key: 'track', to: PATHS.TRACK },
    ],
  },
  {
    titleKey: 'access',
    links: [
      { key: 'customerRegister', to: PATHS.CUSTOMER_REGISTER },
      { key: 'customerSignIn', to: PATHS.CUSTOMER_LOGIN },
      { key: 'staffSignIn', to: PATHS.LOGIN },
    ],
  },
  {
    titleKey: 'company',
    links: [
      { key: 'team', href: '#team' },
      { key: 'careers', to: PATHS.COMPANY_CAREERS },
    ],
  },
];

function PublicFooter() {
  const { t } = useTranslation('landing');
  const { pathname } = useLocation();

  // Cùng cơ chế `PublicHeader`: ngoài trang chủ thì neo `#...` phải thành `/#...`, không thì bấm không có tác dụng.
  const hashHref = (hash: string) => (pathname === PATHS.LANDING ? hash : `${PATHS.LANDING}${hash}`);

  return (
    <footer className="bg-ink-900 text-white">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center rounded-lg bg-white p-1.5">
                <img src={logoUrl} alt="" className="h-6 w-auto object-contain" />
              </span>
              <span className="font-display text-lg font-medium tracking-tight">{t('brand.name')}</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">{t('footer.description')}</p>

            <div className="mt-6">
              <h3 className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/45">
                {t('footer.locations.title')}
              </h3>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/60">{t('footer.locations.us')}</p>
              <p className="mt-1 max-w-xs text-sm leading-relaxed text-white/60">{t('footer.locations.vn')}</p>
            </div>

            <div className="mt-6">
              <h3 className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/45">
                {t('footer.contact.title')}
              </h3>
              <a
                href={`mailto:${t('footer.contact.email')}`}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-white transition-colors hover:text-brand-300"
              >
                <Mail size={14} className="shrink-0" />
                {t('footer.contact.email')}
              </a>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-white/45">{t('footer.contact.hint')}</p>
            </div>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.titleKey}>
              <h3 className="font-display text-sm font-medium text-white">{t(`footer.columns.${column.titleKey}`)}</h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.key}>
                    {link.to ? (
                      <Link to={link.to} className="text-sm text-white/60 transition-colors hover:text-white">
                        {t(`footer.links.${link.key}`)}
                      </Link>
                    ) : (
                      <a
                        href={hashHref(link.href as string)}
                        className="text-sm text-white/60 transition-colors hover:text-white"
                      >
                        {t(`footer.links.${link.key}`)}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 text-center text-xs text-white/45">
          © {new Date().getFullYear()} {t('footer.copyright')}
        </div>
      </div>
    </footer>
  );
}

export default PublicFooter;
