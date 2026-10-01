import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { IDZod, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@shared/constants';
import {
  DesignerRank,
  DesignerStatus,
  DesignerTransitionAction,
  FulfillmentStage,
  OrderPriority,
  PRODUCT_LINES,
  type ProductLine,
  Status,
} from '@shared/enums';
import { PageResZod, ResZod } from '@shared/types';
import { z } from 'zod';

/**
 * Designer Task Workflow — DTOs.
 *
 * Identity model: `Order.assignee = user._id (string)`. Sub-designer là user
 * có role `Designer`. Picker "Người thực hiện" load thẳng từ designer team,
 * KHÔNG còn qua workshop_config (legacy assignee category đã xoá).
 */

// ─── Team management (Phase 2) ──────────────────────────────────────

export const DesignerTeamMemberZod = z.object({
  _id: IDZod,
  fullName: z.string(),
  email: z.string(),
  status: z.nativeEnum(Status),
  hireDate: z.date().optional(),
  telegramChatId: z.string().optional(),
  /** Số đơn user đang ôm (designerStatus ∈ {assigned, in-progress, rework}). */
  activeTaskCount: z.number().int().nonnegative(),
  /** Tổng đơn hoàn thành (designerStatus = done). */
  completedTaskCount: z.number().int().nonnegative(),
  createdAt: z.date().optional(),
});
export type DesignerTeamMember = z.infer<typeof DesignerTeamMemberZod>;

export const GetDesignerTeamZod = z.object({
  status: z.nativeEnum(Status).optional(),
});
export class GetDesignerTeamDto extends createZodDto(extendApi(GetDesignerTeamZod)) {}

export const GetDesignerTeamResZod = PageResZod.extend({ data: DesignerTeamMemberZod.array() });
export class GetDesignerTeamResDto extends createZodDto(extendApi(GetDesignerTeamResZod)) {}

export const CreateDesignerTeamMemberZod = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  hireDate: z.coerce.date().optional(),
  telegramChatId: z.string().max(60).optional(),
});
export class CreateDesignerTeamMemberDto extends createZodDto(extendApi(CreateDesignerTeamMemberZod)) {}

export const CreateDesignerTeamMemberResZod = ResZod.extend({ data: DesignerTeamMemberZod });
export class CreateDesignerTeamMemberResDto extends createZodDto(extendApi(CreateDesignerTeamMemberResZod)) {}

export const UpdateDesignerTeamMemberZod = z.object({
  fullName: z.string().min(1).max(120).optional(),
  email: z.string().email().toLowerCase().optional(),
  hireDate: z.coerce.date().nullable().optional(),
  telegramChatId: z.string().max(60).nullable().optional(),
  status: z.nativeEnum(Status).optional(),
});
export class UpdateDesignerTeamMemberDto extends createZodDto(extendApi(UpdateDesignerTeamMemberZod)) {}

export const UpdateDesignerTeamMemberResZod = ResZod.extend({ data: DesignerTeamMemberZod });
export class UpdateDesignerTeamMemberResDto extends createZodDto(extendApi(UpdateDesignerTeamMemberResZod)) {}

export const ResetDesignerPasswordZod = z.object({
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export class ResetDesignerPasswordDto extends createZodDto(extendApi(ResetDesignerPasswordZod)) {}

// ─── My tasks (Phase 4) ─────────────────────────────────────────────

export const DesignerTaskCardZod = z.object({
  _id: IDZod,
  productionId: z.string(),
  orderId: z.string().optional(),
  type: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  mockupUrl: z.string().optional(),
  mockupOriginalUrl: z.string().optional(),
  /** workshop_config code — FE resolve label qua store nếu cần đẹp hơn. */
  fabricType: z.string().optional(),
  machineNumber: z.string().optional(),
  toolResult: z.string().optional(),
  toolResultNote: z.string().optional(),
  /** Mức ưu tiên (xem `production-order.dto.ts`) — hiện badge + hạn dự kiến trên card. */
  priority: z.nativeEnum(OrderPriority).optional(),
  /** Ngày khách lên đơn + ngày vào sản xuất (hiển thị trên card + tooltip). */
  orderAt: z.date().optional(),
  inProductionAt: z.date().optional(),
  /** Thời điểm bản ghi được cập nhật lần cuối (Mongoose timestamps). */
  updatedAt: z.date().optional(),
  designerStatus: z.nativeEnum(DesignerStatus),
  designerAssignedAt: z.date().optional(),
  designerStartedAt: z.date().optional(),
  designerFirstStartedAt: z.date().optional(),
  designerCompletedAt: z.date().optional(),
  designerRejectedAt: z.date().optional(),
  designerReworkAt: z.date().optional(),
  designerRejectedReason: z.string().optional(),
  designerReworkCount: z.number().int().nonnegative(),
  designerWorkMs: z.number().int().nonnegative().default(0),
  productionError: z.string().optional(),
  productionErrorNote: z.string().optional(),
  /** Mã loại file sửa lỗi (category error_file_type) — resolve name ở FE store. */
  errorFile: z.string().array().optional(),
  /** Ghi chú file lỗi (free text). */
  errorFileNote: z.string().optional(),
  /** Lịch sử "báo không làm được → bàn giao" (cho drawer "Không làm được"). */
  designerRejections: z
    .object({
      fromUserId: z.string(),
      toUserId: z.string(),
      reason: z.string().optional(),
      at: z.date(),
    })
    .array()
    .optional(),
});
export type DesignerTaskCard = z.infer<typeof DesignerTaskCardZod>;

export const GetMyTasksZod = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  /** Faceted filters — CSV của workshop_config code (hoặc product type). */
  type: z.string().optional(),
  fabricType: z.string().optional(),
  machineNumber: z.string().optional(),
  toolResult: z.string().optional(),
  /** CSV workshop_config code (category tool_result_note) — lọc theo note kq Tool. */
  toolResultNote: z.string().optional(),
  /** CSV userSku — lọc theo khách hàng sở hữu đơn. */
  userSku: z.string().optional(),
  /**
   * CSV workshop_config code (category error_file_type) — lọc theo File sửa lỗi.
   * Field mảng trên order: khớp nếu đơn chứa BẤT KỲ mã nào đã chọn (`$in`).
   */
  errorFile: z.string().optional(),
  /** Free-text search (productionId/orderId). */
  search: z.string().optional(),
  /**
   * **Xem thay** — `_id` của designer cần xem thay vì chính mình. CHỈ
   * SuperAdmin/Admin/Manager dùng được (BE 403 với role khác); bỏ trống = xem
   * task của chính mình như cũ. Mọi endpoint `my-*` của trang này phải nhận
   * CÙNG giá trị, nếu không kanban là của người A còn KPI/breakdown là của
   * người đang đăng nhập — số đá nhau mà không có lỗi nào nổ ra.
   */
  viewUserId: IDZod.optional(),
});
export class GetMyTasksDto extends createZodDto(extendApi(GetMyTasksZod)) {}

