import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  Ban,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Crown,
  DollarSign,
  Download,
  Factory,
  Medal,
  Package,
  PauseCircle,
  Trophy,
  Truck,
  User as UserIcon,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip as RechartsTooltip } from 'recharts';
import { isPriceHiddenRole } from 'shared';

import { RepositoryRemote } from '@/services';

import { FactoryScopeChip } from '@/components/common/FactoryScopeChip';
import { CancelledOrdersDialog } from '@/components/orders/CancelledOrdersDialog';
import { OrderFilterBar } from '@/components/orders/OrderFilterBar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { useDebounce } from '@/hooks/useDebounce';
import { useFactoryScope } from '@/hooks/useFactoryScope';
import { usePermission } from '@/hooks/usePermission';

import { useAuthStore } from '../../store/authStore';
import { buildSizeMatrixWorkbook, downloadWorkbook } from './exportOrders';

interface MockupSummary {
  url: string;
  originalUrl?: string;
  count: number;
}

interface SizeSummary {
  size: string;
  count: number;
}

interface TypeSummary {
  type: string;
  quantity: number;
  minCost: number;
  maxCost: number;
  productionCost: number;
  shippingCost: number;
  totalCost: number;
  uniqueMockupCount: number;
  duplicateMockupCount: number;
  sizes: SizeSummary[];
  mockups: MockupSummary[];
  duplicateMockups: MockupSummary[];
}

interface MachineTypeBreakdown {
  machineTypeId?: string;
  machineTypeName: string;
  machineTypeShortName?: string;
  quantity: number;
  percentage: number;
}

interface FactoryBreakdown {
  factoryId?: string;
  factoryName: string;
  factoryShortName?: string;
  quantity: number;
  percentage: number;
  byMachineType: MachineTypeBreakdown[];
}

/** Option xưởng cho dropdown — BE trả từ bảng `factories`, không suy từ đơn. */
interface FactoryOption {
  factoryId: string;
  factoryName: string;
  factoryShortName?: string;
}

interface SizeMatrixRow {
  factoryId?: string;
  factoryName: string;
  type: string;
  sizes: SizeSummary[];
}

interface UserBreakdown {
  userSku?: string;
  userEmail?: string;
  orderCount: number;
  totalQuantity: number;
  totalProductionCost: number;
  totalShippingCost: number;
  totalCost: number;
}

