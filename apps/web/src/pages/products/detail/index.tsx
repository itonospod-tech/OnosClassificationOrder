import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Factory,
  ImageIcon,
  Info,
  Layers,
  Plus,
  Printer,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ProductItemSpecific,
  ProductLine,
  ProductPrintArea,
  ProductPrintAreaItem,
  ProductVariation,
} from 'shared';
import {
  collectVariationSizes,
  PRINT_AREA_MAX_WIDTH_CM,
  PRODUCT_LEVELS,
  PRODUCT_PRINT_AREAS,
  ProductConfigStatus,
  WorkshopConfigCategory,
} from 'shared';
import { toast } from 'sonner';

import { PATHS } from '@/constants/paths';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { useConfirm } from '@/components/common/ConfirmDialog';
import { RichTextEditor } from '@/components/common/RichTextEditor';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { handleAxiosError } from '@/utils';
import { sortCategoryTree } from '@/utils/categoryTree';
import { cn } from '@/utils/cn';
import { PRODUCT_LINE_OPTIONS, productLineLabel } from '@/utils/productLine';

import type { ProductConfigRow, RefItem } from '../ProductConfigTab';
import { buildStatusMeta } from '../ProductConfigTab';
import { BatchEditBar } from '../productForm/BatchEditBar';
import { BulkGeneratePopover } from '../productForm/BulkGeneratePopover';
import type { GalleryImage } from '../productForm/MockupImagesEditor';
import { galleryImageSrc, MockupImagesEditor } from '../productForm/MockupImagesEditor';
import { VariantsTable } from '../productForm/VariantsTable';
import type { VariationGroup } from '../productForm/variantUtils';
import {
  buildCombos,
  cleanGroups,
  computeVariationSku,
  deriveGroups,
  generateVariants,
  matchesSelection,
  VARIANT_GROUP_MAX,
  VARIANTS_MAX,
} from '../productForm/variantUtils';
import { VariationItem } from '../productForm/VariationItem';

const selectCls =
  'w-full rounded-md border border-input bg-background px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** Ảnh đơn (bảng size) — CHỈ preview local khi chọn, upload thật ở `handleSave` (deferred, xem §2.4a Products.md). */
function ImageUploadField({
  value,
  pendingFile,
  onFileSelected,
  aspectClassName,
}: {
  value: string;
  pendingFile: File | null;
  onFileSelected: (file: File) => void;
  aspectClassName: string;
}) {
  const { t } = useTranslation('products');
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const displayValue = previewUrl || value;

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          'relative w-full rounded-md border border-border bg-muted overflow-hidden group',
          aspectClassName,
        )}
        title={t('detail.imageUpload.title')}
      >
        {displayValue ? (
          <img src={displayValue} alt="preview" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground border border-dashed border-border rounded-md">
            <ImageIcon size={22} />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <span className="flex items-center gap-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100">
            <Upload size={14} /> {pendingFile ? t('detail.imageUpload.change') : t('detail.imageUpload.choose')}
          </span>
        </div>
      </button>
      {pendingFile && <p className="text-[11px] text-amber-600">{t('detail.imageUpload.pendingHint')}</p>}
    </div>
  );
}

type SectionId = 'sec-production' | 'sec-detail' | 'sec-variants' | 'sec-print-areas';

interface SectionMeta {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  desc: string;
  tile: string;
  accent: string;
}

/**
 * Trang chi tiết 1-trang-dọc: tab sticky chỉ là ANCHOR NAV (click scroll tới
 * section, cuộn tay thì scrollspy tự sáng tab). Mỗi section 1 màu nhận diện
 * riêng (icon tile + viền trái) để phân vùng rõ ràng.
 */
const buildSections = (t: TFunction<'products'>): SectionMeta[] => [
  {
    id: 'sec-production',
    label: t('detail.sections.production.label'),
    icon: Factory,
    desc: t('detail.sections.production.desc'),
    tile: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300',
    accent: 'border-l-indigo-400',
  },
  {
    id: 'sec-detail',
    label: t('detail.sections.details.label'),
    icon: Info,
    desc: t('detail.sections.details.desc'),
    tile: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300',
    accent: 'border-l-sky-400',
  },
  {
    id: 'sec-variants',
    label: t('detail.sections.variants.label'),
    icon: Layers,
    desc: t('detail.sections.variants.desc'),
    tile: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
    accent: 'border-l-violet-400',
  },
  {
    id: 'sec-print-areas',
    label: t('detail.sections.printAreas.label'),
    icon: Printer,
    desc: t('detail.sections.printAreas.desc'),
    tile: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
    accent: 'border-l-amber-400',
  },
];