export const MyTasksColumnsZod = z.object({
  assigned: DesignerTaskCardZod.array(),
  inProgress: DesignerTaskCardZod.array(),
  rework: DesignerTaskCardZod.array(),
  /** Hoàn thành KHÔNG dính lỗi (designerReworkCount = 0). */
  done: DesignerTaskCardZod.array(),
  /** Hoàn thành SAU KHI sửa lỗi (designerReworkCount > 0) — tách khỏi `done`. */
  fixed: DesignerTaskCardZod.array(),
  /**
   * "Đang chờ quay lại" — task designer (đã xong/đang chờ làm lại) của đơn đang
   * bị giữ ở Soát tool phía trên (In báo thiếu file). Chờ Support soát xong →
   * chuyển sang `rework` ("Cần làm lại"). Chỉ đơn `assignee = chính designer đó`.
   */
  watching: DesignerTaskCardZod.array(),
});

export const GetMyTasksResZod = ResZod.extend({
  data: z.object({
    columns: MyTasksColumnsZod,
    rejected: DesignerTaskCardZod.array(),
    /**
     * userId của người mà kanban này thuộc về (= ID, không phải display) —
     * bằng người đăng nhập, HOẶC bằng `viewUserId` khi admin đang xem thay.
     */
    userId: z.string(),
    /** Tên của CHÍNH người ở `userId` (không phải người đăng nhập) — tiêu đề trang đọc trường này. */
    fullName: z.string().optional(),
  }),
});
export class GetMyTasksResDto extends createZodDto(extendApi(GetMyTasksResZod)) {}

export const DesignerMyStatsZod = z.object({
  assignedCount: z.number().int().nonnegative(),
  inProgressCount: z.number().int().nonnegative(),
  reworkCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  /** Tổng done trong period (gồm cả đã sửa) — giữ nguyên ý nghĩa cũ. */
  completedInPeriod: z.number().int().nonnegative(),
  /** Done trong period MÀ từng bị báo lỗi (designerReworkCount > 0) = "Đã sửa".
   *  "Đã xong" thuần = completedInPeriod − fixedInPeriod. */
  fixedInPeriod: z.number().int().nonnegative(),
  avgResponseMin: z.number().nonnegative(),
  avgWorkMin: z.number().nonnegative(),
  errorRate: z.number().nonnegative(),
});
export type DesignerMyStats = z.infer<typeof DesignerMyStatsZod>;

export const GetMyStatsZod = z.object({
  period: z.enum(['today', '7d', '30d', 'custom']).default('today'),
  from: z.string().optional(),
  to: z.string().optional(),
  /**
   * **Xem thay** — `_id` của designer cần xem thay vì chính mình. CHỈ
   * SuperAdmin/Admin/Manager dùng được (BE 403 với role khác); bỏ trống = xem
   * task của chính mình như cũ. Mọi endpoint `my-*` của trang này phải nhận
   * CÙNG giá trị, nếu không kanban là của người A còn KPI/breakdown là của
   * người đang đăng nhập — số đá nhau mà không có lỗi nào nổ ra.
   */
  viewUserId: IDZod.optional(),
});
export class GetMyStatsDto extends createZodDto(extendApi(GetMyStatsZod)) {}

export const GetMyStatsResZod = ResZod.extend({ data: DesignerMyStatsZod });
export class GetMyStatsResDto extends createZodDto(extendApi(GetMyStatsResZod)) {}

// ─── My daily breakdown (per-day status counts, current sub-designer) ─
// Bảng "Chi tiết theo ngày" trên /my-tasks: gom đơn CỦA CHÍNH USER theo ngày
// VÀO SẢN XUẤT (`inProductionAt`, tz VN) trong N ngày gần nhất (7/14/30) —
// focus vào đơn CHƯA XONG (assigned/rework/in-progress) để designer nhìn ra
// đơn tồn cũ chưa làm. `done` hiển thị kèm (muted) để đối chiếu khối lượng.

export const DesignerDailyBreakdownDayZod = z.object({
  /** Ngày vào sản xuất `YYYY-MM-DD` (VN). */
  day: z.string(),
  /** Số ngày tuổi tính tới hôm nay (>=0). Càng lớn = đơn càng cũ. */
  ageDays: z.number().int().nonnegative(),
  assigned: z.number().int().nonnegative(),
  rework: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  /** = assigned + rework + inProgress (đơn chưa làm xong trong ngày). */
  unfinished: z.number().int().nonnegative(),
});
export type DesignerDailyBreakdownDay = z.infer<typeof DesignerDailyBreakdownDayZod>;

export const GetMyDailyBreakdownZod = z.object({
  /** Cửa sổ ngày gần nhất — chỉ 7/14/30 (string trên query, coerce ở service). */
  days: z.enum(['7', '14', '30']).default('7'),
  /**
   * **Xem thay** — `_id` của designer cần xem thay vì chính mình. CHỈ
   * SuperAdmin/Admin/Manager dùng được (BE 403 với role khác); bỏ trống = xem
   * task của chính mình như cũ. Mọi endpoint `my-*` của trang này phải nhận
   * CÙNG giá trị, nếu không kanban là của người A còn KPI/breakdown là của
   * người đang đăng nhập — số đá nhau mà không có lỗi nào nổ ra.
   */
  viewUserId: IDZod.optional(),
});
export class GetMyDailyBreakdownDto extends createZodDto(extendApi(GetMyDailyBreakdownZod)) {}

export const GetMyDailyBreakdownResZod = ResZod.extend({
  data: z.object({
    /** Chỉ các ngày CÓ đơn (>=1 status). Đã sort mới → cũ. */
    days: DesignerDailyBreakdownDayZod.array(),
    totals: z.object({
      assigned: z.number().int().nonnegative(),
      rework: z.number().int().nonnegative(),
      inProgress: z.number().int().nonnegative(),
      done: z.number().int().nonnegative(),
      unfinished: z.number().int().nonnegative(),
    }),
    /** Echo N (7/14/30). */
    rangeDays: z.number().int().positive(),
  }),
});
export class GetMyDailyBreakdownResDto extends createZodDto(extendApi(GetMyDailyBreakdownResZod)) {}

// ─── Team daily breakdown (Admin/Leader — MỌI designer × ngày) ───────
// Ma trận Designer × Ngày (inProductionAt, tz VN) cho tab Dashboard Designer:
// admin thấy tất cả designer theo thời gian + trạng thái cùng lúc. Snapshot lens
// (giống my-daily-breakdown nhưng scope toàn team, KHÔNG chỉ 1 user). Mỗi ô focus
// 3 trạng thái CHƯA XONG (assigned/rework/inProgress) + done kèm (tooltip/totals).