interface Dashboard {
  totals: {
    totalOrders: number;
    totalQuantity: number;
    totalProductionCost: number;
    totalShippingCost: number;
    totalCost: number;
    cancelledOrders: number;
    heldOrders: number;
  };
  byType: TypeSummary[];
  byFactory: FactoryBreakdown[];
  sizeMatrix: SizeMatrixRow[];
  factoryOptions: FactoryOption[];
  byUser: UserBreakdown[];
  filter: { startDate?: string; endDate?: string; searchType?: string; searchUser?: string };
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function todayISO(): string {
  // Local date — avoid UTC shift that turns morning hours into yesterday.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Grid template columns for the Production Type table — applied to both the
 * header row and each data row so they line up.
 *
 *   [chevron 32px] [type name flexible] [qty 80] [min 90] [max 90]
 *   [production 110] [shipping 110] [total 100] [mockups 130]
 *
 * `_NO_PRICE` bỏ 5 cột giá (min/max/sản xuất/vận chuyển/tổng) — Designer +
 * Fulfillment chỉ thấy tên/quantity/mockup.
 */
const GRID_COLS_CLASS = 'grid grid-cols-[32px_minmax(180px,1fr)_80px_90px_90px_110px_110px_100px_130px]';
const GRID_COLS_CLASS_NO_PRICE = 'grid grid-cols-[32px_minmax(180px,1fr)_80px_130px]';

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Size matrix (bảng pivot sản phẩm × size). Thứ tự cột chuẩn nội bộ:
 * XS → S → M → L → XL → 2XL …; biến thể XXL/XXXL được normalize về 2XL/3XL để
 * gom chung 1 cột. Size lạ (không nằm trong map) đẩy về cuối (rank 99).
 */
const SIZE_ORDER: Record<string, number> = {
  XS: 0,
  S: 1,
  M: 2,
  L: 3,
  XL: 4,
  '2XL': 5,
  '3XL': 6,
  '4XL': 7,
  '5XL': 8,
  '6XL': 9,
  '7XL': 10,
  '8XL': 11,
};

const SIZE_ALIAS: Record<string, string> = {
  XXL: '2XL',
  XXXL: '3XL',
  XXXXL: '4XL',
  XXXXXL: '5XL',
  XXXXXXL: '6XL',
  XXXXXXXL: '7XL',
  XXXXXXXXL: '8XL',
};

function normalizeSize(raw?: string): string {
  if (!raw || !raw.trim()) return '—';
  const s = raw.trim().toUpperCase();
  return SIZE_ALIAS[s] ?? s;
}

function sizeOrderRank(label: string): number {
  return SIZE_ORDER[label] ?? 99;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  loading?: boolean;
}

function MetricCard({ label, value, sub, icon, loading }: MetricCardProps) {
  if (loading) {
    return <div className="rounded-lg bg-muted/40 animate-pulse h-[68px]" />;
  }

  return (
    <div className="rounded-lg bg-card border border-border px-3 py-2.5 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <span className="opacity-60 shrink-0">{icon}</span>
        <span className="text-[11px] font-medium truncate">{label}</span>
      </div>
      <p className="text-lg font-semibold tracking-tight tabular-nums text-foreground leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{sub}</p>}
    </div>
  );
}

export default function OrderStatsTab() {
  const { t } = useTranslation('dashboard');
  const { profile } = useAuthStore();
  // Hide cost/price stats for Designer + Fulfillment — họ chỉ cần số lượng đơn,
  // không cần thấy doanh thu. Admin/Manager/Support thấy đầy đủ.
  const { roleName } = usePermission();
  // Same list the server enforces (PriceVisibilityInterceptor): the UI only mirrors it.
  const hidePrice = isPriceHiddenRole(roleName);
  // Designer không cần "phân bổ theo xưởng" — họ không quan tâm xưởng nào in.
  // Fulfillment thì vẫn thấy vì cần biết workload từng xưởng.
  const hideFactoryDist = roleName === 'Designer';
  // User gắn với 1 xưởng (vd Fulfillment) → khóa bảng size vào xưởng của họ,
  // không xem được số liệu xưởng khác. Admin/Manager/Support được chọn mọi xưởng.
  const isOverrideRole = ['SuperAdmin', 'Admin', 'Manager', 'SupportManager'].includes(roleName ?? '');
  const lockedFactoryId = !isOverrideRole ? profile?.factoryId : undefined;
  // Xưởng chọn từ cụm menu xưởng ở sidebar. Đã lọc ở BE nên bảng size cũng khóa
  // theo xưởng này — để select mở thì user đổi được xưởng trong khi số liệu
  // xung quanh vẫn của xưởng cũ.
  const factoryScope = useFactoryScope();
  const effectiveLockedFactoryId = lockedFactoryId ?? factoryScope;
  // URL params (prefix `s` = stats). F5 / share link giữ nguyên date + search.
  // Default = today + empty search → strip khỏi URL để URL gọn.
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  // Default range = today only. Widen via the 7d/30d/90d preset chips.
  const [startDate, setStartDate] = useState<string>(() => searchParams.get('sfrom') || todayISO());
  const [endDate, setEndDate] = useState<string>(() => searchParams.get('sto') || todayISO());
  const [searchType, setSearchType] = useState<string>(() => searchParams.get('stype') || '');
  const [searchUser, setSearchUser] = useState<string>(() => searchParams.get('suser') || '');
  // Debounce 300ms — đồng bộ với OrderTableWorkshop/ErrorLogTab/OrderFactoryTab.
  // Tránh refetch mỗi keystroke (BE getDashboard chạy aggregate khá nặng).
  const debouncedType = useDebounce(searchType, 300);
  const debouncedUser = useDebounce(searchUser, 300);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cancelledOpen, setCancelledOpen] = useState(false);

  // Sync state → URL. Date luôn ghi (kể cả today) để URL reflect state.
  // Search strip khi rỗng.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        startDate ? sp.set('sfrom', startDate) : sp.delete('sfrom');
        endDate ? sp.set('sto', endDate) : sp.delete('sto');
        searchType ? sp.set('stype', searchType) : sp.delete('stype');
        searchUser ? sp.set('suser', searchUser) : sp.delete('suser');
        return sp;
      },
      { replace: true },
    );
  }, [startDate, endDate, searchType, searchUser, setSearchParams]);

  const fetchDashboard = async (override?: { searchUser?: string }) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const typeTerm = debouncedType.trim();
      if (typeTerm) params.set('searchType', typeTerm);
      const effectiveSearchUser = override?.searchUser !== undefined ? override.searchUser : debouncedUser;
      if (effectiveSearchUser.trim()) params.set('searchUser', effectiveSearchUser.trim());
      // Cụm menu theo xưởng (`?factoryId=`) → lọc TƯỜNG MINH ở BE, không phải
      // lọc client: mọi KPI/biểu đồ của tab đều phải theo xưởng đó, không riêng
      // bảng size.
      if (factoryScope) params.set('factoryId', factoryScope);
      const resp = await RepositoryRemote.order.getDashboard(`?${params.toString()}`);
      setData(resp.data.data);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  };

  const applyCustomerFilter = (u: { userSku?: string; userEmail?: string }) => {
    const term = u.userEmail || u.userSku || '';
    setSearchUser(term);
    // Override để fetch ngay với term mới (không đợi debounce 300ms).
    fetchDashboard({ searchUser: term });
  };

  // Auto-fetch khi filter đổi — đồng bộ với 4 bảng order khác (không cần nút
  // "Áp dụng" riêng nữa). Date đổi → fetch ngay; search đổi → fetch sau khi
  // debounce settle.
  useEffect(() => {
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, debouncedType, debouncedUser, factoryScope]);

  const toggleExpand = (type: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const totals = data?.totals;

  const dateRangeLabel = useMemo(() => {
    if (!startDate && !endDate) return t('statsTab.allTime');
    return `${startDate || '...'} → ${endDate || '...'}`;
  }, [startDate, endDate, t]);

  // Show dim overlay only on refetches (when we already have data) — not on
  // the initial load, since skeletons handle that.
  const isRefetching = loading && !!data;

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto relative">
      {/* Indeterminate top progress bar — visible on every fetch */}
      <div
        className={cn(
          'absolute top-0 left-0 right-0 h-0.5 overflow-hidden rounded-full bg-primary/10 pointer-events-none transition-opacity duration-200',
          loading ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="h-full w-1/4 bg-primary rounded-full animate-indeterminate-bar" />
      </div>

      {/* Title row — minimal */}
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('statsTab.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('statsTab.trackingProduction', { range: dateRangeLabel.toLowerCase() })}
            {profile?.fullName ? ` · ${t('statsTab.hello', { name: profile.fullName.split(' ')[0] })}` : ''}
          </p>
        </div>
        <div className="text-xs text-muted-foreground hidden sm:flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          {t('statsTab.liveUpdate')}
        </div>
      </div>

      {/* Filter bar — đồng bộ với 4 bảng order khác (`OrderTableWorkshop`,
          `ErrorLogTab`, `OrderFactoryTab`, `OrderStatusTab`). Search chính
          dùng cho `searchType` (tên sản phẩm); filter khách hàng đặt trong
          `topActionsRight` vì stats có 2 search term riêng. */}
      <OrderFilterBar
        search={searchType}
        onSearchChange={setSearchType}
        searchPlaceholder={t('statsTab.filterByProductName')}
        createdFrom={startDate}
        createdTo={endDate}
        onDateRangeChange={(f, t2) => {
          setStartDate(f);
          setEndDate(t2);
        }}
        onReload={() => fetchDashboard()}
        loading={loading}
        topActionsRight={
          <div className="relative min-w-[220px]">
            <UserIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('statsTab.filterBySkuEmail')}
              value={searchUser}
              onChange={(e) => setSearchUser(e.target.value)}
              className="pl-7 h-9 text-sm"
            />
          </div>
        }
        middleRow={<FactoryScopeChip />}
      />

      {/* Compact stats — 4 small boxes when full, only "Tổng đơn" when hidePrice */}
      <div
        className={cn(
          'grid gap-2 transition-opacity duration-300',
          hidePrice ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-4',
          isRefetching && 'opacity-60',
        )}
      >
        <MetricCard
          label={t('statsTab.totalOrders')}
          value={totals ? formatNumber(totals.totalOrders) : '—'}
          sub={totals ? t('statsTab.productsCount', { count: formatNumber(totals.totalQuantity) }) : undefined}
          icon={<Package size={12} />}
          loading={loading && !data}
        />
        {!hidePrice && (
          <>
            <MetricCard
              label={t('statsTab.productionCost')}
              value={totals ? formatCurrency(totals.totalProductionCost) : '—'}
              icon={<Package size={12} />}
              loading={loading && !data}
            />
            <MetricCard
              label={t('statsTab.shippingCost')}
              value={totals ? formatCurrency(totals.totalShippingCost) : '—'}
              icon={<Truck size={12} />}
              loading={loading && !data}
            />
            <MetricCard
              label={t('statsTab.totalCost')}
              value={totals ? formatCurrency(totals.totalCost) : '—'}
              sub={
                totals && totals.totalOrders > 0
                  ? t('statsTab.avgPerOrder', { value: formatCurrency(totals.totalCost / totals.totalOrders) })
                  : undefined
              }
              icon={<DollarSign size={12} />}
              loading={loading && !data}
            />
          </>
        )}
      </div>

      {/* Đơn đã hủy — thống kê riêng, đã loại khỏi mọi số liệu ở trên. Bấm để
          xem danh sách đơn hủy trong khoảng đang lọc. */}
      <button
        type="button"
        onClick={() => setCancelledOpen(true)}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
          totals && totals.cancelledOrders > 0
            ? 'border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20 hover:bg-rose-100/70 dark:hover:bg-rose-950/40'
            : 'border-border bg-card hover:bg-muted/30',
          isRefetching && 'opacity-60',
        )}
      >
        <span
          className={cn(
            'shrink-0',
            totals && totals.cancelledOrders > 0
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-muted-foreground opacity-60',
          )}
        >
          <Ban size={16} />
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">{t('statsTab.cancelledOrders')}</span>
        <span
          className={cn(
            'text-lg font-semibold tabular-nums leading-none',
            totals && totals.cancelledOrders > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground',
          )}
        >
          {totals ? formatNumber(totals.cancelledOrders) : '—'}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {totals && totals.cancelledOrders > 0 ? t('statsTab.viewList') : t('statsTab.noCancelledOrders')}
        </span>
      </button>

      {/* Đơn đang giữ — vẫn nằm trong tổng số liệu (chỉ tạm dừng, chưa loại). */}
      <div
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg border px-3 py-2.5',
          totals && totals.heldOrders > 0
            ? 'border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20'
            : 'border-border bg-card',
          isRefetching && 'opacity-60',
        )}
      >
        <span
          className={cn(
            'shrink-0',
            totals && totals.heldOrders > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground opacity-60',
          )}
        >
          <PauseCircle size={16} />
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">{t('statsTab.heldOrders')}</span>
        <span
          className={cn(
            'text-lg font-semibold tabular-nums leading-none',
            totals && totals.heldOrders > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
          )}
        >
          {totals ? formatNumber(totals.heldOrders) : '—'}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {totals && totals.heldOrders > 0 ? t('statsTab.heldNeedsReopen') : t('statsTab.noHeldOrders')}
        </span>
      </div>

      {/* Factory allocation + Top users — Designer ẩn cả 2 (không quan tâm
          xưởng + không thấy khách hàng), Fulfillment chỉ thấy Factory. */}
      {(!hideFactoryDist || !hidePrice) && (
        <div
          className={cn(
            'grid grid-cols-1 gap-4 transition-opacity duration-300',
            !hidePrice && !hideFactoryDist && 'lg:grid-cols-2',
            isRefetching && 'opacity-60',
          )}
        >
          {!hideFactoryDist && <FactoryDistribution byFactory={data?.byFactory || []} loading={loading} />}
          {!hidePrice && (
            <TopUsersCard
              byUser={data?.byUser || []}
              loading={loading}
              activeUserKey={searchUser.trim()}
              onSelectCustomer={applyCustomerFilter}
              hidePrice={hidePrice}
            />
          )}
        </div>
      )}

      {/* Size matrix — số lượng mỗi size theo từng sản phẩm (bảng pivot, lọc xưởng).
          Đặt TRƯỚC bảng "Chi tiết theo loại sản phẩm" theo yêu cầu. */}
      <SizeMatrixTable
        sizeMatrix={data?.sizeMatrix || []}
        factoryOptions={data?.factoryOptions || []}
        loading={loading}
        isRefetching={isRefetching}
        lockedFactoryId={effectiveLockedFactoryId}
        dateRangeLabel={dateRangeLabel}
      />

      {/* Production type breakdown */}
      <div
        className={cn(
          'rounded-xl border border-border overflow-hidden bg-card transition-opacity duration-300',
          isRefetching && 'opacity-60',
        )}
      >
        <div className="px-5 py-4 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('statsTab.productDetail.title')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t('statsTab.productDetail.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            {searchUser.trim() && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 px-2 py-1 rounded-md">
                <UserIcon size={12} />
                <span className="font-medium">{t('statsTab.customerLabel', { name: searchUser.trim() })}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSearchUser('');
                    fetchDashboard({ searchUser: '' });
                  }}
                  className="ml-1 hover:text-violet-900 dark:hover:text-violet-100"
                  title={t('statsTab.clearCustomerFilter')}
                >
                  ✕
                </button>
              </span>
            )}
            {data && (
              <span className="text-xs text-muted-foreground">
                <span className="tabular-nums font-semibold text-foreground">{data.byType.length}</span>{' '}
                {t('statsTab.productTypesCount')}
              </span>
            )}
          </div>
        </div>

        {/* Scroll container — sticky header + sticky summary inside */}
        <div className="max-h-[600px] overflow-y-auto border-t border-border">
          {/* Column headers */}
          <div
            className={
              (hidePrice ? GRID_COLS_CLASS_NO_PRICE : GRID_COLS_CLASS) +
              ' gap-2 px-3 py-2 bg-muted/40 backdrop-blur text-[10px] tracking-wide font-medium text-muted-foreground items-center sticky top-0 z-20'
            }
          >
            <div></div>
            <div>{t('designerStats.product')}</div>
            <div className="text-right">{t('statsTab.quantity')}</div>
            {!hidePrice && (
              <>
                <div className="text-right">{t('statsTab.min')}</div>
                <div className="text-right">{t('statsTab.max')}</div>
                <div className="text-right">{t('statsTab.production')}</div>
                <div className="text-right">{t('statsTab.shipping')}</div>
                <div className="text-right">{t('statsTab.total')}</div>
              </>
            )}
            <div className="text-center">{t('statsTab.mockup')}</div>
          </div>

          {/* Body */}
          {loading && !data && (
            <div className="divide-y divide-border">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="px-3 py-3 flex items-center gap-3">
                  <div className="w-3 h-3 rounded bg-muted animate-pulse" />
                  <div
                    className="flex-1 h-4 rounded bg-muted/60 animate-pulse"
                    style={{ maxWidth: `${60 - i * 8}%` }}
                  />
                  <div className="w-12 h-4 rounded bg-muted/60 animate-pulse" />
                  <div className="w-16 h-4 rounded bg-muted/60 animate-pulse" />
                  <div className="w-20 h-4 rounded bg-muted/60 animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {!loading && (!data || data.byType.length === 0) && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <Package size={32} className="mx-auto mb-3 opacity-30" strokeWidth={1.5} />
              {t('statsTab.noOrdersInRange')}
            </div>
          )}

          {!loading &&
            data?.byType.map((row) => {
              const isExpanded = expanded.has(row.type);
              return (
                <div key={row.type} className="border-b border-border last:border-b-0">
                  {/* Summary row — sticky to viewport top while THIS group is in view */}
                  <div
                    onClick={() => toggleExpand(row.type)}
                    className={cn(
                      hidePrice ? GRID_COLS_CLASS_NO_PRICE : GRID_COLS_CLASS,
                      'gap-2 px-3 py-2.5 items-center cursor-pointer transition-colors text-sm group',
                      isExpanded
                        ? 'sticky top-[30px] z-10 bg-card shadow-sm border-b border-border'
                        : 'hover:bg-muted/30',
                    )}
                  >
                    <div className="text-muted-foreground">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>
                    <div className="font-medium min-w-0 text-foreground group-hover:text-foreground">
                      <span className="line-clamp-2 leading-snug">{row.type}</span>
                    </div>
                    <div className="text-right font-semibold tabular-nums">{formatNumber(row.quantity)}</div>
                    {!hidePrice && (
                      <>
                        <div className="text-right tabular-nums text-muted-foreground">
                          {formatCurrency(row.minCost)}
                        </div>
                        <div className="text-right tabular-nums text-muted-foreground">
                          {formatCurrency(row.maxCost)}
                        </div>
                        <div className="text-right tabular-nums">{formatCurrency(row.productionCost)}</div>
                        <div className="text-right tabular-nums text-muted-foreground">
                          {formatCurrency(row.shippingCost)}
                        </div>
                        <div className="text-right font-semibold tabular-nums">{formatCurrency(row.totalCost)}</div>
                      </>
                    )}
                    <div className="text-center text-xs">
                      <span className="font-semibold tabular-nums">{row.uniqueMockupCount}</span>
                      {row.duplicateMockupCount > 0 && (
                        <span className="ml-1.5 text-amber-700 dark:text-amber-400">
                          · {t('statsTab.duplicateCount', { count: row.duplicateMockupCount })}
                        </span>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-muted/30">
                      <ExpandedDetails row={row} />
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      <CancelledOrdersDialog
        open={cancelledOpen}
        onClose={() => setCancelledOpen(false)}
        from={startDate}
        to={endDate}
        factoryId={effectiveLockedFactoryId}
      />
    </div>
  );
}

/**
 * Tonal palette — shades of indigo + teal pulled from Tailwind, slightly
 * desaturated. Cohesive look instead of the rainbow effect we had before.
 * Workshop staff scan by VALUE first, color second — so we keep hues calm.
 */
const PIE_COLORS = [
  '#4338ca', // indigo-700
  '#0e7490', // cyan-700
  '#15803d', // green-700
  '#a16207', // yellow-700
  '#7c3aed', // violet-600
  '#0f766e', // teal-700
  '#b45309', // amber-700
  '#9d174d', // pink-800
  '#475569', // slate-600
  '#374151', // gray-700
];

/**
 * Active slice renderer for Recharts Pie.
 *
 * Instead of an ugly black border on the active slice, we "lift" it by
 * extending the outer radius +6px and adding a soft outer ring in the slice's
 * own color (alpha 30%). Looks much cleaner than a stark stroke.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderActiveSlice(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      {/* Outer halo ring — slice color at low alpha for soft glow */}
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 2}
        outerRadius={outerRadius + 10}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.25}
      />
      {/* Lifted main slice */}
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 4}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke="hsl(var(--background))"
        strokeWidth={2}
      />
    </g>
  );
}