function SectionCard({
  meta,
  number,
  badge,
  children,
}: {
  meta: SectionMeta;
  number: number;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={meta.id}
      className={`scroll-mt-36 rounded-lg border border-border border-l-4 ${meta.accent} bg-card shadow-sm`}
    >
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-muted/40 rounded-tr-lg">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.tile}`}>
          <meta.icon size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="text-muted-foreground font-normal">{number}.</span> {meta.label}
            {badge && (
              <Badge variant="secondary" className="font-normal">
                {badge}
              </Badge>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{meta.desc}</p>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * Bỏ ô rỗng khỏi bản nháp trước khi so dirty: ô người dùng gõ rồi xoá trắng phải
 * quay về ĐÚNG trạng thái ban đầu, không được kẹt lại thành "có thay đổi".
 */
const pruneSizeDimDraft = (draft: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) {
    const text = (value ?? '').trim();
    if (text) out[key] = text;
  }
  return out;
};

/**
 * PRD-8 vòng 2 — bỏ thứ Mongo gắn thêm (`_id` của từng subdoc) khỏi cặp
 * label/value trước khi đưa vào form.
 *
 * Vì sao cần: `attributes` lấy thẳng từ API mang theo `_id`, còn khi bảng biến
 * thể được dựng lại (`generateVariants`, chạy mỗi lần áp nhóm option) thì mỗi
 * thuộc tính được viết lại thành ĐÚNG `{label, value}`. Hai hình dạng khác nhau
 * cho cùng một dữ liệu ⇒ thêm một biến thể rồi xoá đi, bảng về y như cũ nhưng
 * chuỗi so sánh vẫn lệch ⇒ badge "Chưa lưu" không tắt.
 *
 * Đây KHÔNG phải loại một trường khỏi phép so sánh: `_id` của subdoc không phải
 * dữ liệu người dùng, form không sửa nó, và bản PATCH gửi lên vốn đã không mang
 * nó theo sau lần dựng lại đầu tiên. Chuẩn hoá NGAY LÚC NẠP để state và baseline
 * cùng một hình dạng từ đầu; label/value giữ nguyên từng ký tự.
 */
const toFormSpecifics = (list?: ProductItemSpecific[]): ProductItemSpecific[] =>
  (list ?? []).map(({ label, value }) => ({ label, value }));

const toFormVariations = (list?: ProductVariation[]): ProductVariation[] =>
  (list ?? []).map((v) => (v.attributes ? { ...v, attributes: toFormSpecifics(v.attributes) } : v));

/** Khoá 1 ô nhập kích thước in: vị trí in + size + chiều. */
const sizeDimKey = (areaKey: string, size: string, dim: 'w' | 'l'): string => `${areaKey}::${size}::${dim}`;

/** Đổ số đã lưu ra chữ để hiển thị trong ô nhập (dùng cho cả state lẫn baseline dirty). */
const buildSizeDimDraft = (printArea: ProductPrintArea): Record<string, string> => {
  const draft: Record<string, string> = {};
  for (const area of printArea) {
    for (const dim of area.sizeDimensions || []) {
      draft[sizeDimKey(area.key, dim.size, 'w')] = String(dim.widthCm);
      draft[sizeDimKey(area.key, dim.size, 'l')] = String(dim.lengthCm);
    }
  }
  return draft;
};

/**
 * Đọc số cm người dùng gõ. `null` = để trống (hợp lệ), `NaN` = gõ bậy (chặn lưu).
 * Nhận cả dấu phẩy thập phân vì bàn phím tiếng Việt hay ra dấu phẩy.
 */
const parseCm = (raw: string): number | null => {
  const text = raw.trim().replace(',', '.');
  if (!text) return null;
  return Number(text);
};

/**
 * Lỗi của MỘT ô kích thước xét riêng nó (không xét cặp) — dùng cho lúc gõ. Ca
 * "có rộng mà thiếu dài" cần nhìn cả hàng nên vẫn nằm ở `handleSave`.
 */
const describeSizeDimCell = (raw: string, dim: 'w' | 'l', t: TFunction): string | null => {
  const value = parseCm(raw);
  if (value === null) return null;
  if (!Number.isFinite(value) || value <= 0) return t('detail.printAreaConfig.sizeDims.errorPositive');
  // HF-1 — trần 58cm KHÔNG còn xét riêng ô rộng: một chiều vượt 58 vẫn in được vì
  // quay ngang là vừa bề ngang giấy. Chỉ khi CẢ HAI chiều cùng vượt mới là không
  // in được, mà ca đó phải nhìn cả cặp nên nằm ở `describeSizeDimPair`.
  return null;
};

/**
 * HF-1 — lỗi xét CẢ CẶP rộng/dài. Giấy DTF rộng 58cm nhưng dài vô hạn, nên khối
 * 70x40 vẫn in được (quay ngang); chỉ khi cả hai chiều cùng vượt 58 thì quay kiểu
 * nào cũng không lọt bề ngang giấy.
 */
const describeSizeDimPair = (width: number | null, length: number | null, t: TFunction): string | null => {
  if (width === null || length === null) return null;
  if (!Number.isFinite(width) || !Number.isFinite(length)) return null;
  if (Math.min(width, length) > PRINT_AREA_MAX_WIDTH_CM) {
    return t('detail.printAreaConfig.sizeDims.errorMaxWidth', { max: PRINT_AREA_MAX_WIDTH_CM });
  }
  return null;
};

/** Form fields quan tâm khi so sánh dirty — không gồm data chỉ để hiển thị (factory/machineType/productCategory object). */
interface FormSnapshot {
  fullName: string;
  shortName: string;
  designReviewCode: string;
  designReviewTemplateUrl: string;
  /**
   * PRD-7 vòng 3 — CHỮ THÔ trong các ô kích thước in phải nằm trong snapshot dirty.
   * Trước đó chỉ cặp rộng+dài HỢP LỆ mới vào `printArea`, nên gõ giá trị SAI ("59",
   * "abc", "-5") không làm form bẩn ⇒ nút Lưu vẫn xám ⇒ `handleSave` không bao giờ
   * chạy ⇒ không có lỗi nào hiện ra, và rời trang thì chữ vừa gõ mất im lặng.
   */
  sizeDimDraft: Record<string, string>;
  sku: string;
  slug: string;
  status: ProductConfigStatus;
  machineNumber: string;
  galleryUrls: string[];
  level: string;
  fabricType: string;
  toolResult: string;
  guide: string;
  factoryId: string;
  machineTypeId: string;
  productCategoryId: string;
  /** PRD-8 — dòng sản phẩm ('' = chưa gắn). */
  productLine: string;
  productLineSource: string;
  collectionIds: string[];
  productTagIds: string[];
  productTechniqueIds: string[];
  printMethod: string;
  printArea: ProductPrintArea;
  printDocument: string;
  printTemplate: string;
  sizeChartUrl: string;
  description: string;
  shortDescription: string;
  templateDescription: string;
  maxProductionTime: string;
  maxShippingTime: string;
  hideForSeller: boolean;
  enableDesignCheck: boolean;
  enableAffiliate: boolean;
  itemSpecifics: ProductItemSpecific[];
  weight: string;
  width: string;
  height: string;
  length: string;
  variations: ProductVariation[];
}

export default function ProductDetailPage() {
  const { t } = useTranslation(['products', 'common']);
  const { confirm, confirmDialog } = useConfirm();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const STATUS_META = useMemo(() => buildStatusMeta(t), [t]);
  const SECTIONS = useMemo(() => buildSections(t), [t]);

  const [item, setItem] = useState<ProductConfigRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('sec-production');
  // Đang smooth-scroll do click tab → tạm khóa scrollspy để tab không nhấp nháy.
  const clickScrollUntil = useRef(0);

  const [factories, setFactories] = useState<RefItem[]>([]);
  const [machineTypes, setMachineTypes] = useState<RefItem[]>([]);
  const [productCategoryOptions, setProductCategoryOptions] = useState<RefItem[]>([]);
  const [collectionOptions, setCollectionOptions] = useState<RefItem[]>([]);
  const [tagOptions, setTagOptions] = useState<RefItem[]>([]);
  const [techniqueOptions, setTechniqueOptions] = useState<RefItem[]>([]);
  const fabricOptions = useWorkshopConfigStore((s) => s.byCategory[WorkshopConfigCategory.FabricType] || []);
  const toolOptions = useWorkshopConfigStore((s) => s.byCategory[WorkshopConfigCategory.ToolResult] || []);
  const printMethodOptions = useWorkshopConfigStore((s) => s.byCategory[WorkshopConfigCategory.PrintMethod] || []);
  const loadConfig = useWorkshopConfigStore((s) => s.load);
  const configLoaded = useWorkshopConfigStore((s) => s.loaded);

  const [fullName, setFullName] = useState('');
  const [shortName, setShortName] = useState('');
  const [designReviewCode, setDesignReviewCode] = useState('');
  const [designReviewTemplateUrl, setDesignReviewTemplateUrl] = useState('');
  /** PRD-6 — lỗi hiện NGAY TẠI ô URL template (không chỉ toast) khi chuỗi không phải http(s). */
  const [designReviewTemplateUrlError, setDesignReviewTemplateUrlError] = useState('');
  const [sku, setSku] = useState('');
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState<ProductConfigStatus>(ProductConfigStatus.Active);
  const [machineNumber, setMachineNumber] = useState('');
  /** Gallery ảnh — index 0 = ảnh CHÍNH (`mockup`), còn lại `images[]`; entry có `file` = chờ upload khi Lưu. */
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [sizeChartFile, setSizeChartFile] = useState<File | null>(null);
  const [level, setLevel] = useState<string>('');
  const [fabricType, setFabricType] = useState('');
  const [toolResult, setToolResult] = useState('');
  const [guide, setGuide] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [machineTypeId, setMachineTypeId] = useState('');

  const [productCategoryId, setProductCategoryId] = useState('');
  const [productLine, setProductLine] = useState('');
  const [productLineSource, setProductLineSource] = useState('');
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [productTagIds, setProductTagIds] = useState<string[]>([]);
  const [productTechniqueIds, setProductTechniqueIds] = useState<string[]>([]);
  const [printMethod, setPrintMethod] = useState('');
  const [printArea, setPrintArea] = useState<ProductPrintArea>([]);
  /**
   * PRD-7 — chữ THÔ trong từng ô kích thước in. Giữ riêng khỏi `printArea` để ô
   * gõ bậy ("abc", "-5") vẫn hiện nguyên chữ và báo lỗi được, thay vì bị input
   * số nuốt mất im lặng. `printArea` chỉ nhận cặp số hợp lệ.
   */
  const [sizeDimDraft, setSizeDimDraft] = useState<Record<string, string>>({});
  const [sizeDimError, setSizeDimError] = useState<Record<string, string>>({});
  /** Vị trí in nào đang MỞ bảng kích thước — mặc định chỉ mở vị trí đã có dữ liệu. */
  const [openSizeDims, setOpenSizeDims] = useState<Record<string, boolean>>({});
  const [printDocument, setPrintDocument] = useState('');
  const [printTemplate, setPrintTemplate] = useState('');
  const [sizeChartUrl, setSizeChartUrl] = useState('');
  const [description, setDescription] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [maxProductionTime, setMaxProductionTime] = useState('');
  const [maxShippingTime, setMaxShippingTime] = useState('');
  const [hideForSeller, setHideForSeller] = useState(false);
  const [enableDesignCheck, setEnableDesignCheck] = useState(false);
  const [enableAffiliate, setEnableAffiliate] = useState(false);
  const [itemSpecifics, setItemSpecifics] = useState<ProductItemSpecific[]>([]);
  const [weight, setWeight] = useState<string>('');
  const [width, setWidth] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const [length, setLength] = useState<string>('');
  const [variations, setVariations] = useState<ProductVariation[]>([]);
  const [groups, setGroups] = useState<VariationGroup[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  /** Bộ chọn Batch Edit từng nhóm (Set rỗng = All) — thẳng hàng với `effectiveGroups`. */
  const [batchSelected, setBatchSelected] = useState<Array<Set<string>>>([]);

  const [baseline, setBaseline] = useState('');

  useEffect(() => {
    if (!configLoaded) loadConfig();
  }, [configLoaded, loadConfig]);

  useEffect(() => {
    (async () => {
      try {
        const [fRes, mRes, cRes, colRes, tagRes, techRes] = await Promise.all([
          RepositoryRemote.factory.getFactories('?page=1&limit=200'),
          RepositoryRemote.machineType.getMachineTypes('?page=1&limit=200'),
          RepositoryRemote.productCategory.getProductCategories('?page=1&limit=200'),
          RepositoryRemote.collection.getCollections('?page=1&limit=200'),
          RepositoryRemote.productTag.getProductTags('?page=1&limit=200'),
          RepositoryRemote.productTechnique.getProductTechniques('?page=1&limit=200'),
        ]);
        setFactories((fRes.data?.data || []) as RefItem[]);
        setMachineTypes((mRes.data?.data || []) as RefItem[]);
        setProductCategoryOptions((cRes.data?.data || []) as RefItem[]);
        setCollectionOptions((colRes.data?.data || []) as RefItem[]);
        setTagOptions((tagRes.data?.data || []) as RefItem[]);
        setTechniqueOptions((techRes.data?.data || []) as RefItem[]);
      } catch (error) {
        handleAxiosError(error);
      }
    })();
  }, []);

  const snapshot = (s: FormSnapshot): string => JSON.stringify(s);

  const buildSnapshot = (): FormSnapshot => ({
    fullName,
    shortName,
    designReviewCode,
    designReviewTemplateUrl,
    sizeDimDraft: pruneSizeDimDraft(sizeDimDraft),
    sku,
    slug,
    status,
    machineNumber,
    galleryUrls: gallery.filter((g) => g.url).map((g) => g.url as string),
    level,
    fabricType,
    toolResult,
    guide,
    factoryId,
    machineTypeId,
    productCategoryId,
    productLine,
    productLineSource,
    collectionIds,
    productTagIds,
    productTechniqueIds,
    printMethod,
    printArea,
    printDocument,
    printTemplate,
    sizeChartUrl,
    description,
    shortDescription,
    templateDescription,
    maxProductionTime,
    maxShippingTime,
    hideForSeller,
    enableDesignCheck,
    enableAffiliate,
    itemSpecifics,
    weight,
    width,
    height,
    length,
    variations,
  });

  const applyItem = (row: ProductConfigRow) => {
    setItem(row);
    const s: FormSnapshot = {
      fullName: row.fullName || '',
      shortName: row.shortName || '',
      designReviewCode: row.designReviewCode || '',
      designReviewTemplateUrl: row.designReviewTemplateUrl || '',
      sizeDimDraft: pruneSizeDimDraft(buildSizeDimDraft(row.printArea || [])),
      sku: row.sku || '',
      slug: row.slug || '',
      status: row.status || ProductConfigStatus.Active,
      machineNumber: row.machineNumber || '',
      galleryUrls: [...(row.mockup ? [row.mockup] : []), ...(row.images || [])],
      level: row.level != null ? String(row.level) : '',
      fabricType: row.fabricType || '',
      toolResult: row.toolResult || '',
      guide: row.guide || '',
      factoryId: row.factoryId || '',
      machineTypeId: row.machineTypeId || '',
      productCategoryId: row.productCategoryId || '',
      productLine: row.productLine || '',
      productLineSource: row.productLineSource || '',
      collectionIds: row.collectionIds || [],
      productTagIds: row.productTagIds || [],
      productTechniqueIds: row.productTechniqueIds || [],
      printMethod: row.printMethod || '',
      printArea: row.printArea || [],
      printDocument: row.printDocument || '',
      printTemplate: row.printTemplate || '',
      sizeChartUrl: row.sizeChartUrl || '',
      description: row.description || '',
      shortDescription: row.shortDescription || '',
      templateDescription: row.templateDescription || '',
      maxProductionTime: row.maxProductionTime != null ? String(row.maxProductionTime) : '',
      maxShippingTime: row.maxShippingTime != null ? String(row.maxShippingTime) : '',
      hideForSeller: !!row.hideForSeller,
      enableDesignCheck: !!row.enableDesignCheck,
      enableAffiliate: !!row.enableAffiliate,
      itemSpecifics: toFormSpecifics(row.itemSpecifics),
      weight: row.weight != null ? String(row.weight) : '',
      width: row.width != null ? String(row.width) : '',
      height: row.height != null ? String(row.height) : '',
      length: row.length != null ? String(row.length) : '',
      variations: toFormVariations(row.variations),
    };
    setFullName(s.fullName);
    setShortName(s.shortName);
    setDesignReviewCode(s.designReviewCode);
    setDesignReviewTemplateUrl(s.designReviewTemplateUrl);
    setDesignReviewTemplateUrlError('');
    setSku(s.sku);
    setSlug(s.slug);
    setStatus(s.status);
    setMachineNumber(s.machineNumber);
    setGallery(s.galleryUrls.map((url) => ({ url })));
    setLevel(s.level);
    setFabricType(s.fabricType);
    setToolResult(s.toolResult);
    setGuide(s.guide);
    setFactoryId(s.factoryId);
    setMachineTypeId(s.machineTypeId);
    setProductCategoryId(s.productCategoryId);
    setProductLine(s.productLine);
    setProductLineSource(s.productLineSource);
    setCollectionIds(s.collectionIds);
    setProductTagIds(s.productTagIds);
    setProductTechniqueIds(s.productTechniqueIds);
    setPrintMethod(s.printMethod);
    setPrintArea(s.printArea);
    // PRD-7 — đổ số đã lưu vào ô nhập, và MỞ SẴN vị trí in nào đã có kích thước.
    const open: Record<string, boolean> = {};
    for (const area of s.printArea) {
      if ((area.sizeDimensions || []).length > 0) open[area.key] = true;
    }
    setSizeDimDraft(buildSizeDimDraft(s.printArea));
    setSizeDimError({});
    setOpenSizeDims(open);
    setPrintDocument(s.printDocument);
    setPrintTemplate(s.printTemplate);
    setSizeChartUrl(s.sizeChartUrl);
    setDescription(s.description);
    setShortDescription(s.shortDescription);
    setTemplateDescription(s.templateDescription);
    setMaxProductionTime(s.maxProductionTime);
    setMaxShippingTime(s.maxShippingTime);
    setHideForSeller(s.hideForSeller);
    setEnableDesignCheck(s.enableDesignCheck);
    setEnableAffiliate(s.enableAffiliate);
    setItemSpecifics(s.itemSpecifics);
    setWeight(s.weight);
    setWidth(s.width);
    setHeight(s.height);
    setLength(s.length);
    setVariations(s.variations);
    setGroups(deriveGroups(s.variations));
    setBaseline(snapshot(s));
  };

  useEffect(() => {
    if (isNew) {
      applyItem({ _id: '', fullName: '', shortName: '', status: ProductConfigStatus.Active });
      setLoading(false);
      return;
    }
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const res = await RepositoryRemote.productConfig.getProductConfig(id);
        applyItem(res.data.data as ProductConfigRow);
      } catch (error) {
        handleAxiosError(error);
        navigate(PATHS.PRODUCTS);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pendingGalleryFiles = gallery.some((g) => g.file);

  const dirty = useMemo(
    () => {
      if (!item) return false;
      return snapshot(buildSnapshot()) !== baseline || pendingGalleryFiles || sizeChartFile !== null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      item,
      baseline,
      pendingGalleryFiles,
      sizeChartFile,
      fullName,
      shortName,
      designReviewCode,
      designReviewTemplateUrl,
      sku,
      slug,
      status,
      machineNumber,
      gallery,
      level,
      fabricType,
      toolResult,
      guide,
      factoryId,
      machineTypeId,
      productCategoryId,
      productLine,
      productLineSource,
      collectionIds,
      productTagIds,
      productTechniqueIds,
      printMethod,
      printArea,
      printDocument,
      printTemplate,
      sizeChartUrl,
      description,
      shortDescription,
      templateDescription,
      maxProductionTime,
      maxShippingTime,
      hideForSeller,
      enableDesignCheck,
      enableAffiliate,
      itemSpecifics,
      weight,
      width,
      height,
      length,
      variations,
    ],
  );

  // Guard thoát khi có thay đổi chưa lưu: beforeunload (đóng tab/reload) + chặn
  // click link trong app (BrowserRouter không có API block điều hướng).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClickCapture = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;
      // Dialog của hệ thống là async → chặn điều hướng NGAY (đồng bộ), hỏi
      // xong mới tự đi tiếp. `window.confirm` cũ chặn cả tab nên không cần.
      e.preventDefault();
      e.stopPropagation();
      void confirm({ title: t('detail.unsavedConfirm'), destructive: true }).then((ok) => {
        if (ok) navigate(href);
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [dirty, t, confirm, navigate]);

  // Scrollspy — section trong dải 20-45% phía trên viewport thì tab đó sáng.
  useEffect(() => {
    if (loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < clickScrollUntil.current) return;
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) setActiveSection(visible[0].target.id as SectionId);
      },
      { rootMargin: '-20% 0px -55% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [loading, SECTIONS]);

  const scrollToSection = (secId: SectionId) => {
    setActiveSection(secId);
    clickScrollUntil.current = Date.now() + 800;
    document.getElementById(secId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleBack = async () => {
    if (dirty && !(await confirm({ title: t('detail.unsavedConfirm'), destructive: true }))) return;
    navigate(PATHS.PRODUCTS);
  };

  const handleDeleteProduct = async () => {
    if (!item || isNew) return;
    if (!(await confirm({ title: t('detail.deleteConfirm', { name: item.fullName }), destructive: true }))) return;
    try {
      setDeleting(true);
      await RepositoryRemote.productConfig.deleteProductConfig(item._id);
      toast.success(t('detail.deleteSuccess', { name: item.fullName }));
      navigate(PATHS.PRODUCTS);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setDeleting(false);
    }
  };

  const toggleTechnique = (tid: string) =>
    setProductTechniqueIds((prev) => (prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]));
  const toggleTag = (tid: string) =>
    setProductTagIds((prev) => (prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]));
  const toggleCollection = (cid: string) =>
    setCollectionIds((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));

  const updateSpecific = (idx: number, patch: Partial<ProductItemSpecific>) =>
    setItemSpecifics((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const removeSpecific = (idx: number) => setItemSpecifics((prev) => prev.filter((_, i) => i !== idx));

  // Tick mới → mặc định `isRequired: true` (giữ behavior cũ: mọi vị trí đều bắt buộc design).
  /** PRD-7 — size để nhập kích thước in, đọc từ biến thể (xem `collectVariationSizes`). */
  const variationSizes = useMemo(() => collectVariationSizes(variations), [variations]);

  const togglePrintArea = (key: ProductPrintAreaItem['key'], checked: boolean) =>
    setPrintArea((prev) => (checked ? [...prev, { key, isRequired: true }] : prev.filter((i) => i.key !== key)));

  const updatePrintAreaItem = (key: ProductPrintAreaItem['key'], patch: Partial<ProductPrintAreaItem>) =>
    setPrintArea((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  /**
   * PRD-7 — gõ vào 1 ô kích thước in. Chỉ khi CẢ rộng lẫn dài đều là số hợp lệ
   * thì dòng size đó mới vào `printArea`; còn dở dang / gõ bậy thì dòng bị gỡ ra
   * để không bao giờ lưu được nửa cặp. Chữ thô vẫn nằm ở `sizeDimDraft` nên người
   * dùng thấy đúng thứ mình gõ và `handleSave` bắt được lỗi.
   */
  const changeSizeDim = (areaKey: ProductPrintAreaItem['key'], size: string, dim: 'w' | 'l', raw: string) => {
    const nextDraft = { ...sizeDimDraft, [sizeDimKey(areaKey, size, dim)]: raw };
    setSizeDimDraft(nextDraft);

    /*
      PRD-7 vòng 3 — soát NGAY khi gõ, không đợi bấm Lưu.
      Trước đó lỗi chỉ hiện trong `handleSave`, mà `handleSave` chỉ chạy được khi
      nút Lưu bật, tức khi form đã bẩn — gõ "59" trên form còn sạch thì không có
      gì xảy ra. Soát tại chỗ làm luật trần 58cm hiện ra ngay lúc người dùng gõ,
      độc lập hoàn toàn với trạng thái dirty. `handleSave` vẫn giữ vòng soát của
      nó để chặn lưu (và bắt cả ca nửa cặp, thứ chỉ biết được khi soát cả hàng).
    */
    const width = parseCm(nextDraft[sizeDimKey(areaKey, size, 'w')] ?? '');
    const length = parseCm(nextDraft[sizeDimKey(areaKey, size, 'l')] ?? '');

    setSizeDimError((prev) => {
      const next = { ...prev };
      const problem = describeSizeDimCell(raw, dim, t);
      if (problem) next[sizeDimKey(areaKey, size, dim)] = problem;
      else delete next[sizeDimKey(areaKey, size, dim)];

      /*
        PRD-9 — lỗi "phải nhập cả rộng lẫn dài" do `handleSave` gắn lên ô CÒN
        LẠI của hàng, nên xoá trắng ô mình đang gõ không đụng tới nó: cả hàng
        rỗng mà dòng chữ đỏ vẫn nằm đó. Hàng không còn chữ nào thì không còn gì
        để báo lỗi, nên xoá lỗi của CẢ HAI ô.
        Cố ý chỉ XOÁ chứ không THÊM lỗi nửa cặp lúc gõ: gõ xong ô rộng mà đã mắng
        ngay là thiếu ô dài thì phiền, ca đó vẫn để `handleSave` chặn lúc lưu.
      */
      if (width === null && length === null) {
        delete next[sizeDimKey(areaKey, size, 'w')];
        delete next[sizeDimKey(areaKey, size, 'l')];
      }
      return next;
    });
    const usable =
      width !== null &&
      length !== null &&
      Number.isFinite(width) &&
      Number.isFinite(length) &&
      width > 0 &&
      length > 0 &&
      // HF-1 — chỉ chặn khi CẢ HAI chiều cùng vượt trần; một chiều vượt thì quay
      // ngang là in được.
      Math.min(width, length) <= PRINT_AREA_MAX_WIDTH_CM;

    setPrintArea((prev) =>
      prev.map((area) => {
        if (area.key !== areaKey) return area;
        const rest = (area.sizeDimensions || []).filter((d) => d.size !== size);
        const rows = usable ? [...rest, { size, widthCm: width as number, lengthCm: length as number }] : rest;
        return { ...area, sizeDimensions: rows.length > 0 ? rows : undefined };
      }),
    );
  };

  /**
   * Tự sinh lại bảng variants (diff-preserve) khi 1 nhóm bấm Done hoặc bị xóa —
   * KHÔNG còn nút "Tạo biến thể" riêng. Chỉ chạy khi MỌI nhóm đã hoàn chỉnh
   * (có tên + ≥1 option) — còn nhóm đang soạn dở thì đợi nhóm đó Done.
   */
  const regenerate = (nextGroups: VariationGroup[]) => {
    // Option rỗng/nhóm soạn dở bị loại (`cleanGroups`) — còn nhóm nào chưa hoàn chỉnh thì đợi Done hết.
    const cleaned = cleanGroups(nextGroups);
    if (cleaned.length === 0 || cleaned.length !== nextGroups.length) return;
    const comboCount = buildCombos(cleaned).length;
    if (comboCount > VARIANTS_MAX) {
      toast.error(t('detail.groups.tooMany', { count: comboCount, max: VARIANTS_MAX }));
      return;
    }
    const result = generateVariants(cleaned, variations);
    setVariations(result.variants);
    if (result.orphans) {
      toast.warning(
        t('detail.groups.generatedOrphans', { created: result.created, kept: result.kept, orphans: result.orphans }),
      );
    } else {
      toast.success(t('detail.groups.generated', { created: result.created, kept: result.kept }));
    }
  };

  /** Nhóm option đã làm sạch — nguồn DUY NHẤT cho bảng/orphan/Batch Edit (nhóm soạn dở không ảnh hưởng). */
  const effectiveGroups = useMemo(() => cleanGroups(groups), [groups]);

  // Nhóm đổi (Done/xóa) → reset bộ chọn Batch Edit cho thẳng hàng index.
  useEffect(() => {
    setBatchSelected(effectiveGroups.map(() => new Set<string>()));
  }, [effectiveGroups]);

  const batchHasSelection = batchSelected.some((s) => s.size > 0);

  /** Lọc bảng theo bộ chọn Batch Edit (chỉ khi bar đang mở + có chọn) — memo để row memo không bị phá. */
  const batchRowFilter = useMemo(() => {
    if (!batchOpen || !batchHasSelection) return undefined;
    return (v: ProductVariation) => matchesSelection(v, effectiveGroups, batchSelected);
  }, [batchOpen, batchHasSelection, effectiveGroups, batchSelected]);

  const batchMatchedCount = useMemo(
    () => variations.filter((v) => matchesSelection(v, effectiveGroups, batchSelected)).length,
    [variations, effectiveGroups, batchSelected],
  );

  const applyBatch = (patch: Partial<ProductVariation>) => {
    setVariations((prev) =>
      prev.map((v) => (matchesSelection(v, effectiveGroups, batchSelected) ? { ...v, ...patch } : v)),
    );
    toast.success(t('detail.batchEdit.applied', { count: batchMatchedCount }));
  };

  /** HTML rỗng của quill ("<p><br></p>") coi như không có nội dung. */
  const cleanHtml = (html: string): string => {
    const stripped = html.replace(/<[^>]+>/g, '').replace(/\s|&nbsp;/g, '');
    return stripped ? html : '';
  };

  const uploadPendingImage = async (file: File, type: 'mockup' | 'size-chart'): Promise<string> => {
    const formData = new FormData();
    formData.append('type', type);
    formData.append('file', file);
    const res = await RepositoryRemote.productConfig.uploadProductImage(formData);
    return res.data.data.url;
  };

  const handleSave = async () => {
    if (isNew && !fullName.trim()) {
      toast.error(t('detail.fullNameRequired'));
      return;
    }
    // shortName và mã chạy tool (`designReviewCode`) đều ĐƯỢC PHÉP trống (PRD-2).
    // Mã tool trống = sản phẩm không có mã, Design Review API trả `productCode: null`.
    // PRD-6 — URL template chỉ nhận http(s); để trống là hợp lệ (sản phẩm chưa gắn file).
    const trimmedTemplateUrl = designReviewTemplateUrl.trim();
    if (trimmedTemplateUrl && !/^https?:\/\/\S+$/i.test(trimmedTemplateUrl)) {
      setDesignReviewTemplateUrlError(t('detail.production.designReviewTemplateUrlInvalid'));
      toast.error(t('detail.production.designReviewTemplateUrlInvalid'));
      scrollToSection('sec-production');
      return;
    }
    setDesignReviewTemplateUrlError('');

    // PRD-7 — soát mọi ô kích thước in ĐANG CÓ CHỮ. Bắt hết trong một lượt rồi mới
    // dừng, để người dùng thấy tất cả ô sai chứ không phải sửa xong ô này lòi ô kia.
    const dimErrors: Record<string, string> = {};
    for (const area of printArea) {
      for (const size of variationSizes) {
        const rawW = sizeDimDraft[sizeDimKey(area.key, size, 'w')] ?? '';
        const rawL =
          sizeDimKey(area.key, size, 'l') in sizeDimDraft ? sizeDimDraft[sizeDimKey(area.key, size, 'l')] : '';
        const width = parseCm(rawW);
        const length = parseCm(rawL);
        const bad = (v: number | null) => v !== null && (!Number.isFinite(v) || v <= 0);
        if (bad(width)) dimErrors[sizeDimKey(area.key, size, 'w')] = t('detail.printAreaConfig.sizeDims.errorPositive');
        if (bad(length))
          dimErrors[sizeDimKey(area.key, size, 'l')] = t('detail.printAreaConfig.sizeDims.errorPositive');
        // HF-1 — trần 58cm xét theo CẶP, không theo từng ô.
        if (!dimErrors[sizeDimKey(area.key, size, 'w')] && !dimErrors[sizeDimKey(area.key, size, 'l')]) {
          const pairProblem = describeSizeDimPair(width, length, t);
          if (pairProblem) dimErrors[sizeDimKey(area.key, size, 'w')] = pairProblem;
        }
        // Nửa cặp: có rộng mà thiếu dài (hoặc ngược lại) thì không dựng được vùng in.
        if (!dimErrors[sizeDimKey(area.key, size, 'w')] && !dimErrors[sizeDimKey(area.key, size, 'l')]) {
          if (width !== null && length === null)
            dimErrors[sizeDimKey(area.key, size, 'l')] = t('detail.printAreaConfig.sizeDims.errorBoth');
          if (length !== null && width === null)
            dimErrors[sizeDimKey(area.key, size, 'w')] = t('detail.printAreaConfig.sizeDims.errorBoth');
        }
      }
    }
    if (Object.keys(dimErrors).length > 0) {
      setSizeDimError(dimErrors);
      // Mở bảng của mọi vị trí in đang có ô sai — lỗi giấu trong khối thu gọn thì vô dụng.
      setOpenSizeDims((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(dimErrors)) next[key.split('::')[0]] = true;
        return next;
      });
      toast.error(t('detail.printAreaConfig.sizeDims.errorToast', { count: Object.keys(dimErrors).length }));
      scrollToSection('sec-print-areas');
      return;
    }
    setSizeDimError({});

    if (isNew && !factoryId) {
      toast.error(t('detail.factoryRequired'));
      scrollToSection('sec-production');
      return;
    }
    if (isNew && !machineTypeId) {
      toast.error(t('detail.machineTypeRequired'));
      scrollToSection('sec-production');
      return;
    }

    setSaving(true);
    // Upload các ảnh đang chờ (gallery + bảng size) TRƯỚC — lỗi thì dừng, KHÔNG PATCH.
    let galleryUrls: string[];
    let finalSizeChartUrl = sizeChartUrl.trim();
    try {
      galleryUrls = [];
      for (const img of gallery) {
        if (img.url) {
          galleryUrls.push(img.url);
        } else if (img.file) {
          galleryUrls.push(await uploadPendingImage(img.file, 'mockup'));
        }
      }
      if (sizeChartFile) finalSizeChartUrl = await uploadPendingImage(sizeChartFile, 'size-chart');
    } catch (error) {
      handleAxiosError(error);
      setSaving(false);
      return;
    }

    const patch: Partial<ProductConfigRow> = {
      fullName: fullName.trim(),
      shortName: shortName.trim(),
      designReviewCode: designReviewCode.trim().toUpperCase(),
      // KHÔNG uppercase — URL phân biệt hoa thường. Chuỗi rỗng gửi đi để XOÁ được URL cũ
      // (khác printDocument/printTemplate dùng `|| undefined`, vốn không cần xoá).
      designReviewTemplateUrl: trimmedTemplateUrl,
      sku: sku.trim() || undefined,
      slug: slug.trim() || undefined,
      status,
      machineNumber: machineNumber.trim() || undefined,
      mockup: galleryUrls[0] || '',
      images: galleryUrls.slice(1),
      level: level ? Number(level) : undefined,
      fabricType: fabricType || undefined,
      toolResult: toolResult || undefined,
      guide: cleanHtml(guide),
      ...(factoryId ? { factoryId } : {}),
      ...(machineTypeId ? { machineTypeId } : {}),
      productCategoryId: productCategoryId || undefined,
      productLine: (productLine || undefined) as ProductLine | undefined,
      collectionIds,
      printMethod: printMethod || undefined,
      printArea,
      printDocument: printDocument.trim() || undefined,
      printTemplate: printTemplate.trim() || undefined,
      sizeChartUrl: finalSizeChartUrl || undefined,
      description: cleanHtml(description) || undefined,
      shortDescription: cleanHtml(shortDescription) || undefined,
      templateDescription: cleanHtml(templateDescription) || undefined,
      maxProductionTime: maxProductionTime ? Number(maxProductionTime) : undefined,
      maxShippingTime: maxShippingTime ? Number(maxShippingTime) : undefined,
      hideForSeller,
      enableDesignCheck,
      enableAffiliate,
      itemSpecifics: itemSpecifics.filter((x) => x.label.trim() && x.value.trim()),
      weight: weight ? Number(weight) : undefined,
      width: width ? Number(width) : undefined,
      height: height ? Number(height) : undefined,
      length: length ? Number(length) : undefined,
      // SKU biến thể tự sinh theo quy ước cho dòng mới; dòng có sku DB giữ nguyên.
      variations: variations
        .map((v) => {
          const cleanedAttributes = (v.attributes || []).filter((a) => a.label.trim() && a.value.trim());
          const finalSku = v.sku.trim() ? v.sku.trim().toUpperCase() : computeVariationSku(sku, cleanedAttributes);
          return { ...v, sku: finalSku, attributes: cleanedAttributes };
        })
        .filter((v) => v.sku.trim()),
    };
    const f = factories.find((x) => x._id === factoryId);
    if (f) patch.factory = { name: f.name, shortName: f.shortName };
    const m = machineTypes.find((x) => x._id === machineTypeId);
    if (m) patch.machineType = { name: m.name, shortName: m.shortName };
    const c = productCategoryOptions.find((x) => x._id === productCategoryId);
    patch.productCategory = c ? { name: c.name, shortName: c.shortName } : undefined;
    try {
      if (isNew) {
        const res = await RepositoryRemote.productConfig.createProductConfig(patch as never);
        setSizeChartFile(null);
        toast.success(t('detail.createSuccess'));
        navigate(PATHS.PRODUCT_DETAIL.replace(':id', res.data.data._id), { replace: true });
      } else {
        await RepositoryRemote.productConfig.updateProductConfig(item!._id, patch as never);
        applyItem({ ...item!, ...patch });
        setSizeChartFile(null);
        toast.success(t('detail.saveSuccess'));
      }
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !item) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={24} className="text-muted-foreground" />
      </div>
    );
  }

  const primaryImage = gallery.length ? galleryImageSrc(gallery[0]) : '';

  return (
    <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6">
      {confirmDialog}
      {/* ─── Sticky header + anchor nav ─── */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 md:px-6">
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              title={t('detail.backToList')}
              className="shrink-0"
            >
              <ArrowLeft size={18} />
            </Button>
            {primaryImage ? (
              <img
                src={primaryImage}
                alt="mockup"
                className="w-9 h-9 rounded object-cover border border-border bg-muted shrink-0"
              />
            ) : null}
            <div className="min-w-0">
              {isNew ? (
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('detail.header.fullNamePlaceholder')}
                  className="h-8 text-lg font-bold"
                />
              ) : (
                <h1 className="text-base md:text-lg font-bold text-foreground truncate leading-tight">
                  {item.fullName}
                </h1>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <div className="flex items-center gap-1">
                  <Label className="text-xs text-muted-foreground shrink-0">{t('detail.header.shortName')}</Label>
                  <Input
                    value={shortName}
                    onChange={(e) => setShortName(e.target.value)}
                    className="h-7 w-24 text-xs uppercase"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-xs text-muted-foreground shrink-0">SKU</Label>
                  <Input
                    value={sku}
                    onChange={(e) => setSku(e.target.value.toUpperCase())}
                    placeholder="—"
                    className="h-7 w-28 text-xs font-mono"
                  />
                </div>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProductConfigStatus)}
                  className={cn(
                    'h-7 rounded-md border px-2 text-xs font-medium text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    STATUS_META[status].className,
                  )}
                >
                  <option value={ProductConfigStatus.Active}>{STATUS_META[ProductConfigStatus.Active].label}</option>
                  <option value={ProductConfigStatus.Inactive}>
                    {STATUS_META[ProductConfigStatus.Inactive].label}
                  </option>
                  <option value={ProductConfigStatus.Hidden}>{STATUS_META[ProductConfigStatus.Hidden].label}</option>
                </select>
                {dirty && (
                  <Badge className="bg-amber-500 text-white font-normal border-amber-500 shrink-0">
                    {t('detail.header.unsaved')}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isNew && (
              <Button
                variant="outline"
                onClick={handleDeleteProduct}
                disabled={deleting || saving}
                title={t('detail.deleteTitle')}
              >
                {deleting ? <Spinner size={14} /> : <Trash2 size={14} className="text-destructive" />}
                {t('detail.deleteButton')}
              </Button>
            )}
            <Button variant="outline" onClick={handleBack} disabled={saving}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving || (!isNew && !dirty)}>
              {saving && <Spinner size={14} />}
              {t(isNew ? 'detail.header.createProduct' : 'detail.header.saveChanges')}
            </Button>
          </div>
        </div>
        {/* Anchor nav — click scroll tới section, scrollspy tự sáng khi cuộn tay */}
        <nav className="flex items-center gap-1 overflow-x-auto">
          {SECTIONS.map((s, i) => {
            const active = activeSection === s.id;
            const count =
              s.id === 'sec-variants' ? variations.length : s.id === 'sec-print-areas' ? printArea.length : null;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollToSection(s.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`w-5 h-5 rounded flex items-center justify-center ${s.tile}`}>
                  <s.icon size={12} />
                </span>
                {i + 1}. {s.label}
                {count != null && (
                  <Badge variant={active ? 'default' : 'secondary'} className="px-1.5 py-0 text-[10px] font-normal">
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ─── Body — 4 section dọc ─── */}
      <div className="px-4 md:px-6 py-6 space-y-8 bg-muted/20">
        {/* ══ 1. Production ══ */}
        <SectionCard meta={SECTIONS[0]} number={1}>
          <div className="grid lg:grid-cols-[minmax(280px,380px)_1fr] gap-8">
            {/* Gallery */}
            <div className="space-y-2">
              <Label>{t('detail.gallery.label')}</Label>
              <MockupImagesEditor images={gallery} onChange={setGallery} />
            </div>

            {/* Fields */}
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('detail.production.slug')}</Label>
                  <Input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="new-all-over-print-hawaiian-shirt"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('detail.sidebar.machineNumber')}</Label>
                  <Input
                    value={machineNumber}
                    onChange={(e) => setMachineNumber(e.target.value)}
                    placeholder={t('detail.sidebar.machineNumberPlaceholder')}
                  />
                </div>
              </div>

              {/*
                Mã chạy tool duyệt thiết kế (PRD-2) — trường RIÊNG, cố ý đặt ở
                khu Sản xuất chứ không cạnh ô "Tên viết tắt" trên header để
                không ai nhầm hai thứ với nhau nữa.
              */}
              <div className="space-y-1.5 md:max-w-md">
                <Label>{t('detail.production.designReviewCode')}</Label>
                <Input
                  value={designReviewCode}
                  onChange={(e) => setDesignReviewCode(e.target.value)}
                  placeholder={t('detail.production.designReviewCodePlaceholder')}
                  className="font-mono uppercase"
                />
                <p className="text-xs text-muted-foreground">{t('detail.production.designReviewCodeHint')}</p>
              </div>

              {/*
                PRD-6 — URL file template chạy tool, đặt NGAY DƯỚI ô mã vì hai thứ luôn
                đi cùng nhau. Trường RIÊNG: không đụng printTemplate/printDocument.
              */}
              <div className="space-y-1.5 md:max-w-md">
                <Label>{t('detail.production.designReviewTemplateUrl')}</Label>
                <Input
                  value={designReviewTemplateUrl}
                  onChange={(e) => {
                    setDesignReviewTemplateUrl(e.target.value);
                    if (designReviewTemplateUrlError) setDesignReviewTemplateUrlError('');
                  }}
                  placeholder={t('detail.production.designReviewTemplateUrlPlaceholder')}
                  className={designReviewTemplateUrlError ? 'border-destructive' : undefined}
                />
                {designReviewTemplateUrlError ? (
                  <p className="text-xs text-destructive">{designReviewTemplateUrlError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('detail.production.designReviewTemplateUrlHint')}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>{t('detail.sidebar.level')}</Label>
                <div className="flex flex-wrap gap-1">
                  {PRODUCT_LEVELS.map((lv) => {
                    const active = level === String(lv.value);
                    return (
                      <button
                        key={lv.value}
                        type="button"
                        onClick={() => setLevel(active ? '' : String(lv.value))}
                        title={lv.label}
                        className={cn(
                          'w-7 h-7 rounded-md text-xs font-semibold border transition-colors',
                          active ? 'text-white' : 'bg-background text-muted-foreground hover:bg-muted',
                        )}
                        style={
                          active ? { backgroundColor: lv.color, borderColor: lv.color } : { borderColor: lv.color }
                        }
                      >
                        {lv.value}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('detail.sidebar.factory')}</Label>
                  <select value={factoryId} onChange={(e) => setFactoryId(e.target.value)} className={selectCls}>
                    {!factoryId && <option value="">{t('detail.notSelected')}</option>}
                    {factories.map((f) => (
                      <option key={f._id} value={f._id}>
                        {f.shortName} · {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('detail.sidebar.department')}</Label>
                  <select
                    value={machineTypeId}
                    onChange={(e) => setMachineTypeId(e.target.value)}
                    className={selectCls}
                  >
                    {!machineTypeId && <option value="">{t('detail.notSelected')}</option>}
                    {machineTypes.map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.shortName} · {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('detail.sidebar.fabricType')}</Label>
                  <select value={fabricType} onChange={(e) => setFabricType(e.target.value)} className={selectCls}>
                    <option value="">{t('detail.notSelected')}</option>
                    {fabricOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('detail.sidebar.toolResult')}</Label>
                  <select value={toolResult} onChange={(e) => setToolResult(e.target.value)} className={selectCls}>
                    <option value="">{t('detail.notSelected')}</option>
                    {toolOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Toggles — parity hệ cũ, mới lưu dữ liệu, CHƯA wire logic */}
              <div className="grid md:grid-cols-3 gap-3">
                <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5 text-sm">
                  {t('detail.toggles.hideForSeller')}
                  <Switch checked={hideForSeller} onCheckedChange={setHideForSeller} />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5 text-sm">
                  {t('detail.toggles.designCheck')}
                  <Switch checked={enableDesignCheck} onCheckedChange={setEnableDesignCheck} />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5 text-sm">
                  {t('detail.toggles.affiliate')}
                  <Switch checked={enableAffiliate} onCheckedChange={setEnableAffiliate} />
                </label>
              </div>

              <div className="space-y-1.5">
                <Label>{t('detail.sidebar.guide')}</Label>
                <RichTextEditor
                  value={guide}
                  onChange={setGuide}
                  placeholder={t('detail.sidebar.guidePlaceholder')}
                  minHeight={140}
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ══ 2. Product Details ══ */}
        <SectionCard meta={SECTIONS[1]} number={2}>
          <div className="grid lg:grid-cols-2 gap-x-8 gap-y-4">
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('detail.classification.productCategory')}</Label>
                  <select
                    value={productCategoryId}
                    onChange={(e) => setProductCategoryId(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">{t('detail.notSelected')}</option>
                    {sortCategoryTree(productCategoryOptions).map((opt) => (
                      <option key={opt._id} value={opt._id}>
                        {'—'.repeat(opt.depth)} {opt.shortName} · {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label title={t('detail.classification.productLineHint')}>
                    {t('detail.classification.productLine')}
                  </Label>
                  <select
                    value={productLine}
                    onChange={(e) => {
                      setProductLine(e.target.value);
                      // Đổi tay → nguồn thành 'manual' (BE cũng ghi vậy khi lưu).
                      setProductLineSource(e.target.value ? 'manual' : '');
                    }}
                    className={selectCls}
                  >
                    <option value="">{t('detail.notSelected')}</option>
                    {PRODUCT_LINE_OPTIONS.map((code) => (
                      <option key={code} value={code}>
                        {productLineLabel(t, code)}
                      </option>
                    ))}
                  </select>
                  {productLineSource && (
                    <p
                      className={cn(
                        'text-[11px]',
                        productLineSource === 'default' ? 'text-amber-600' : 'text-muted-foreground',
                      )}
                    >
                      {t('detail.classification.productLineSource', {
                        source: t(`productLineSources.${productLineSource}`),
                      })}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>{t('detail.classification.printMethod')}</Label>
                  <select value={printMethod} onChange={(e) => setPrintMethod(e.target.value)} className={selectCls}>
                    <option value="">{t('detail.notSelected')}</option>
                    {printMethodOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t('detail.techniquesField.label')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {techniqueOptions.map((tech) => (
                    <button key={tech._id} type="button" onClick={() => toggleTechnique(tech._id)}>
                      <Badge
                        variant={productTechniqueIds.includes(tech._id) ? 'default' : 'outline'}
                        className="cursor-pointer font-normal"
                      >
                        {tech.name}
                      </Badge>
                    </button>
                  ))}
                  {techniqueOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t('detail.techniquesField.empty')}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t('detail.tagsField.label')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tagOptions.map((tag) => (
                    <button key={tag._id} type="button" onClick={() => toggleTag(tag._id)}>
                      <Badge
                        variant={productTagIds.includes(tag._id) ? 'default' : 'outline'}
                        className="cursor-pointer font-normal"
                      >
                        {tag.name}
                      </Badge>
                    </button>
                  ))}
                  {tagOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t('detail.tagsField.empty')}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t('detail.collectionsField.label')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {collectionOptions.map((col) => {
                    const active = collectionIds.includes(col._id);
                    return (
                      <button key={col._id} type="button" onClick={() => toggleCollection(col._id)}>
                        <Badge variant={active ? 'default' : 'outline'} className="cursor-pointer font-normal">
                          {col.name}
                        </Badge>
                      </button>
                    );
                  })}
                  {collectionOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t('detail.collectionsField.empty')}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t('detail.customerDisplay.sizeChart')}</Label>
                <div className="max-w-[220px]">
                  <ImageUploadField
                    value={sizeChartUrl}
                    pendingFile={sizeChartFile}
                    onFileSelected={setSizeChartFile}
                    aspectClassName="aspect-[3/4]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t('detail.shippingTime.title')}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">{t('detail.shippingTime.maxProduction')}</span>
                    <Input
                      type="number"
                      min={0}
                      value={maxProductionTime}
                      onChange={(e) => setMaxProductionTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">{t('detail.shippingTime.maxShipping')}</span>
                    <Input
                      type="number"
                      min={0}
                      value={maxShippingTime}
                      onChange={(e) => setMaxShippingTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t('detail.logistics.title')}</Label>
                <div className="grid grid-cols-4 gap-2">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">{t('detail.logistics.weight')}</span>
                    <Input type="number" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">{t('detail.logistics.width')}</span>
                    <Input type="number" min={0} value={width} onChange={(e) => setWidth(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">{t('detail.logistics.height')}</span>
                    <Input type="number" min={0} value={height} onChange={(e) => setHeight(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">{t('detail.logistics.length')}</span>
                    <Input type="number" min={0} value={length} onChange={(e) => setLength(e.target.value)} />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">{t('detail.logistics.hint')}</p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>{t('detail.itemSpecifics.title')}</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setItemSpecifics((prev) => [...prev, { label: '', value: '' }])}
                  >
                    <Plus size={14} /> {t('detail.itemSpecifics.addRow')}
                  </Button>
                </div>
                <div className="space-y-2">
                  {itemSpecifics.map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={s.label}
                        onChange={(e) => updateSpecific(idx, { label: e.target.value })}
                        placeholder={t('detail.itemSpecifics.labelPlaceholder')}
                        className="flex-1"
                      />
                      <Input
                        value={s.value}
                        onChange={(e) => updateSpecific(idx, { value: e.target.value })}
                        placeholder={t('detail.itemSpecifics.valuePlaceholder')}
                        className="flex-1"
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeSpecific(idx)}>
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {itemSpecifics.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t('detail.itemSpecifics.empty')}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('detail.descriptions.short')}</Label>
                <RichTextEditor
                  value={shortDescription}
                  onChange={setShortDescription}
                  placeholder={t('detail.descriptions.shortPlaceholder')}
                  minHeight={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('detail.descriptions.item')}</Label>
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                  placeholder={t('detail.descriptions.itemPlaceholder')}
                  minHeight={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('detail.descriptions.template')}</Label>
                <RichTextEditor
                  value={templateDescription}
                  onChange={setTemplateDescription}
                  placeholder={t('detail.descriptions.templatePlaceholder')}
                  minHeight={120}
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ══ 3. Variants & Price ══ */}
        <SectionCard meta={SECTIONS[2]} number={3} badge={t('detail.counts.variants', { count: variations.length })}>
          <div className="space-y-3">
            {/* Option group cards — bấm Done / xóa nhóm là bảng dưới tự sinh lại */}
            {groups.map((g, idx) => (
              <VariationItem
                key={idx}
                group={g}
                defaultEditing={!g.name.trim() && g.options.length === 0}
                otherNames={groups.filter((_, i) => i !== idx).map((x) => x.name)}
                onChange={(patch) => setGroups((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)))}
                onRemove={() => {
                  const next = groups.filter((_, i) => i !== idx);
                  setGroups(next);
                  regenerate(next);
                }}
                onDone={(clean) => {
                  const next = groups.map((x, i) => (i === idx ? clean : x));
                  setGroups(next);
                  regenerate(next);
                }}
              />
            ))}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-primary hover:text-primary"
                disabled={groups.length >= VARIANT_GROUP_MAX}
                onClick={() => setGroups((prev) => [...prev, { name: '', options: [] }])}
              >
                <Plus size={14} /> {t('detail.groups.addVariant')}
              </Button>
              <BulkGeneratePopover
                existingGroups={effectiveGroups}
                onGenerate={(dims) => {
                  // Nhóm soạn dở (card rỗng đang mở) bị thay bằng dims tạo nhanh — nhóm hoàn chỉnh giữ nguyên.
                  const next = [...cleanGroups(groups), ...dims];
                  setGroups(next);
                  regenerate(next);
                }}
              />
            </div>

            {/* Variation List + Batch Edit */}
            <div className="flex items-end justify-between gap-3 pt-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                  {t('detail.groups.variationList')}
                  <Badge variant="secondary" className="font-normal">
                    {variations.length}
                  </Badge>
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t('detail.variations.skuHintPrefix')}{' '}
                  <span className="font-mono">{t('detail.variations.skuFormat')}</span>
                  {t('detail.variations.skuHintSuffix')}
                  {!sku.trim() && <span className="text-amber-600"> {t('detail.variations.noSkuWarning')}</span>}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setBatchOpen((o) => !o)}
                disabled={variations.length === 0}
              >
                {t('detail.groups.batchEdit')} {batchOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </Button>
            </div>
            {batchOpen && variations.length > 0 && (
              <BatchEditBar
                groups={effectiveGroups}
                selected={batchSelected}
                onSelectedChange={setBatchSelected}
                matchedCount={batchMatchedCount}
                total={variations.length}
                onApply={applyBatch}
              />
            )}
            <VariantsTable
              groups={effectiveGroups}
              variants={variations}
              skuPrefix={sku}
              onChange={setVariations}
              rowFilter={batchRowFilter}
            />
          </div>
        </SectionCard>

        {/* ══ 4. Print Areas ══ */}
        <SectionCard meta={SECTIONS[3]} number={4} badge={t('detail.counts.printAreas', { count: printArea.length })}>
          <p className="text-xs text-muted-foreground mb-3">
            <Trans
              t={t}
              i18nKey="detail.customerDisplay.printAreaHint"
              components={{ code: <span className="font-mono">order.designs</span> }}
            />
          </p>

          {/* Tài liệu + template chung cấp sản phẩm (print_document / print_template hệ cũ) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div>
              <Label className="text-xs">{t('detail.printAreaConfig.printDocument')}</Label>
              <Input
                value={printDocument}
                onChange={(e) => setPrintDocument(e.target.value)}
                placeholder="https://..."
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">{t('detail.printAreaConfig.printTemplate')}</Label>
              <Input
                value={printTemplate}
                onChange={(e) => setPrintTemplate(e.target.value)}
                placeholder="https://drive.google.com/..."
                className="h-9 mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-2 rounded-md border border-border p-3">
            {PRODUCT_PRINT_AREAS.map((pa) => (
              <label key={pa.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={printArea.some((i) => i.key === pa.key)}
                  onChange={(e) => togglePrintArea(pa.key, e.target.checked)}
                  className="rounded border-input"
                />
                {t(`printAreas.${pa.key}`, { defaultValue: pa.label })}
              </label>
            ))}
          </div>

          {/* Cấu hình chi tiết từng vị trí đã tick — mirror print_areas[] hệ cũ */}
          {printArea.length > 0 && (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">{t('detail.printAreaConfig.title')}</p>
              {printArea.map((area) => {
                const meta = PRODUCT_PRINT_AREAS.find((pa) => pa.key === area.key);
                return (
                  <div key={area.key} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-medium">
                        {t(`printAreas.${area.key}`, { defaultValue: meta?.label ?? area.key })}
                      </span>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={area.isRequired !== false}
                            onChange={(e) => updatePrintAreaItem(area.key, { isRequired: e.target.checked })}
                            className="rounded border-input"
                          />
                          {t('detail.printAreaConfig.isRequired')}
                        </label>
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!area.isEmbroidery}
                            onChange={(e) =>
                              updatePrintAreaItem(area.key, { isEmbroidery: e.target.checked || undefined })
                            }
                            className="rounded border-input"
                          />
                          {t('detail.printAreaConfig.isEmbroidery')}
                        </label>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-[1fr_110px_110px_110px] gap-2">
                      <div className="col-span-2 md:col-span-1">
                        <Label className="text-[11px] text-muted-foreground">
                          {t('detail.printAreaConfig.templateUrl')}
                        </Label>
                        <Input
                          value={area.templateUrl ?? ''}
                          onChange={(e) => updatePrintAreaItem(area.key, { templateUrl: e.target.value || undefined })}
                          placeholder="https://drive.google.com/..."
                          className="h-8 mt-0.5 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">
                          {t('detail.printAreaConfig.widthPx')}
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          value={area.widthPx ?? ''}
                          onChange={(e) =>
                            updatePrintAreaItem(area.key, {
                              widthPx: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          className="h-8 mt-0.5 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">
                          {t('detail.printAreaConfig.heightPx')}
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          value={area.heightPx ?? ''}
                          onChange={(e) =>
                            updatePrintAreaItem(area.key, {
                              heightPx: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          className="h-8 mt-0.5 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">
                          {t('detail.printAreaConfig.additionPrice')}
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={area.additionPrice ?? ''}
                          onChange={(e) =>
                            updatePrintAreaItem(area.key, {
                              additionPrice: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          className="h-8 mt-0.5 text-xs"
                        />
                      </div>
                    </div>

                    {/*
                      PRD-7 — kích thước in THẬT theo từng size (cm). Thu gọn mặc định:
                      1 sản phẩm tick được cả 18 vị trí × chục size, mở hết là trang chết.
                      Tiêu đề luôn nói đã nhập bao nhiêu size để biết vị trí nào còn thiếu
                      mà không phải mở ra xem.
                    */}
                    <div className="mt-3 border-t border-border pt-2">
                      <button
                        type="button"
                        onClick={() => setOpenSizeDims((prev) => ({ ...prev, [area.key]: !prev[area.key] }))}
                        className="flex w-full items-center justify-between gap-2 text-left"
                      >
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {t('detail.printAreaConfig.sizeDims.title')}
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {variationSizes.length > 0 &&
                            t('detail.printAreaConfig.sizeDims.filled', {
                              filled: (area.sizeDimensions || []).length,
                              total: variationSizes.length,
                            })}
                          <ChevronDown
                            size={14}
                            className={cn('transition-transform', openSizeDims[area.key] && 'rotate-180')}
                          />
                        </span>
                      </button>

                      {openSizeDims[area.key] &&
                        (variationSizes.length === 0 ? (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            {t('detail.printAreaConfig.sizeDims.noSizes')}
                          </p>
                        ) : (
                          <div className="mt-2 space-y-1.5 md:max-w-sm">
                            <div className="grid grid-cols-[minmax(56px,1fr)_100px_100px] gap-2 text-[11px] text-muted-foreground">
                              <span>{t('detail.printAreaConfig.sizeDims.size')}</span>
                              <span>
                                {t('detail.printAreaConfig.sizeDims.width', { max: PRINT_AREA_MAX_WIDTH_CM })}
                              </span>
                              <span>{t('detail.printAreaConfig.sizeDims.length')}</span>
                            </div>
                            {variationSizes.map((size) => {
                              const wKey = sizeDimKey(area.key, size, 'w');
                              const lKey = sizeDimKey(area.key, size, 'l');
                              return (
                                <div key={size} className="grid grid-cols-[minmax(56px,1fr)_100px_100px] gap-2">
                                  <span className="self-center truncate text-xs" title={size}>
                                    {size}
                                  </span>
                                  <div>
                                    <Input
                                      inputMode="decimal"
                                      value={sizeDimDraft[wKey] ?? ''}
                                      onChange={(e) => changeSizeDim(area.key, size, 'w', e.target.value)}
                                      className={cn('h-8 text-xs', sizeDimError[wKey] && 'border-destructive')}
                                    />
                                    {sizeDimError[wKey] && (
                                      <p className="mt-0.5 text-[11px] text-destructive">{sizeDimError[wKey]}</p>
                                    )}
                                  </div>
                                  <div>
                                    <Input
                                      inputMode="decimal"
                                      value={sizeDimDraft[lKey] ?? ''}
                                      onChange={(e) => changeSizeDim(area.key, size, 'l', e.target.value)}
                                      className={cn('h-8 text-xs', sizeDimError[lKey] && 'border-destructive')}
                                    />
                                    {sizeDimError[lKey] && (
                                      <p className="mt-0.5 text-[11px] text-destructive">{sizeDimError[lKey]}</p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* Footer save */}
        <div className="flex items-center justify-end gap-2 pb-6">
          {!isNew && (
            <Button
              variant="outline"
              onClick={handleDeleteProduct}
              disabled={deleting || saving}
              title={t('detail.deleteTitle')}
            >
              {deleting ? <Spinner size={14} /> : <Trash2 size={14} className="text-destructive" />}
              {t('detail.deleteButton')}
            </Button>
          )}
          <Button variant="outline" onClick={handleBack} disabled={saving}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || (!isNew && !dirty)}>
            {saving && <Spinner size={14} />}
            {t(isNew ? 'detail.header.createProduct' : 'detail.header.saveChanges')}
          </Button>
        </div>
      </div>
    </div>
  );
}