export const TeamDailyCellZod = z.object({
  assigned: z.number().int().nonnegative(),
  rework: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  /** Số LẦN "Không làm được" (bàn giao đi) — event `designerRejections.fromUserId`. */
  rejected: z.number().int().nonnegative(),
  /** Số LẦN nhận bàn giao từ người khác — event `designerRejections.toUserId`. ĐÃ nằm trong 4 trạng thái/rejected của người nhận, KHÔNG cộng vào tổng đã nhận. */
  received: z.number().int().nonnegative(),
  /** = assigned + rework + inProgress. */
  unfinished: z.number().int().nonnegative(),
});
export type TeamDailyCell = z.infer<typeof TeamDailyCellZod>;

export const TeamDailyRowZod = z.object({
  /** = user._id. */
  userId: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  /** Cell mỗi ngày, ĐỒNG BỘ index với `days[]` top-level (đã fill 0). */
  cells: TeamDailyCellZod.array(),
  /** Tổng theo designer trên toàn window. */
  totals: TeamDailyCellZod,
  /**
   * Chỉ số phụ trong kỳ (widget Top Designer): tổng task mọi trạng thái +
   * số LOẠI sản phẩm khác nhau (distinct `order.type`) trong các task đó;
   * avg response/work chỉ tính trên task done (cùng công thức leaderboard
   * `getPerformance`). Không set cho row inactive.
   */
  metrics: z
    .object({
      totalTasks: z.number().int().nonnegative(),
      productTypes: z.number().int().nonnegative(),
      /** Tên các loại (sort A→Z, cap 30) cho tooltip — FE hiện "+N khác" nếu thiếu. */
      productTypeNames: z.string().array(),
      /** 0 nếu chưa có task done trong kỳ. */
      avgResponseMin: z.number().nonnegative(),
      avgWorkMin: z.number().nonnegative(),
    })
    .optional(),
});
export type TeamDailyRow = z.infer<typeof TeamDailyRowZod>;

export const GetTeamDailyBreakdownZod = z.object({
  days: z.enum(['7', '14', '30']).default('7'),
  /** Nếu truyền `from`/`to` (YYYY-MM-DD, VN) → dùng khoảng tùy chỉnh thay `days`
   *  (cho biểu đồ "theo designer" có date-range riêng). `days` bị bỏ qua. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** Lọc theo sản phẩm (`order.type`). Bỏ trống = tất cả. */
  type: z.string().optional(),
  /** Lọc theo khách hàng (`order.userSku`). Bỏ trống = tất cả. */
  customer: z.string().optional(),
});
export class GetTeamDailyBreakdownDto extends createZodDto(extendApi(GetTeamDailyBreakdownZod)) {}

// ─── Filter options cho matrix/biểu đồ designer (sản phẩm + khách hàng) ──

export const GetBreakdownFiltersZod = z.object({
  /** YYYY-MM-DD (VN) — option/count tính trong kỳ này. Bỏ trống = 7 ngày gần nhất. */
  from: z.string().optional(),
  to: z.string().optional(),
});
export class GetBreakdownFiltersDto extends createZodDto(extendApi(GetBreakdownFiltersZod)) {}

export const BreakdownFilterOptionZod = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
});
export type BreakdownFilterOption = z.infer<typeof BreakdownFilterOptionZod>;

export const GetBreakdownFiltersResZod = ResZod.extend({
  data: z.object({
    /** Danh sách sản phẩm (`order.type`) có đơn đã gán designer, sort count desc. */
    products: BreakdownFilterOptionZod.array(),
    /** Danh sách khách hàng (`order.userSku`), sort count desc (cap 300). */
    customers: BreakdownFilterOptionZod.array(),
  }),
});
export class GetBreakdownFiltersResDto extends createZodDto(extendApi(GetBreakdownFiltersResZod)) {}

export const GetTeamDailyBreakdownResZod = ResZod.extend({
  data: z.object({
    /** Cột ngày `YYYY-MM-DD` (VN), sort mới → cũ. */
    days: z.string().array(),
    /** Per-designer, sort theo unfinished desc (ai tồn nhiều lên đầu). */
    rows: TeamDailyRowZod.array(),
    /** Tổng mỗi ngày (đồng bộ index với `days[]`). */
    columnTotals: TeamDailyCellZod.array(),
    grandTotals: TeamDailyCellZod,
    rangeDays: z.number().int().positive(),
  }),
});
export class GetTeamDailyBreakdownResDto extends createZodDto(extendApi(GetTeamDailyBreakdownResZod)) {}

// ─── Performance scores (bảng xếp hạng hiệu suất + designerLevel) ────────
// Điểm 0-100 mỗi designer trong kỳ lọc = tổng 6 thành phần có trọng số:
// tốc độ chuẩn hóa theo rổ sản phẩm 30% + chất lượng 25% + sản lượng 15% +
// phản hồi 10% + độ tin cậy 10% + chủ động nhận task 10%. Hạng S/A/B/C/D
// qua `rankFromScore`.

export const GetPerformanceScoresZod = z.object({
  /** YYYY-MM-DD (VN). Bỏ trống = 7 ngày gần nhất. */
  from: z.string().optional(),
  to: z.string().optional(),
});
export class GetPerformanceScoresDto extends createZodDto(extendApi(GetPerformanceScoresZod)) {}

export const PerformanceComponentsZod = z.object({
  /** Mỗi thành phần 0..1 (0.5 = trung bình team / thiếu dữ liệu). */
  speed: z.number(),
  quality: z.number(),
  throughput: z.number(),
  response: z.number(),
  reliability: z.number(),
  /**
   * Chủ động nhận thêm task: đếm số lần TỰ "Nhận về mình" (OrderLog
   * field='assignee' mà actor = người được gán, theo createdAt trong kỳ).
   * 0 lần = 0.5 trung lập (không bị phạt), nhận càng nhiều so với mặt bằng
   * người có nhận càng tiến tới 1.
   */
  proactive: z.number(),
});
export type PerformanceComponents = z.infer<typeof PerformanceComponentsZod>;

export const PerformanceScoreRowZod = z.object({
  userId: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  /** Task trong kỳ (mọi trạng thái) / đã xong. */
  totalTasks: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  rank: z.nativeEnum(DesignerRank),
  /** done < minDone → điểm chỉ tham khảo, FE hiển thị "chưa đủ dữ liệu". */
  insufficient: z.boolean(),
  components: PerformanceComponentsZod,
  /** Số liệu thô để tooltip giải thích. */
  avgWorkMin: z.number().nonnegative(),
  avgResponseMin: z.number().nonnegative(),
  reworkCount: z.number().int().nonnegative(),
  rejections: z.number().int().nonnegative(),
  /** Số lần tự "Nhận về mình" trong kỳ. */
  claims: z.number().int().nonnegative(),
  /** score − điểm kỳ liền trước cùng độ dài; null nếu kỳ trước thiếu dữ liệu. */
  trend: z.number().nullable(),
  /** Hạng gợi ý từ rolling 60 ngày (nguồn cho designerLevel); null nếu thiếu dữ liệu. */
  suggestedLevel: z.nativeEnum(DesignerRank).nullable(),
  /** Level chính thức đang set trên user (nếu có). */
  designerLevel: z.nativeEnum(DesignerRank).optional(),
});
export type PerformanceScoreRow = z.infer<typeof PerformanceScoreRowZod>;