type TopLimit = 3 | 5 | 10 | 'all';

/**
 * Generate stable color from a name (so the same user always gets the same
 * avatar tint). Hash string → hue.
 */
function hashColor(str: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 65%, 88%)`,
    text: `hsl(${hue}, 50%, 30%)`,
  };
}

function getInitials(s: string): string {
  const parts = s
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return <Medal size={20} className="fill-amber-400 text-amber-700" strokeWidth={1.5} />;
  }
  if (rank === 2) {
    return <Medal size={20} className="fill-slate-300 text-slate-600" strokeWidth={1.5} />;
  }
  if (rank === 3) {
    return <Medal size={20} className="fill-orange-300 text-orange-700" strokeWidth={1.5} />;
  }
  return <span className="text-sm font-medium text-muted-foreground/60 tabular-nums">{rank}</span>;
}

interface TopUsersCardProps {
  byUser: UserBreakdown[];
  loading: boolean;
  /** Current `searchUser` value — used to highlight the active customer row. */
  activeUserKey: string;
  onSelectCustomer: (u: { userSku?: string; userEmail?: string; displayName: string }) => void;
  /** Designer + Fulfillment không thấy totalCost mỗi row. */
  hidePrice?: boolean;
}

function TopUsersCard({ byUser, loading, activeUserKey, onSelectCustomer, hidePrice }: TopUsersCardProps) {
  const { t } = useTranslation('dashboard');
  const [limit, setLimit] = useState<TopLimit>(5);

  const sliced = limit === 'all' ? byUser : byUser.slice(0, limit);
  const maxOrders = sliced.length > 0 ? sliced[0].orderCount : 1;

  const limitOptions: TopLimit[] = [3, 5, 10, 'all'];

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col">
      <div className="px-5 py-4 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-500/15 flex items-center justify-center">
            <Crown size={18} className="text-violet-600 dark:text-violet-400" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('statsTab.topCustomers.title')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('statsTab.topCustomers.subtitle', { count: byUser.length })}
            </p>
          </div>
        </div>
        <div className="flex items-center bg-muted/40 rounded-md p-0.5">
          {limitOptions.map((opt) => (
            <button
              key={String(opt)}
              type="button"
              onClick={() => setLimit(opt)}
              className={cn(
                'text-xs h-6 px-2 rounded transition-colors tabular-nums',
                limit === opt
                  ? 'bg-background text-foreground shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt === 'all' ? t('drillPanel.all') : opt}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 pb-4 flex-1 overflow-auto max-h-[460px]">
        {loading && !byUser.length && (
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded bg-muted animate-pulse" />
                <div className="w-9 h-9 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 rounded bg-muted/60 animate-pulse" style={{ width: `${60 - i * 5}%` }} />
                  <div className="h-1.5 rounded bg-muted/40 animate-pulse" />
                </div>
                <div className="w-16 h-3 rounded bg-muted/60 animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {!loading && byUser.length === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">
            <Trophy size={28} className="mx-auto mb-2 opacity-30" strokeWidth={1.5} />
            {t('statsTab.topCustomers.noCustomers')}
          </div>
        )}

        {!loading && byUser.length > 0 && (
          <div className="space-y-3.5">
            {sliced.map((u, i) => {
              const ratio = maxOrders > 0 ? (u.orderCount / maxOrders) * 100 : 0;
              const rank = i + 1;
              const displayName = u.userSku || u.userEmail || '?';
              const avatarColors = hashColor(displayName);
              const isActive = !!activeUserKey && (activeUserKey === u.userEmail || activeUserKey === u.userSku);
              return (
                <button
                  key={`${u.userEmail || u.userSku || rank}`}
                  type="button"
                  onClick={() =>
                    onSelectCustomer({
                      userSku: u.userSku,
                      userEmail: u.userEmail,
                      displayName,
                    })
                  }
                  className={cn(
                    'group w-full flex items-center gap-3 -mx-2 px-2 py-1 rounded-md transition-colors text-left cursor-pointer',
                    isActive
                      ? 'bg-violet-100/70 dark:bg-violet-500/15 ring-1 ring-violet-300 dark:ring-violet-500/40'
                      : 'hover:bg-muted/40 active:bg-muted/60',
                  )}
                >
                  {/* Rank — medal for top 3, number for rest */}
                  <div className="w-5 shrink-0 flex items-center justify-center">
                    <RankBadge rank={rank} />
                  </div>

                  {/* Avatar circle with initials */}
                  <div
                    className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold ring-1 ring-black/5"
                    style={{ backgroundColor: avatarColors.bg, color: avatarColors.text }}
                    title={u.userEmail || ''}
                  >
                    {getInitials(displayName)}
                  </div>

                  {/* Name + email + progress bar */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate text-sm leading-tight">{displayName}</p>
                    {u.userEmail && u.userEmail !== displayName && (
                      <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">{u.userEmail}</p>
                    )}
                    <div className="mt-1.5 h-1.5 bg-muted/60 rounded-full overflow-hidden max-w-[200px]">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all"
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                  </div>

                  {/* Count on right */}
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-violet-600 dark:text-violet-400 tabular-nums">
                      {t('drillPanel.orderCount', { count: u.orderCount })}
                    </p>
                    {hidePrice ? (
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {t('statsTab.productsCount', { count: u.totalQuantity })}
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground tabular-nums">{formatCurrency(u.totalCost)}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FactoryDistribution({ byFactory, loading }: { byFactory: FactoryBreakdown[]; loading: boolean }) {
  const { t } = useTranslation('dashboard');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Default to first factory if nothing hovered
  const activeIdx = hoveredIdx ?? 0;
  const activeFactory = byFactory[activeIdx];
  const machineData = activeFactory?.byMachineType || [];

  const factoryChartData = byFactory.map((f) => ({
    name: f.factoryShortName || f.factoryName,
    fullName: f.factoryName,
    value: f.quantity,
    percentage: f.percentage,
  }));

  const machineChartData = machineData.map((m) => ({
    name: m.machineTypeShortName || m.machineTypeName,
    fullName: m.machineTypeName,
    value: m.quantity,
    percentage: m.percentage,
  }));

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col">
      <div className="px-5 py-4">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-500/15 flex items-center justify-center">
              <Factory size={18} className="text-sky-600 dark:text-sky-400" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('statsTab.factoryDist.title')}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{t('statsTab.factoryDist.subtitle')}</p>
            </div>
          </div>
          {byFactory.length > 0 && (
            <span className="text-xs text-muted-foreground">
              <span className="tabular-nums font-semibold text-foreground">{byFactory.length}</span>{' '}
              {t('statsTab.factoryDist.factoryCount')}
            </span>
          )}
        </div>
      </div>

      {loading && !byFactory.length && (
        <div className="px-5 pb-5 grid grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col items-center gap-3">
              <div className="w-[160px] h-[160px] rounded-full bg-muted animate-pulse" />
              <div className="flex gap-2">
                <div className="w-14 h-5 rounded bg-muted animate-pulse" />
                <div className="w-14 h-5 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && byFactory.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <Factory size={32} className="mx-auto mb-3 opacity-30" strokeWidth={1.5} />
          {t('statsTab.factoryDist.noData')}
        </div>
      )}

      {!loading && byFactory.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-5 pb-5">
          {/* Left: Factory pie */}
          <div className="flex flex-col items-center">
            <h3 className="text-xs font-medium text-muted-foreground mb-2">{t('statsTab.factoryDist.factory')}</h3>
            <div className="w-full h-[220px] [&_.recharts-sector]:outline-none [&_.recharts-sector:focus]:outline-none [&_.recharts-pie]:outline-none [&_path:focus]:outline-none [&_path]:outline-none">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={factoryChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    innerRadius={42}
                    paddingAngle={2}
                    activeIndex={activeIdx}
                    activeShape={renderActiveSlice}
                    onMouseEnter={(_, index) => setHoveredIdx(index)}
                  >
                    {factoryChartData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                        stroke="hsl(var(--background))"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {factoryChartData.map((f, i) => {
                const color = PIE_COLORS[i % PIE_COLORS.length];
                const isActive = i === activeIdx;
                return (
                  <button
                    key={f.name}
                    type="button"
                    onMouseEnter={() => setHoveredIdx(i)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer border transition-all',
                      isActive ? 'shadow-sm' : 'border-transparent hover:bg-accent/50',
                    )}
                    style={
                      isActive
                        ? {
                            borderColor: color,
                            backgroundColor: `${color}1a`, // 10% alpha
                          }
                        : undefined
                    }
                  >
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                    <span className="font-medium">{f.name}</span>
                    <span className="text-muted-foreground">· {f.percentage}%</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Machine type pie of active factory */}
          <div className="flex flex-col items-center">
            <h3 className="text-xs font-medium text-muted-foreground mb-2 text-center">
              {t('statsTab.factoryDist.printType')}:{' '}
              <span className="text-foreground font-semibold">{activeFactory?.factoryName || '—'}</span>
            </h3>
            {machineChartData.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
                {t('statsTab.factoryDist.noPrintType')}
              </div>
            ) : (
              <>
                <div className="w-full h-[220px] [&_.recharts-sector]:outline-none [&_.recharts-sector:focus]:outline-none [&_.recharts-pie]:outline-none [&_path:focus]:outline-none [&_path]:outline-none">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={machineChartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        innerRadius={42}
                        paddingAngle={2}
                      >
                        {machineChartData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={PIE_COLORS[(i + 3) % PIE_COLORS.length]}
                            stroke="hsl(var(--background))"
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {machineChartData.map((m, i) => (
                    <span
                      key={m.name}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border border-transparent"
                    >
                      <span
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: PIE_COLORS[(i + 3) % PIE_COLORS.length] }}
                      />
                      <span className="font-medium">{m.name}</span>
                      <span className="text-muted-foreground">· {m.percentage}%</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PieTooltip({ active, payload }: any) {
  const { t } = useTranslation('dashboard');
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-md shadow-md p-2 text-xs">
      <p className="font-semibold text-foreground">{p.fullName}</p>
      <p className="text-muted-foreground">
        {t('statsTab.factoryDist.itemsCount', { count: p.value.toLocaleString() })} · {p.percentage}%
      </p>
    </div>
  );
}

function ExpandedDetails({ row }: { row: TypeSummary }) {
  const { t } = useTranslation('dashboard');
  const [fullView, setFullView] = useState(false);

  // List container: when fullView=true → no max-height (show all inline);
  // when false → compact with scroll.
  const listClass = fullView ? 'space-y-2' : 'space-y-2 max-h-[280px] overflow-y-auto pr-2';

  // Sizes panel is small (typically 3-8 items) → always shown in full.
  // The toggle affects only the heavy Mockup panels.
  return (
    <div className="border-t border-border">
      <div className="flex items-center justify-between px-5 pt-3 pb-1">
        <p className="text-[11px] text-muted-foreground">
          {fullView ? t('statsTab.expandedDetails.allExpanded') : t('statsTab.expandedDetails.collapsedHint')}
        </p>
        <button
          type="button"
          onClick={() => setFullView((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors h-7 px-2"
        >
          {fullView ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
          {fullView ? t('statsTab.expandedDetails.collapse') : t('statsTab.expandedDetails.expandAll')}
        </button>
      </div>

      <div className="p-5 pt-2 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Sizes */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-3 flex items-center justify-between">
            <span>{t('statsTab.expandedDetails.sizeDistribution')}</span>
            <span className="tabular-nums">{t('statsTab.expandedDetails.sizeCount', { count: row.sizes.length })}</span>
          </h4>
          {row.sizes.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('statsTab.expandedDetails.noSizeData')}</p>
          ) : (
            <div className="space-y-1.5">
              {row.sizes.map((s) => {
                const maxCount = Math.max(...row.sizes.map((x) => x.count));
                const pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                return (
                  <div key={s.size} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-medium text-foreground w-10">{s.size}</span>
                      <span className="tabular-nums text-muted-foreground">
                        <span className="font-semibold text-foreground">{s.count}</span>{' '}
                        {t('statsTab.expandedDetails.items')}
                      </span>
                    </div>
                    <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                      <div className="h-full bg-foreground/70 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Mockups */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-3 flex items-center justify-between">
            <span>{t('statsTab.expandedDetails.mockupsUsed')}</span>
            <span className="tabular-nums">
              {t('statsTab.expandedDetails.mockupCount', { count: row.mockups.length })}
            </span>
          </h4>
          {row.mockups.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('statsTab.expandedDetails.noMockups')}</p>
          ) : (
            <div className={listClass}>
              {row.mockups.map((m) => (
                <a
                  key={m.url}
                  href={m.originalUrl || m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 group"
                >
                  <img
                    src={m.url}
                    alt="mockup"
                    className="w-10 h-10 object-contain rounded border border-border bg-checker bg-checker-sm shrink-0"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-muted-foreground truncate font-mono group-hover:text-foreground">
                      {m.url.split('/').pop()}
                    </p>
                    <Badge variant={m.count > 1 ? 'warning' : 'secondary'} className="mt-0.5">
                      ×{m.count}
                    </Badge>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Duplicate mockups */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-3 flex items-center justify-between">
            <span>{t('statsTab.expandedDetails.duplicateMockups')}</span>
            {row.duplicateMockups.length > 0 ? (
              <span className="tabular-nums text-amber-700 dark:text-amber-400">
                {t('statsTab.duplicateCount', { count: row.duplicateMockups.length })}
              </span>
            ) : (
              <span className="tabular-nums text-emerald-700 dark:text-emerald-400">
                {t('statsTab.expandedDetails.none')}
              </span>
            )}
          </h4>
          {row.duplicateMockups.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('statsTab.expandedDetails.noDuplicates')}</p>
          ) : (
            <div className={listClass}>
              {row.duplicateMockups.map((m) => (
                <a
                  key={m.url}
                  href={m.originalUrl || m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 p-2 rounded bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/20"
                >
                  <img
                    src={m.url}
                    alt="dup"
                    className="w-10 h-10 object-contain rounded border border-border bg-checker bg-checker-sm shrink-0"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-muted-foreground truncate font-mono">{m.url.split('/').pop()}</p>
                    <Badge variant="warning" className="mt-0.5">
                      {t('statsTab.expandedDetails.usedCount', { count: m.count })}
                    </Badge>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Bảng pivot: mỗi dòng là 1 sản phẩm (type), mỗi cột là 1 size, ô = số lượng.
 * Cột cuối = Tổng của dòng, dòng cuối = Tổng của cột. Dữ liệu từ `sizeMatrix`
 * (group sẵn theo factory × type × size ở BE) — không cần gọi API mới.
 *
 * Lọc xưởng: dropdown "Tất cả xưởng" + từng xưởng. User gắn 1 xưởng
 * (`lockedFactoryId`) bị khóa vào xưởng đó, không xem được xưởng khác.
 */
function SizeMatrixTable({
  sizeMatrix,
  factoryOptions,
  loading,
  isRefetching,
  lockedFactoryId,
  dateRangeLabel,
}: {
  sizeMatrix: SizeMatrixRow[];
  factoryOptions: FactoryOption[];
  loading: boolean;
  isRefetching: boolean;
  lockedFactoryId?: string;
  dateRangeLabel: string;
}) {
  const { t } = useTranslation('dashboard');
  // Danh sách xưởng cho dropdown = ĐỦ xưởng đang bật (BE trả `factoryOptions`,
  // đọc thẳng bảng `factories`) HỢP với xưởng suy từ dữ liệu — nếu chỉ distinct
  // từ `sizeMatrix` thì xưởng chưa có đơn trong kỳ biến mất khỏi select.
  const factories = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of factoryOptions) map.set(f.factoryId, f.factoryName);
    for (const r of sizeMatrix) {
      const id = r.factoryId || '__unmapped__';
      if (!map.has(id)) map.set(id, r.factoryName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [sizeMatrix, factoryOptions]);

  // Xưởng đang chọn. '' = tất cả. User bị khóa → ép về xưởng của họ.
  const [selectedFactory, setSelectedFactory] = useState<string>('');
  const effectiveFactory = lockedFactoryId ?? selectedFactory;

  const { columns, rows, colTotals, grandTotal } = useMemo(() => {
    // Lọc theo xưởng (nếu có), rồi pivot type × size — cộng dồn qua các xưởng
    // còn lại (khi xem "Tất cả").
    const scoped = effectiveFactory
      ? sizeMatrix.filter((r) => (r.factoryId || '__unmapped__') === effectiveFactory)
      : sizeMatrix;

    const colSet = new Set<string>();
    const typeMap = new Map<string, { counts: Record<string, number>; total: number }>();
    for (const r of scoped) {
      let entry = typeMap.get(r.type);
      if (!entry) {
        entry = { counts: {}, total: 0 };
        typeMap.set(r.type, entry);
      }
      for (const s of r.sizes) {
        const label = normalizeSize(s.size);
        entry.counts[label] = (entry.counts[label] ?? 0) + s.count;
        entry.total += s.count;
        colSet.add(label);
      }
    }

    const rows = [...typeMap.entries()]
      .map(([type, v]) => ({ type, counts: v.counts, total: v.total }))
      .sort((a, b) => b.total - a.total);
    const columns = [...colSet].sort((a, b) => sizeOrderRank(a) - sizeOrderRank(b) || a.localeCompare(b));
    const colTotals: Record<string, number> = {};
    let grandTotal = 0;
    for (const c of columns) {
      let sum = 0;
      for (const r of rows) sum += r.counts[c] ?? 0;
      colTotals[c] = sum;
      grandTotal += sum;
    }
    return { columns, rows, colTotals, grandTotal };
  }, [sizeMatrix, effectiveFactory]);

  const isEmpty = rows.length === 0;
  const lockedFactoryName = lockedFactoryId ? factories.find((f) => f.id === lockedFactoryId)?.name : undefined;

  const handleExport = () => {
    const factoryLabel = effectiveFactory
      ? factories.find((f) => f.id === effectiveFactory)?.name || t('statsTab.sizeMatrix.factory')
      : t('statsTab.sizeMatrix.allFactories');
    const title = `${t('statsTab.sizeMatrix.exportTitle')} — ${factoryLabel} — ${dateRangeLabel}`;
    const wb = buildSizeMatrixWorkbook({ title, columns, rows, colTotals, grandTotal });
    const slug = factoryLabel
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    downloadWorkbook(`so-luong-theo-size_${slug || 'all'}.xlsx`, wb);
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-border overflow-hidden bg-card transition-opacity duration-300',
        isRefetching && 'opacity-60',
      )}
    >
      <div className="px-5 py-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('statsTab.sizeMatrix.title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('statsTab.sizeMatrix.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Factory filter — locked users thấy nhãn cố định, còn lại thấy dropdown */}
          {lockedFactoryId ? (
            <span className="inline-flex items-center gap-1.5 text-xs bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2.5 py-1.5 rounded-md">
              <Factory size={12} />
              <span className="font-medium">{lockedFactoryName || t('statsTab.sizeMatrix.myFactory')}</span>
            </span>
          ) : (
            <div className="relative">
              <Factory
                size={13}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <select
                value={selectedFactory}
                onChange={(e) => setSelectedFactory(e.target.value)}
                className="h-8 pl-7 pr-7 text-xs rounded-md border border-border bg-background text-foreground appearance-none cursor-pointer hover:bg-muted/30 transition-colors min-w-[160px]"
              >
                <option value="">{t('statsTab.sizeMatrix.allFactories')}</option>
                {factories.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          )}
          {!loading && !isEmpty && (
            <span className="text-xs text-muted-foreground">
              {t('statsTab.sizeMatrix.total')}:{' '}
              <span className="tabular-nums font-semibold text-foreground">{formatNumber(grandTotal)}</span>{' '}
              {t('statsTab.sizeMatrix.products')}
            </span>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={isEmpty}
            title={t('statsTab.sizeMatrix.exportButtonTitle')}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border transition-colors',
              isEmpty
                ? 'border-border text-muted-foreground/40 cursor-not-allowed'
                : 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 cursor-pointer',
            )}
          >
            <Download size={13} />
            {t('factoryTab.exportExcel')}
          </button>
        </div>
      </div>

      <div className="max-h-[600px] overflow-auto border-t border-border">
        {loading && sizeMatrix.length === 0 ? (
          <div className="p-6 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 rounded bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            <Package size={32} className="mx-auto mb-3 opacity-30" strokeWidth={1.5} />
            {sizeMatrix.length === 0
              ? t('statsTab.noOrdersInRange')
              : t('statsTab.sizeMatrix.noFactoryData')}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/40 backdrop-blur text-[11px] tracking-wide font-medium text-muted-foreground">
                <th className="sticky left-0 top-0 z-20 bg-muted/40 text-left px-3 py-2 min-w-[220px] border-b border-border">
                  {t('designerStats.product')}
                </th>
                {columns.map((c) => (
                  <th
                    key={c}
                    className="sticky top-0 z-10 bg-muted/40 text-right px-3 py-2 w-14 font-mono border-b border-border"
                  >
                    {c}
                  </th>
                ))}
                <th className="sticky right-0 top-0 z-20 bg-muted/40 text-right px-3 py-2 w-16 border-b border-border">
                  {t('statsTab.total')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.type} className="hover:bg-muted/30 transition-colors">
                  <td className="sticky left-0 z-10 bg-card text-foreground px-3 py-2 align-top">
                    <span className="line-clamp-2 leading-snug font-medium">{r.type}</span>
                  </td>
                  {columns.map((c) => {
                    const v = r.counts[c] ?? 0;
                    return (
                      <td
                        key={c}
                        className={cn(
                          'text-right px-3 py-2 tabular-nums',
                          v === 0 ? 'text-muted-foreground/40' : 'text-foreground',
                        )}
                      >
                        {v === 0 ? '–' : formatNumber(v)}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-card text-right px-3 py-2 tabular-nums font-semibold">
                    {formatNumber(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-semibold text-foreground border-t-2 border-border">
                <td className="sticky left-0 z-10 bg-muted/40 px-3 py-2">{t('statsTab.total')}</td>
                {columns.map((c) => (
                  <td key={c} className="text-right px-3 py-2 tabular-nums">
                    {formatNumber(colTotals[c])}
                  </td>
                ))}
                <td className="sticky right-0 z-10 bg-muted/40 text-right px-3 py-2 tabular-nums">
                  {formatNumber(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