export const GetPerformanceScoresResZod = ResZod.extend({
  data: z.object({
    rows: PerformanceScoreRowZod.array(),
    /** Ngưỡng done tối thiểu để xếp hạng chính thức. */
    minDone: z.number().int().positive(),
  }),
});
export class GetPerformanceScoresResDto extends createZodDto(extendApi(GetPerformanceScoresResZod)) {}

export const SetDesignerLevelZod = z.object({
  /** null = xóa level (về "chưa xếp"). */
  level: z.nativeEnum(DesignerRank).nullable(),
});
export class SetDesignerLevelDto extends createZodDto(extendApi(SetDesignerLevelZod)) {}

export const SetDesignerLevelResZod = ResZod.extend({
  data: z.object({ userId: z.string(), level: z.nativeEnum(DesignerRank).nullable() }),
});
export class SetDesignerLevelResDto extends createZodDto(extendApi(SetDesignerLevelResZod)) {}

// ─── Product time (panel "Xem tất cả" từ widget Top Designer) ────────────
// Thời gian TB nhận/làm task theo TỪNG loại sản phẩm (`order.type`) của TOÀN
// BỘ designer trong kỳ lọc; drill 1 sản phẩm → danh sách đơn/thiết kế.

export const GetProductTimeOverviewZod = z.object({
  /** YYYY-MM-DD (VN). Bỏ trống = 7 ngày gần nhất. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** Lọc theo sản phẩm (`order.type`) — filter chung của tab. */
  type: z.string().optional(),
  /** Lọc theo khách hàng (`order.userSku`). */
  customer: z.string().optional(),
  /** Set → chế độ "Xem chi tiết" 1 designer (chỉ đơn của người này). */
  designerId: z.string().optional(),
});
export class GetProductTimeOverviewDto extends createZodDto(extendApi(GetProductTimeOverviewZod)) {}

export const ProductTimeRowZod = z.object({
  /** `order.type` — '' nếu đơn không có type. */
  type: z.string(),
  /** Ảnh đại diện (mockup của 1 đơn thuộc loại này — `$max mockupUrl`). */
  mockupUrl: z.string().optional(),
  /** Tổng task đã gán designer trong kỳ (mọi trạng thái). */
  taskCount: z.number().int().nonnegative(),
  doneCount: z.number().int().nonnegative(),
  /** TB trên task done — 0 nếu chưa có. Cùng công thức leaderboard. */
  avgResponseMin: z.number().nonnegative(),
  avgWorkMin: z.number().nonnegative(),
  /**
   * ProductConfig khớp `type` (fullName case-insensitive — cùng cách importOrders
   * map config; fallback `productConfigId` phổ biến nhất trên đơn). FE gán level
   * qua `PATCH /product-configs/:id` sẵn có. Rỗng = chưa có config → không gán được.
   */
  productConfigId: z.string().optional(),
  /** Level chính thức 1..10 từ `ProductConfig.level` (PRODUCT_LEVELS). */
  level: z.number().int().min(1).max(10).optional(),
  /**
   * Gợi ý level 1..10 — percentile tương đối 60 ngày gần nhất (cố định, không theo
   * kỳ lọc): 0.7×percentile thời gian làm TB + 0.3×percentile tỉ lệ làm lại.
   * Chỉ có khi ≥ PRODUCT_SUGGEST_MIN_DONE đơn xong trong cửa sổ.
   */
  suggestedLevel: z.number().int().min(1).max(10).optional(),
  /** Căn cứ gợi ý (cửa sổ 60 ngày): số đơn xong / TB phút làm / % làm lại. */
  suggestDone: z.number().int().nonnegative().optional(),
  suggestAvgWorkMin: z.number().nonnegative().optional(),
  suggestReworkPct: z.number().nonnegative().optional(),
});
export type ProductTimeRow = z.infer<typeof ProductTimeRowZod>;

export const GetProductTimeOverviewResZod = ResZod.extend({
  data: z.object({ rows: ProductTimeRowZod.array() }),
});
export class GetProductTimeOverviewResDto extends createZodDto(extendApi(GetProductTimeOverviewResZod)) {}

export const GetProductTimeOrdersZod = z.object({
  /** `order.type` của sản phẩm đang drill (bắt buộc; '' = đơn không có type). */
  type: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  customer: z.string().optional(),
  /** Set → chế độ "Xem chi tiết" 1 designer (chỉ đơn của người này). */
  designerId: z.string().optional(),
});
export class GetProductTimeOrdersDto extends createZodDto(extendApi(GetProductTimeOrdersZod)) {}

export const ProductTimeDesignerZod = z.object({
  userId: z.string(),
  name: z.string().optional(),
  /** Số đơn của sản phẩm này designer đó ôm trong kỳ (mọi trạng thái, KHÔNG cap). */
  taskCount: z.number().int().nonnegative(),
  doneCount: z.number().int().nonnegative(),
  /** TB trên task done của riêng designer đó — 0 nếu chưa có. */
  avgResponseMin: z.number().nonnegative(),
  avgWorkMin: z.number().nonnegative(),
});
export type ProductTimeDesigner = z.infer<typeof ProductTimeDesignerZod>;

export const ProductTimeOrderRowZod = z.object({
  _id: z.string(),
  productionId: z.string().optional(),
  /** Khách hàng của đơn (`order.userSku`). */
  userSku: z.string().optional(),
  /** = user._id — FE gom đơn về nhóm designer tương ứng. */
  assigneeId: z.string().optional(),
  assigneeName: z.string().optional(),
  designerStatus: z.string().optional(),
  mockupUrl: z.string().optional(),
  /** ISO — ngày vào sản xuất. */
  inProductionAt: z.string().optional(),
  /** Phút — undefined nếu chưa đủ mốc thời gian để tính. */
  responseMin: z.number().nonnegative().optional(),
  workMin: z.number().nonnegative().optional(),
});
export type ProductTimeOrderRow = z.infer<typeof ProductTimeOrderRowZod>;

export const GetProductTimeOrdersResZod = ResZod.extend({
  data: z.object({
    /** Thống kê per-designer trên TOÀN BỘ đơn khớp, sort taskCount desc. */
    designers: ProductTimeDesignerZod.array(),
    /** Cap 300 đơn mới nhất theo `inProductionAt`. */
    rows: ProductTimeOrderRowZod.array(),
  }),
});
export class GetProductTimeOrdersResDto extends createZodDto(extendApi(GetProductTimeOrdersResZod)) {}

// ─── Daily overview (bảng 4 hàng: tổng đơn / chưa soát / lỗi / tồn) ──────

export const GetDailyOverviewZod = z.object({
  days: z.enum(['7', '14', '30']).default('7'),
  /** Khoảng tùy biến (YYYY-MM-DD, VN) — nếu truyền cả 2 thì dùng thay `days`. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** Lọc theo sản phẩm (`order.type`). */
  type: z.string().optional(),
  /** Lọc theo khách hàng (`order.userSku`). */
  customer: z.string().optional(),
});
export class GetDailyOverviewDto extends createZodDto(extendApi(GetDailyOverviewZod)) {}

export const DailyOverviewErrorNoteZod = z.object({
  code: z.string(),
  count: z.number().int().nonnegative(),
});

export const DailyOverviewRowZod = z.object({
  day: z.string(),
  /** Tất cả đơn inProductionAt ngày đó, mọi trạng thái. */
  total: z.number().int().nonnegative(),
  /** toolResultNote === 'ok' (đã soát xong, không lỗi). */
  ok: z.number().int().nonnegative(),
  /** toolResultNote null/'' (chưa soát tool). */
  unreviewed: z.number().int().nonnegative(),
  /** Tổng đơn ĐANG lỗi (toolResultNote set & != '' & != 'ok') — còn lại chưa xử lý xong. */
  error: z.number().int().nonnegative(),
  /** Đơn ĐANG lỗi & chưa gán designer (assignee rỗng). */
  errorUnassigned: z.number().int().nonnegative(),
  /** "Soát lỗi": đơn TỪNG bị người soát đánh note lỗi ≠ 'ok' (toolCheckErrorNotes non-empty — LỊCH SỬ, giữ kể cả đã sửa về 'ok'). */
  toolError: z.number().int().nonnegative(),
  /** Trong toolError: đơn ĐÃ sửa xong (toolResultNote hiện tại = 'ok'). */
  toolErrorFixed: z.number().int().nonnegative(),
  /** Trong toolError: đơn còn đang lỗi & chưa gán designer. */
  toolErrorUnassigned: z.number().int().nonnegative(),
  /** Breakdown theo MÃ LỖI MỚI NHẤT của đơn (phần tử cuối toolCheckErrorNotes) — mỗi đơn đúng 1 dòng, tổng = toolError. */
  toolErrorByNote: DailyOverviewErrorNoteZod.array(),
  /** Đã gán designer (assignee set + designerStatus ∈ 4 trạng thái) & TỪNG lỗi soát tool. */
  assignedToolError: z.number().int().nonnegative(),
  /** Đã gán designer & CHƯA từng lỗi soát tool (ok/chưa soát bị đẩy về). assignedToolError + assignedWasOk = Tổng/ngày ma trận team. */
  assignedWasOk: z.number().int().nonnegative(),
  /** Đơn CHƯA từng lỗi soát tool nhưng đã vào flow designer (designerStatus ∈ 4) — "OK/chưa soát → đẩy về", tính lịch sử (gồm rework chưa ai ôm). */
  wasOkPushed: z.number().int().nonnegative(),
  /** "Chưa gán designer": pool cần designer (toolCheckErrorNotes non-empty ∨ designerStatus ∈ 4) & CHƯA gán & ĐANG lỗi (note set ≠ 'ok'). */
  unassignedNeed: z.number().int().nonnegative(),
  /** Trong unassignedNeed: phần TỪNG lỗi soát tool (phần còn lại = ok/chưa soát bị đẩy về). */
  unassignedNeedTool: z.number().int().nonnegative(),
  /** Pool & chưa gán nhưng note ĐÃ về 'ok'/rỗng — đã xử lý không cần designer. Bất biến: toolError + wasOkPushed = assignedTotal + unassignedNeed + unassignedResolved. */
  unassignedResolved: z.number().int().nonnegative(),
  /** Design ĐÃ XONG: assignee set + designerStatus='done' (⊂ Đã gán — khớp cột "Đã xong" ma trận team). */
  designDone: z.number().int().nonnegative(),
  /** Breakdown theo từng mã note ≠ ok, sort count desc. */
  errorByNote: DailyOverviewErrorNoteZod.array(),
  /** toolResultNote != 'ok' = unreviewed + error (chưa soát + lỗi). */
  backlog: z.number().int().nonnegative(),
  /** Riêng số đơn designerStatus=unassigned trong ngày (cho bảng xổ "Chưa gán"). */
  unassigned: z.number().int().nonnegative(),
});
export type DailyOverviewRow = z.infer<typeof DailyOverviewRowZod>;

export const DailyOverviewBacklogDesignerZod = z.object({
  userId: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  assigned: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  rework: z.number().int().nonnegative(),
  /** = assigned+inProgress+rework (chỉ trả khi >0). "Không làm được" (rejected) KHÔNG tính là tồn. */
  total: z.number().int().nonnegative(),
});
export type DailyOverviewBacklogDesigner = z.infer<typeof DailyOverviewBacklogDesignerZod>;

export const DailyOverviewColumnTotalsZod = z.object({
  total: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  unreviewed: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  errorUnassigned: z.number().int().nonnegative(),
  toolError: z.number().int().nonnegative(),
  toolErrorFixed: z.number().int().nonnegative(),
  toolErrorUnassigned: z.number().int().nonnegative(),
  assignedToolError: z.number().int().nonnegative(),
  assignedWasOk: z.number().int().nonnegative(),
  wasOkPushed: z.number().int().nonnegative(),
  unassignedNeed: z.number().int().nonnegative(),
  unassignedNeedTool: z.number().int().nonnegative(),
  unassignedResolved: z.number().int().nonnegative(),
  designDone: z.number().int().nonnegative(),
  backlog: z.number().int().nonnegative(),
});

export const GetDailyOverviewResZod = ResZod.extend({
  data: z.object({
    /** Cột ngày `YYYY-MM-DD` (VN), sort mới → cũ (FE reverse để hiển thị cũ→mới). */
    days: z.string().array(),
    rows: DailyOverviewRowZod.array(),
    /** Tồn per-designer trên toàn window (cho bảng con expand hàng Tồn). */
    backlogByDesigner: DailyOverviewBacklogDesignerZod.array(),
    /** Đơn unassigned toàn window — dòng riêng "Chưa gán". */
    unassignedBacklog: z.number().int().nonnegative(),
    columnTotals: DailyOverviewColumnTotalsZod,
    rangeDays: z.number().int().positive(),
  }),
});
export class GetDailyOverviewResDto extends createZodDto(extendApi(GetDailyOverviewResZod)) {}

// ─── Assign backlog (bảng "Cần gán designer" gom theo sản phẩm) ──────

export const GetAssignBacklogZod = z.object({
  days: z.enum(['7', '14', '30']).default('7'),
  /** Khoảng tùy biến (YYYY-MM-DD, VN) — nếu truyền cả 2 thì dùng thay `days`. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** Lọc theo sản phẩm (`order.type`). */
  type: z.string().optional(),
  /** Lọc theo khách hàng (`order.userSku`). */
  customer: z.string().optional(),
});
export class GetAssignBacklogDto extends createZodDto(extendApi(GetAssignBacklogZod)) {}

/** 1 đơn rút gọn read-only trong nhóm sản phẩm. */
export const AssignBacklogOrderZod = z.object({
  _id: z.string(),
  productionId: z.string(),
  userSku: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  type: z.string().optional(),
  mockupUrl: z.string().optional(),
  mockupOriginalUrl: z.string().optional(),
  toolResultNote: z.string().optional(),
  designerStatus: z.string().optional(),
  inProductionAt: z.string().optional(),
  /** Mức ưu tiên (xem `order-priority.ts`) — hiện badge + estimate (mốc `inProductionAt`, đơn chưa chạy bước nào). */
  priority: z.nativeEnum(OrderPriority).optional(),
});
export type AssignBacklogOrder = z.infer<typeof AssignBacklogOrderZod>;

/** 1 nhóm = 1 sản phẩm (productConfig) hoặc "Chưa map". */
export const AssignBacklogGroupZod = z.object({
  /** productConfigId | 'unmapped'. */
  key: z.string(),
  fullName: z.string(),
  shortName: z.string().optional(),
  /** Ảnh mockup sản phẩm (ProductConfig). */
  mockup: z.string().optional(),
  /** Level 1..10 (ProductConfig). */
  level: z.number().int().optional(),
  count: z.number().int().nonnegative(),
  /** Toàn bộ id đơn trong nhóm (cho chọn-cả-nhóm + assign). */
  orderIds: z.string().array(),
  orders: AssignBacklogOrderZod.array(),
});
export type AssignBacklogGroup = z.infer<typeof AssignBacklogGroupZod>;

export const GetAssignBacklogResZod = ResZod.extend({
  data: z.object({
    groups: AssignBacklogGroupZod.array(),
    total: z.number().int().nonnegative(),
    rangeDays: z.number().int().positive(),
  }),
});
export class GetAssignBacklogResDto extends createZodDto(extendApi(GetAssignBacklogResZod)) {}

// ─── Product breakdown per designer (tooltip biểu đồ Cơ cấu trạng thái) ──

export const GetProductBreakdownZod = z.object({
  days: z.enum(['7', '14', '30']).default('7'),
  from: z.string().optional(),
  to: z.string().optional(),
  type: z.string().optional(),
  customer: z.string().optional(),
});
export class GetProductBreakdownDto extends createZodDto(extendApi(GetProductBreakdownZod)) {}

export const ProductBreakdownItemZod = z.object({
  /** = order.type (định danh sản phẩm hiển thị). */
  type: z.string(),
  fullName: z.string().optional(),
  shortName: z.string().optional(),
  mockup: z.string().optional(),
  level: z.number().int().optional(),
  count: z.number().int().nonnegative(),
});
export type ProductBreakdownItem = z.infer<typeof ProductBreakdownItemZod>;

export const ProductBreakdownDesignerZod = z.object({
  userId: z.string(),
  fullName: z.string(),
  total: z.number().int().nonnegative(),
  products: ProductBreakdownItemZod.array(),
});
export type ProductBreakdownDesigner = z.infer<typeof ProductBreakdownDesignerZod>;

export const GetProductBreakdownResZod = ResZod.extend({
  data: z.object({ designers: ProductBreakdownDesignerZod.array() }),
});
export class GetProductBreakdownResDto extends createZodDto(extendApi(GetProductBreakdownResZod)) {}

// ─── Bulk transition (Phase 4 extension) ────────────────────────────

export const DesignerBulkTransitionZod = z.object({
  ids: IDZod.array().min(1),
  action: z.nativeEnum(DesignerTransitionAction),
  /** Lý do (tùy chọn) khi action='reject'. */
  reason: z.string().max(500).optional(),
  /** BẮT BUỘC khi action='reject' — designer nhận thay cho TẤT CẢ đơn đã chọn. */
  targetUserId: IDZod.optional(),
});
export class DesignerBulkTransitionDto extends createZodDto(extendApi(DesignerBulkTransitionZod)) {}

export const DesignerBulkTransitionResZod = ResZod.extend({
  data: z.object({
    matched: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    skipped: z
      .object({
        orderId: z.string(),
        productionId: z.string(),
        reason: z.string(),
      })
      .array(),
  }),
});
export class DesignerBulkTransitionResDto extends createZodDto(extendApi(DesignerBulkTransitionResZod)) {}

// ─── My-task filter options (faceted) ───────────────────────────────

export const FilterOptionZod = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
});

export const GetMyTaskFiltersResZod = ResZod.extend({
  data: z.object({
    type: FilterOptionZod.array(),
    fabricType: FilterOptionZod.array(),
    machineNumber: FilterOptionZod.array(),
    toolResult: FilterOptionZod.array(),
    toolResultNote: FilterOptionZod.array(),
    userSku: FilterOptionZod.array(),
    errorFile: FilterOptionZod.array(),
  }),
});
export class GetMyTaskFiltersResDto extends createZodDto(extendApi(GetMyTaskFiltersResZod)) {}

// ─── Designer breakdown (Admin / Leader on /orders page) ────────────

/** KPI counts theo designerStatus. */
export const DesignerStatusCountsZod = z.object({
  /** "Chưa gán không tool" — chưa gán & note≠'ok' & KHÔNG "Có tool" (name ^Có). */
  unassigned: z.number().int().nonnegative(),
  /** Tổng chưa gán = có-tool + không-tool (chưa gán & note≠'ok', cả 2 loại tool). */
  unassignedAll: z.number().int().nonnegative(),
  assigned: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  rework: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type DesignerStatusCounts = z.infer<typeof DesignerStatusCountsZod>;

/** 1 row per sub-designer + 1 row pseudo cho "Chưa gán". */
export const DesignerBreakdownRowZod = z.object({
  /** = user._id, hoặc `'__unassigned__'` cho row pseudo. */
  userId: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  counts: DesignerStatusCountsZod,
});
export type DesignerBreakdownRow = z.infer<typeof DesignerBreakdownRowZod>;

export const DesignerBreakdownResZod = ResZod.extend({
  data: z.object({
    /** KPI total theo FILTER hiện tại (narrow). */
    scoped: DesignerStatusCountsZod,
    /** KPI overall — KHÔNG áp filter, dùng làm tham chiếu. */
    overall: DesignerStatusCountsZod,
    /** Per-designer (filter-scoped). Đã sort theo total desc. */
    perDesigner: DesignerBreakdownRowZod.array(),
  }),
});
export class DesignerBreakdownResDto extends createZodDto(extendApi(DesignerBreakdownResZod)) {}

// ─── Backlog tồn đọng theo Designer × Ngày (inProductionAt) ──────────
// Đơn CHƯA done gom theo người ôm × ngày vào sản xuất. "Không làm được"
// (rejected) KHÔNG tính là tồn (nằm ở backlog "Cần gán" để leader gán lại).
// Dùng cho modal "Chi tiết tồn đọng" trên Danh sách đơn.

/** Phân rã trạng thái tồn (KHÔNG có done, KHÔNG có rejected). */
export const BacklogStatusCountsZod = z.object({
  unassigned: z.number().int().nonnegative(),
  assigned: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  rework: z.number().int().nonnegative(),
});
export type BacklogStatusCounts = z.infer<typeof BacklogStatusCountsZod>;

export const DesignerBacklogDayZod = z.object({
  /** Ngày vào sản xuất `YYYY-MM-DD` (VN), hoặc `'__nodate__'` khi thiếu `inProductionAt`. */
  day: z.string(),
  /** Số ngày tuổi tính tới hôm nay (>=0). `-1` khi `__nodate__`. */
  ageDays: z.number().int(),
  total: z.number().int().nonnegative(),
  byStatus: BacklogStatusCountsZod,
});
export type DesignerBacklogDay = z.infer<typeof DesignerBacklogDayZod>;

export const DesignerBacklogRowZod = z.object({
  /** = user._id, hoặc `'__unassigned__'`. */
  userId: z.string(),
  fullName: z.string(),
  total: z.number().int().nonnegative(),
  /** Ngày tồn cũ nhất (YYYY-MM-DD) hoặc null. */
  oldestDay: z.string().nullable(),
  /** Số ngày tuổi của đơn cũ nhất. */
  oldestAgeDays: z.number().int(),
  /** Đã sort ngày cũ → mới. */
  days: DesignerBacklogDayZod.array(),
});
export type DesignerBacklogRow = z.infer<typeof DesignerBacklogRowZod>;

export const DesignerBacklogResZod = ResZod.extend({
  data: z.object({
    total: z.number().int().nonnegative(),
    oldestDay: z.string().nullable(),
    /** Per-designer, sort theo total tồn desc (Chưa gán đẩy cuối). */
    designers: DesignerBacklogRowZod.array(),
  }),
});
export class DesignerBacklogResDto extends createZodDto(extendApi(DesignerBacklogResZod)) {}

// ─── Stats dashboard (Phase 5) ──────────────────────────────────────

export const DesignerLeaderboardRowZod = z.object({
  /** = user._id. Key chính. */
  userId: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  /** Snapshot — đang ở các trạng thái này TẠI THỜI ĐIỂM hiện tại. */
  assignedCount: z.number().int().nonnegative(),
  inProgressCount: z.number().int().nonnegative(),
  reworkCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  completedInPeriod: z.number().int().nonnegative(),
  /** Done trong period MÀ từng bị báo lỗi (designerReworkCount > 0) = "Đã sửa". */
  fixedInPeriod: z.number().int().nonnegative(),
  /** Cumulative — tổng số LẦN đã trả lại TRONG period (đếm event từ OrderLog,
   *  kể cả task đã được re-assign sau đó). */
  totalRejected: z.number().int().nonnegative(),
  /** Cumulative — tổng số LẦN đã chuyển về rework TRONG period (kể cả task
   *  đã restart xong). */
  totalRework: z.number().int().nonnegative(),
  avgResponseMin: z.number().nonnegative(),
  avgWorkMin: z.number().nonnegative(),
  errorRate: z.number().nonnegative(),
});
export type DesignerLeaderboardRow = z.infer<typeof DesignerLeaderboardRowZod>;

export const GetDesignerPerformanceZod = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  /** Optional — chỉ lấy 1 user. */
  userId: z.string().optional(),
});
export class GetDesignerPerformanceDto extends createZodDto(extendApi(GetDesignerPerformanceZod)) {}

export const GetDesignerPerformanceResZod = ResZod.extend({
  data: DesignerLeaderboardRowZod.array(),
});
export class GetDesignerPerformanceResDto extends createZodDto(extendApi(GetDesignerPerformanceResZod)) {}

export const DesignerTimelineBucketZod = z.object({
  date: z.string(),
  assigned: z.number().int().nonnegative(),
  started: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  rework: z.number().int().nonnegative(),
});
export type DesignerTimelineBucket = z.infer<typeof DesignerTimelineBucketZod>;

export const GetDesignerTimelineZod = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
export class GetDesignerTimelineDto extends createZodDto(extendApi(GetDesignerTimelineZod)) {}

export const GetDesignerTimelineResZod = ResZod.extend({
  data: DesignerTimelineBucketZod.array(),
});
export class GetDesignerTimelineResDto extends createZodDto(extendApi(GetDesignerTimelineResZod)) {}

// ─── Production error stats (giữ — không liên quan assignee) ──────────

export const ErrorStatsCodeZod = z.object({
  code: z.string(),
  label: z.string().optional(),
  errorSource: z.enum(['designer', 'factory', 'tool-check']).optional(),
  count: z.number().int().nonnegative(),
});
export type ErrorStatsCode = z.infer<typeof ErrorStatsCodeZod>;

export const ErrorStatsZod = z.object({
  bySource: z.object({
    designer: z.number().int().nonnegative(),
    factory: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  byCode: ErrorStatsCodeZod.array(),
  total: z.number().int().nonnegative(),
});
export type ErrorStats = z.infer<typeof ErrorStatsZod>;

export const GetErrorStatsZod = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
export class GetErrorStatsDto extends createZodDto(extendApi(GetErrorStatsZod)) {}

export const GetErrorStatsResZod = ResZod.extend({ data: ErrorStatsZod });
export class GetErrorStatsResDto extends createZodDto(extendApi(GetErrorStatsResZod)) {}

// ─── Lỗi theo NGƯỜI (2 chiều) + Lỗi theo CÔNG ĐOẠN theo ngày ──────────
//
// Phục vụ:
//  - Dashboard tab "Lỗi theo người": leaderboard 2 chiều (đang cần fix +
//    đã báo lỗi) → click 1 người ra list đơn lỗi đang cần fix.
//  - Trang task fulfillment: ô thống kê lỗi công đoạn mình + bảng lỗi theo
//    ngày (group `inProductionAt`, VN tz).

export const GetPersonErrorOverviewZod = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().positive().optional(),
  factoryId: z.string().optional(),
});
export class GetPersonErrorOverviewDto extends createZodDto(extendApi(GetPersonErrorOverviewZod)) {}

export const PersonErrorRowZod = z.object({
  userId: z.string(),
  name: z.string(),
  /** "Designer" hoặc tên công đoạn fulfillment (In / Ép / …). */
  roleLabel: z.string(),
  factoryName: z.string().optional(),
  /** Đơn lỗi ĐANG cần người này sửa (snapshot) — bị quy lỗi / phải sửa. */
  needFixCount: z.number().int().nonnegative(),
  /** Số lần người này ĐÃ báo lỗi (đẩy về) trong kỳ — chiều phát hiện. */
  reportedCount: z.number().int().nonnegative(),
});
export type PersonErrorRow = z.infer<typeof PersonErrorRowZod>;

export const PersonErrorOverviewResZod = ResZod.extend({
  data: z.object({
    rows: PersonErrorRowZod.array(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});
export class PersonErrorOverviewResDto extends createZodDto(extendApi(PersonErrorOverviewResZod)) {}

export const GetPersonErrorOrdersZod = z.object({
  userId: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().positive().optional(),
});
export class GetPersonErrorOrdersDto extends createZodDto(extendApi(GetPersonErrorOrdersZod)) {}

export const PersonErrorOrderRowZod = z.object({
  _id: z.string(),
  productionId: z.string(),
  type: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  quantity: z.number().optional(),
  mockupUrl: z.string().optional(),
  productionError: z.string().optional(),
  productionErrorNote: z.string().optional(),
  productionErrorSource: z.string().optional(),
  currentFulfillmentStage: z.string().optional(),
  designerStatus: z.string().optional(),
  inProductionAt: z.date().optional(),
});
export const PersonErrorOrdersResZod = ResZod.extend({
  data: PersonErrorOrderRowZod.array(),
  total: z.number().int().nonnegative(),
});
export class PersonErrorOrdersResDto extends createZodDto(extendApi(PersonErrorOrdersResZod)) {}

export const GetStageErrorDailyZod = z.object({
  stage: z.nativeEnum(FulfillmentStage).optional(),
  factoryId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().positive().optional(),
});
export class GetStageErrorDailyDto extends createZodDto(extendApi(GetStageErrorDailyZod)) {}

export const StageErrorDailyRowZod = z.object({
  code: z.string(),
  name: z.string(),
  cells: z.number().int().nonnegative().array(),
  total: z.number().int().nonnegative(),
});
export const StageErrorDailyResZod = ResZod.extend({
  data: z.object({
    days: z.string().array(),
    rows: StageErrorDailyRowZod.array(),
    columnTotals: z.number().int().nonnegative().array(),
    grandTotal: z.number().int().nonnegative(),
  }),
});
export class StageErrorDailyResDto extends createZodDto(extendApi(StageErrorDailyResZod)) {}

// ─── Sidebar badge counts ───────────────────────────────────────────
// Số đếm gọn cho badge sidebar (Nhật ký bù lỗi / Designer / Soát tool).
// `null` = role người gọi không được xem con số đó → FE ẩn badge.
const SidebarCountZod = z.number().int().nonnegative();
/**
 * Open orders per product line (+ `__none__` = orders without one). One key per
 * `PRODUCT_LINES` entry, always present: a line with no orders reports 0 so staff
 * still see the line exists.
 */
export const ProductLineCountsZod = z.object({
  ...(Object.fromEntries(PRODUCT_LINES.map((l) => [l, SidebarCountZod])) as Record<ProductLine, typeof SidebarCountZod>),
  __none__: SidebarCountZod,
});
export type ProductLineCounts = z.infer<typeof ProductLineCountsZod>;

export const SidebarCountsZod = z.object({
  /** Đơn lỗi tab "Cần xử lý" theo góc nhìn chặng của người xem (mirror getErrorLog todo). */
  errorLogTodo: z.number().int().nonnegative().nullable(),
  /** Đơn cần gán designer trong 7 ngày (mirror getAssignBacklog.total). */
  designerUnassigned: z.number().int().nonnegative().nullable(),
  /** Tồn thiết kế 7 ngày (Admin/Leader: mirror columnTotals.backlog; Designer: tồn của chính họ). */
  designerBacklog: z.number().int().nonnegative().nullable(),
  /** Soát tool — đơn In trả về cần làm lại (mirror errorCount). */
  toolCheckRework: z.number().int().nonnegative().nullable(),
  /** Soát tool — đơn chưa soát trong 7 ngày (mirror unreviewedList). */
  toolCheckUnreviewed: z.number().int().nonnegative().nullable(),
  /**
   * Badge of the six "Production" menu entries: open orders per product line, equal
   * to the row count of `GET /orders?productLine=X&workshopStage=__open__` over the
   * last 7 VN calendar days (today included), same role scope. `null` when the role
   * cannot open the order list (`page.orders`).
   */
  productLineCounts: ProductLineCountsZod.nullable(),
  /**
   * CÙNG các con số trên nhưng TÁCH THEO XƯỞNG — badge cho cụm menu riêng
   * của từng xưởng ở sidebar (`Orders.md §25`). Key = `factoryId`; xưởng
   * không có đơn nào thì VẮNG khỏi map (FE coi như 0, không hiện badge).
   * Chỉ gồm những mục còn lại trong cụm xưởng — Designer đã bị loại khỏi cụm
   * nên không có số designer ở đây.
   */
  byFactory: z
    .record(
      z.object({
        errorLogTodo: z.number().int().nonnegative(),
        toolCheckRework: z.number().int().nonnegative(),
        toolCheckUnreviewed: z.number().int().nonnegative(),
      }),
    )
    .default({}),
});
export type SidebarCounts = z.infer<typeof SidebarCountsZod>;
export class GetSidebarCountsResDto extends createZodDto(extendApi(ResZod.extend({ data: SidebarCountsZod }))) {}

// ─── Overdue alert banner ───────────────────────────────────────────
// Banner đỏ toàn cục (MainLayout) — đơn quá hạn 2 NGÀY vẫn còn tồn: hôm nay 13
// thì đếm đơn `inProductionAt` ngày 11 trở về trước (trong cửa sổ 7 ngày, đồng
// bộ định nghĩa với SidebarCounts) còn chưa soát tool / chưa gán / designer
// chưa làm xong. Mọi role được xem (Admin/Support/Designer) nhận CÙNG số toàn
// hệ thống — chủ đích để mọi người cùng thấy và thúc nhau xử lý.
export const OverdueDesignerRowZod = z.object({
  userId: IDZod,
  name: z.string(),
  count: z.number().int().nonnegative(),
});
export type OverdueDesignerRow = z.infer<typeof OverdueDesignerRowZod>;

export const OverdueAlertZod = z.object({
  /** Ngày VN (yyyy-mm-dd) muộn nhất bị coi là quá hạn — vd hôm nay 13 → "…-11". */
  cutoffDay: z.string(),
  /** Đơn chưa soát tool (toolResultNote null/'') quá hạn — mirror unreviewedList ToolCheck. */
  toolCheckUnreviewed: z.number().int().nonnegative(),
  /** Đơn cần gán designer quá hạn — mirror match getAssignBacklog. */
  designerUnassigned: z.number().int().nonnegative(),
  /** Đơn đã gán designer nhưng chưa xong (assigned/in-progress/rework) quá hạn = tổng byDesigner. */
  designerBacklog: z.number().int().nonnegative(),
  /** Breakdown tồn theo từng designer (sort giảm dần) — hiện tên trên banner. */
  byDesigner: OverdueDesignerRowZod.array(),
});
export type OverdueAlert = z.infer<typeof OverdueAlertZod>;
export class GetOverdueAlertResDto extends createZodDto(extendApi(ResZod.extend({ data: OverdueAlertZod }))) {}
