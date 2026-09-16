import { query } from '@anthropic-ai/claude-agent-sdk';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { Model } from 'mongoose';
import type {
  GetZaloSummariesDto,
  SummarizeZaloGroupDto,
  ZaloMessageInput,
  ZaloSummaryQueueItem,
  ZaloSummaryTask,
} from 'shared';
import {
  ZALO_GROUP_ANALYZABLE_KINDS,
  ZALO_IDENTITY_CHAT_LABELS,
  ZALO_PARTNER_CHAT_LABEL,
  ZaloGroupKind,
  ZaloIdentityKind,
} from 'shared';

import { laTienTrinhChayCron } from '@/utils/cron-guard';

import { OrderEntity } from '../order/order.entity';
import { ZaloEngineService } from '../zalo-engine/zalo-engine.service';
import { ZaloGroupLinkEntity } from './zalo-group-link.entity';
import type { ZaloGroupSummaryDocument } from './zalo-group-summary.entity';
import { ZaloGroupSummaryEntity } from './zalo-group-summary.entity';
import { ZaloIdentityService } from './zalo-identity.service';
import type { BangChungDon, KetQua } from './zalo-summary.logic';
import {
  apDungSanMucDo,
  chuanHoa,
  dinhDangLuc,
  gopChecklist,
  maKhongCoTrongNguon,
  moTaDinhKem,
  moTaDon,
  nhanChang,
  phanLoaiHangDoi,
  SUMMARY_JSON_SCHEMA,
  tachJson,
} from './zalo-summary.logic';
import type { ZaloSummaryJobData } from './zalo-summary.queue';
import { ZALO_SUMMARY_QUEUE } from './zalo-summary.queue';

/**
 * Mô hình. Agent SDK nhận ALIAS (`opus`/`sonnet`/`haiku`), không phải model id
 * đầy đủ — giống `HUB_ASSISTANT_MODEL` bên thghub.
 */
const MODEL = process.env.ZALO_SUMMARY_MODEL || 'opus';

/**
 * Trần thời gian một lượt gọi mô hình (giây). Lượt tóm tắt chạy trong worker
 * BullMQ, không còn đi qua nginx; production đặt 150 (`ZALO_SUMMARY_TIMEOUT_SEC`),
 * một nhóm 400 tin với sonnet mất ~40–100 giây. Quá hạn thì HỦY THẬT lượt gọi
 * (`AbortController`) và đóng tiến trình CLI con — cờ mềm như bản trước chỉ
 * ngừng đọc, còn tiến trình `claude` vẫn chạy tiếp và ngốn máy.
 */
const HAN_GIAY = Number(process.env.ZALO_SUMMARY_TIMEOUT_SEC || 50);

/**
 * Đường dẫn CLI `claude`. Agent SDK KHÔNG tự gọi API — nó `spawn` tiến trình
 * CLI này, nên máy chạy API bắt buộc phải có Claude Code cài sẵn.
 *
 * Vì sao phải khai tường minh thay vì để SDK tự tìm trong PATH: bản cài mặc
 * định đặt CLI ở `~/.local/bin`, mà tiến trình PM2 lại chạy với PATH hệ thống
 * (`/usr/local/bin:/usr/bin:...`) — không có thư mục đó. Kết quả là `spawn`
 * hỏng, còn lỗi nổi lên chỉ nói chung chung về xác thực, dẫn người đọc đi tìm
 * nhầm phía thông tin đăng nhập. Đã mất vài lượt truy vì đúng chỗ này.
 */
const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH;

/** Bao lâu thì phải đọc lại từ đầu để cắt bệnh trôi dần của tóm tắt cuốn chiếu. */
const NGAY_DOC_LAI = Number(process.env.ZALO_SUMMARY_REREAD_DAYS || 7);

/** Nhóm im lâu hơn mức này thì không tốn tiền tóm tắt lại. */
const NGAY_BO_QUA_NHOM_IM = Number(process.env.ZALO_SUMMARY_IDLE_DAYS || 14);

const TZ_VN = 'Asia/Ho_Chi_Minh';

/**
 * Trần nhóm mỗi lượt quét — mỗi nhóm là MỘT lần gọi mô hình.
 *
 * Không có trần thì một ngày 113 nhóm cùng tới hạn (ví dụ sau đợt đổi
 * `ZALO_SUMMARY_REREAD_DAYS`) và lượt đó tốn gấp trăm lần bình thường. Cứ 4
 * tiếng một lượt × 30 nhóm là dư cho 113 nhóm giữ tươi trong ngày.
 */
const SWEEP_MOI_LUOT = Number(process.env.ZALO_SUMMARY_SWEEP_LIMIT || 30);

/** Trần tin mỗi nhóm — khớp trần 400 của `SummarizeZaloGroupZod.messages`. */
const MAX_TIN_MOI_LUOT = 400;

const MO_DAU_KHACH = `Bạn đọc một đoạn hội thoại nhóm Zalo giữa nhân viên công ty in ấn và khách hàng.`;

const MO_DAU_VAN_HANH = `Bạn đọc một đoạn hội thoại NHÓM VẬN HÀNH của công ty in ấn: nhân viên nội bộ làm việc với nhau
và với ĐỐI TÁC bên ngoài (nhà cung cấp vật tư, đơn vị vận chuyển/khai hải quan, xưởng gia công).
Trong nhóm này KHÔNG có khách hàng — đừng gọi ai là "khách". VAI TRÒ trên mỗi dòng là NHÂN VIÊN,
ĐỐI TÁC, TRỢ LÝ AI hoặc CHƯA RÕ.`;

const KET_KHACH = `Đây là nhóm khách B2B — chờ báo giá, chờ mẫu, chờ hợp đồng vài ngày là NHỊP BÌNH THƯỜNG, không
phải sự cố. Chấm "gap" cho quá nhiều nhóm thì cái nhãn đó mất hết tác dụng cảnh báo.`;

const KET_VAN_HANH = `Đây là nhóm vận hành — chờ hàng về, chờ chứng từ, chờ nhà cung cấp vài ngày là NHỊP BÌNH THƯỜNG,
không phải sự cố. Trong nhóm này các ô hiểu như sau (giữ nguyên tên khoá JSON):
- "khachQuanTam" = DD/MM HH:MM + BÊN YÊU CẦU (đối tác hoặc nhân viên nêu vấn đề) + cần gì.
- "salePhanHoi" = DD/MM HH:MM + TÊN NGƯỜI XỬ LÝ + đã làm gì.
Chấm "gap" cho quá nhiều nhóm thì cái nhãn đó mất hết tác dụng cảnh báo.`;

const THAN_LOI_NHAC = `Nhiệm vụ: rút ra tình hình, viết TIẾNG VIỆT, mỗi ô 1–2 câu ngắn, cụ thể. KHÔNG kể lại nội dung chat.

🔴 MỌI KẾT LUẬN PHẢI KÈM MỐC THỜI GIAN (NGÀY + GIỜ PHÚT) VÀ TÊN NGƯỜI. Mỗi dòng chat có dạng
"[DD/MM HH:MM] VAI TRÒ/Tên:" với VAI TRÒ là KHÁCH, ĐỐI TÁC, NHÂN VIÊN, TRỢ LÝ AI hoặc CHƯA RÕ — hãy DÙNG nó:
- "khách hỏi X" → phải là "20/08 14:35 khách (Tên) hỏi X"
- "đã trả lời" → phải là "21/08 09:10 (Tên nhân viên) trả lời rằng…" — nêu ĐÍCH DANH ai
- việc còn treo → phải nói TREO TỪ LÚC NÀO (ngày + giờ) và ĐÃ BAO NHIÊU NGÀY
Mốc thời gian LUÔN ghi đủ ngày lẫn giờ phút đúng như trong ngoặc vuông của dòng chat, ví dụ
"31/08 16:33" — KHÔNG rút gọn còn "31/08". Người đọc cần giờ để biết ai chậm bao lâu trong ngày.
Không có mốc thời gian và tên người thì không chấm được ai chậm — đó là mục đích của bản tóm tắt này.
"TRỢ LÝ AI" là tài khoản tự động trực nhóm. Nếu chỉ có TRỢ LÝ AI trả lời khách mà KHÔNG nhân viên
nào vào, hãy nêu rõ điều đó trong "tonDong" — đó là nhóm cần người thật tiếp quản.
Dòng ghi "CHƯA RÕ" là người chưa được phân loại: đừng khẳng định họ là nhân viên hay khách.
Dòng có [TỆP: …], [ẢNH], [VIDEO] hoặc [LIÊN KẾT: …] là BẰNG CHỨNG người đó ĐÃ GỬI thứ đó vào đúng
giờ ghi trong ngoặc vuông — hãy ghi nhận "đã gửi tệp X lúc DD/MM HH:MM", tuyệt đối không kết luận
"chưa gửi" khi có dòng này. Tên tệp thường nói rõ nội dung (báo giá, chứng nhận, danh sách…).
[STICKER] không mang nội dung và KHÔNG tính là câu trả lời.
Chỉ ghi tên/ngày CÓ THẬT trong chat. Không thấy thì ghi "không rõ", tuyệt đối không đoán.
Mã đơn, mã sản phẩm/SKU, mã vận đơn, số tiền: CHÉP NGUYÊN VĂN từng ký tự như trong chat — không viết
tắt, không "sửa chính tả", không ghép hai mã. Không chắc đọc đúng mã thì mô tả bằng lời và bỏ mã,
tuyệt đối không bịa.

Nếu có khối "DỮ LIỆU ĐƠN HÀNG THẬT", đó là trạng thái tra từ hệ thống sản xuất — nó ĐÚNG hơn
những gì người ta nói trong chat. Dùng nó để:
- Trả lời được câu khách hỏi: đơn đang ở công đoạn nào, có bị giữ/lỗi không, đã bao nhiêu ngày.
- Bác bỏ lời hứa sai: ai đó nói "đã xử lý xong" mà đơn vẫn đang kẹt thì đưa vào "nghiNgo".
- Chấm mức độ: đơn đang BỊ GIỮ hoặc CÓ LỖI là căn cứ chắc chắn cho "gap", chắc hơn nhiều so với
  suy đoán từ giọng điệu chat.
Đơn nào chat có nhắc mà khối dữ liệu ghi "không tra được" thì nói rõ là không tra được, đừng đoán.
Phần "BỐI CẢNH CHUNG CỦA KHÁCH" trong khối đó là để đối chiếu và chấm mức độ. KHÔNG chép nó vào
"tonDong" hay "checklist" trừ khi chat của CHÍNH NHÓM NÀY có nhắc tới đơn/vấn đề đó. Khách có nhiều
nhóm — mỗi nhóm chỉ ghi việc của nhóm mình, kẻo cùng một đơn kẹt hiện ở mọi nhóm.

Nếu có khối "TÓM TẮT LẦN TRƯỚC", bạn đang cập nhật tiếp chứ không viết lại từ đầu. Làm ĐÚNG BA việc:
  a) XÁC MINH việc đã đánh dấu xong: tìm bằng chứng trong tin nhắn mới. KHÔNG thấy bằng chứng thì
     đưa vào "nghiNgo". Thấy rồi thì thôi, đừng nhắc lại.
  b) GIỮ TIẾP việc còn treo nếu tin nhắn mới không cho thấy nó đã xong, và GIỮ NGUYÊN VĂN câu chữ
     của việc đó (chỉ đổi khi bản chất việc đã đổi) để hệ thống nhận ra cùng một việc. Việc nào tin nhắn mới cho
     thấy ĐÃ XONG thì BỎ khỏi checklist — đừng giữ chỉ vì lần trước có.
  c) THÊM việc mới phát sinh.
Tin nhắn mới là bên có tiếng nói cuối. Tóm tắt lần trước chỉ để nhớ, không phải để bảo vệ.

Trả về DUY NHẤT một khối JSON, không thêm chữ nào ngoài nó:
{
  "tieuDe": "tối đa 12 chữ, nêu đúng việc đang treo",
  "khachQuanTam": "DD/MM HH:MM + ai bên khách + hỏi/cần gì",
  "salePhanHoi": "DD/MM HH:MM + TÊN nhân viên + đã trả lời/xử lý gì",
  "tonDong": "việc còn treo + TREO TỪ LÚC NÀO (DD/MM HH:MM) + đã bao nhiêu ngày. Không có thì ghi 'Không có'",
  "checklist": ["mỗi phần tử là MỘT việc làm được ngay, bắt đầu bằng động từ, tối đa 24 chữ, tối đa 5 việc"],
  "nghiNgo": ["việc đã tick xong nhưng không thấy bằng chứng, kèm lý do ngắn"],
  "mucDo": "gap" | "can-chu-y" | "binh-thuong"
}

Chấm mức độ — CHỈ dựa vào bằng chứng CỨNG, không chấm theo giọng điệu hay cảm giác:
- "gap": CHỈ khi có ít nhất một trong các dấu hiệu tra được từ hệ thống hoặc nói rõ trong chat:
    · khối dữ liệu đơn hàng cho thấy đơn ĐANG BỊ GIỮ hoặc ĐANG CÓ LỖI
    · khách nói rõ đang khiếu nại, đòi hoàn tiền, doạ huỷ hợp tác
    · có mốc hạn cụ thể đã trôi qua (hạn giao, hạn hải quan, hạn thanh toán)
  Chậm trả lời KHÔNG phải căn cứ cho "gap".
- "can-chu-y": còn việc treo, hoặc khách hỏi đã quá 3 ngày chưa ai đáp.
- "binh-thuong": việc đang chạy theo nhịp bình thường, kể cả khi còn vài việc chưa xong.`;

/**
 * Lời nhắc hệ thống theo LOẠI NHÓM. Cùng một thân, khác đoạn mở đầu và đoạn kết:
 * nhóm khách đóng khung "nhân viên ↔ khách"; nhóm vận hành không có khách, người
 * ngoài là ĐỐI TÁC. Đo trên 111 bản: Duyên (forwarder), Đại Thịnh, Mẫn Nè (bán
 * mỡ máy), Minh Đăng (quản lý xưởng) đều bị gọi là "khách" vì khung cũ.
 */
function loiNhacHeThong(kind?: string): string {
  const vanHanh = kind === ZaloGroupKind.Operation;

  return `${vanHanh ? MO_DAU_VAN_HANH : MO_DAU_KHACH}
${THAN_LOI_NHAC}

${vanHanh ? KET_VAN_HANH : KET_KHACH}`;
}

/** Một hàng bảng theo dõi: bản tóm tắt (lean) + hai trường tính lúc gọi từ nhóm. */
type ZaloSummaryRow = ZaloGroupSummaryEntity & { _id: string; lastMessageAt?: Date; coTinMoi?: boolean };

@Injectable()
export class ZaloSummaryService {
  private readonly logger = new Logger(ZaloSummaryService.name);

  constructor(
    @InjectModel(ZaloGroupSummaryEntity.name)
    private readonly summaryModel: Model<ZaloGroupSummaryEntity>,
    @InjectModel(ZaloGroupLinkEntity.name)
    private readonly linkModel: Model<ZaloGroupLinkEntity>,
    @InjectModel(OrderEntity.name)
    private readonly orderModel: Model<OrderEntity>,
    @InjectQueue(ZALO_SUMMARY_QUEUE) private readonly summaryQueue: Queue<ZaloSummaryJobData>,
    private readonly identityService: ZaloIdentityService,
    private readonly engine: ZaloEngineService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  /**
   * Đẩy một nhóm vào hàng đợi thay vì tóm tắt ngay trong request.
   *
   * `jobId` gồm CẢ mốc tin cuối, không chỉ mã nhóm. Dùng riêng mã nhóm thì
   * BullMQ coi mọi lần đẩy sau là trùng và nuốt luôn — kể cả khi nhóm đã có
   * tin mới — vì job đã hoàn thành vẫn nằm lại Redis theo `removeOnComplete`.
   * Đã dẫm phải: đẩy lại nhóm DESI hai lần, hàng đợi trống, không job nào
   * thất bại, mà bản tóm tắt không hề đổi.
   *
   * Ghép thêm mốc tin cho đúng ý định ban đầu: cùng nhóm + cùng nội dung thì
   * bỏ qua (khỏi tốn một lượt gọi mô hình), có tin mới thì chạy lại.
   */
  async enqueue(dto: SummarizeZaloGroupDto): Promise<{ queued: boolean }> {
    // Chặn ngay ở cửa vào: nhóm chưa phân loại thì báo lỗi cho người gọi thay
    // vì xếp hàng rồi để job hỏng lặng lẽ trong worker.
    await this.assertDuocDocChat(dto.groupGlobalId);

    const mocCuoi = dto.messages.reduce<number>((max, m) => {
      const t = m.luc ? new Date(m.luc).getTime() : 0;

      return t > max ? t : max;
    }, 0);
    const jobId = `${dto.groupGlobalId}:${mocCuoi}${dto.docLaiTuDau ? ':full' : ''}`;

    // Xoá job CÙNG jobId còn sót lại trước khi thêm. `removeOnFail` giữ job
    // hỏng tới 500 bản / 14 ngày, mà BullMQ coi jobId trùng là trùng — nên một
    // job từng hỏng sẽ chặn mọi lần thử lại của đúng nhóm đó, im lặng: endpoint
    // vẫn báo "đã xếp hàng", hàng đợi không nhúc nhích, không lỗi mới nào.
    // Đã dẫm phải trên production: 52 job hỏng vì thiếu CLI, sửa xong CLI rồi
    // mà chạy lại vẫn không có gì xảy ra.
    await this.summaryQueue.remove(jobId).catch(() => undefined);

    const job = await this.summaryQueue.add(
      'summarize',
      { groupGlobalId: dto.groupGlobalId, messages: dto.messages, docLaiTuDau: dto.docLaiTuDau ,
        // Cờ kiểm thử `--group`: bỏ chốt 'không có tin có nội dung sau mốc'.
        ...(dto.epDocLai ? { epDocLai: true } : {})},
      { jobId },
    );

    return { queued: !!job.id };
  }

  /**
   * Danh sách nhóm đang chờ tóm tắt, kèm mốc tin cần lấy từ.
   *
   * Script bên ngoài gọi cái này trước, rồi mới sang `onosceo` kéo tin — như
   * vậy nó chỉ kéo phần MỚI thay vì tải lại toàn bộ lịch sử mỗi lượt.
   */
  async getQueue(): Promise<ZaloSummaryQueueItem[]> {
    return (await this.phanLoaiTatCa()).hang;
  }

  /**
   * Xét TẤT CẢ nhóm được phép đọc chat, tách làm hai: nhóm tới hạn tóm tắt và
   * nhóm cố ý bỏ qua kèm lý do.
   *
   * Vì sao trả cả nhóm bỏ qua: bên ngoài nhìn bảng tóm tắt chỉ thấy "bản này cũ
   * 18 ngày" mà không biết cũ do cố ý hay do hệ bỏ sót — đội agent đã đoán nhầm
   * thành "summarizer chạy không đều" (báo cáo 16/09/2026). Lý do được ghi
   * xuống bản ghi ở `cronQuetTomTat` để công cụ bên kia tự lọc thay vì đoán.
   */
  private async phanLoaiTatCa(): Promise<{
    hang: ZaloSummaryQueueItem[];
    boQua: { groupGlobalId: string; lyDo: string }[];
    gidPhanTichDuoc: string[];
  }> {
    // Chốt riêng tư: chỉ nhóm đã phân loại seller/operation mới được đọc chat.
    const groups = await this.linkModel
      .find({ kind: { $in: ZALO_GROUP_ANALYZABLE_KINDS }, deletedAt: { $exists: false } })
      .select('groupGlobalId title lastMessageAt')
      .lean();

    const summaries = await this.summaryModel.find({}).select('groupGlobalId denMocTin docDayDuLuc').lean();
    const byGroup = new Map(summaries.map((s) => [String(s.groupGlobalId), s]));

    const now = Date.now();
    const hang: ZaloSummaryQueueItem[] = [];
    const boQua: { groupGlobalId: string; lyDo: string }[] = [];

    for (const g of groups) {
      const gid = String((g as { groupGlobalId: string }).groupGlobalId);
      const lastMsg = (g as { lastMessageAt?: Date }).lastMessageAt;
      const prev = byGroup.get(gid);
      const pl = phanLoaiHangDoi({
        lastMessageAt: lastMsg ? new Date(lastMsg) : null,
        denMocTin: prev?.denMocTin ? new Date(prev.denMocTin) : null,
        docDayDuLuc: prev?.docDayDuLuc ? new Date(prev.docDayDuLuc) : null,
        now,
        ngayDocLai: NGAY_DOC_LAI,
        ngayBoQua: NGAY_BO_QUA_NHOM_IM,
      });
      if (!pl.xepHang) {
        if (pl.lyDoBoQua) boQua.push({ groupGlobalId: gid, lyDo: pl.lyDoBoQua });
        continue;
      }

      hang.push({ groupGlobalId: gid, title: (g as { title?: string }).title, ...pl.xepHang });
    }

    return { hang, boQua, gidPhanTichDuoc: groups.map((g) => String((g as { groupGlobalId: string }).groupGlobalId)) };
  }

  /**
   * Đóng dấu các bản tóm tắt MỒ CÔI — có trong `zalo_group_summaries` nhưng
   * groupGlobalId không còn nhóm nào phân tích được mang.
   *
   * Vì sao có: hai engine Zalo từng chạy song song và mỗi engine tự cấp id
   * riêng; đợt gộp về một engine (11/09/2026) khớp hội thoại theo khoá tự
   * nhiên chứ không theo id, nên bản tóm tắt sinh ở thời engine cũ có thể trỏ
   * vào một `groupGlobalId` không còn tồn tại. Đội agent đo 16/09: 22 bản
   * không khớp được nhóm nào.
   *
   * CHỈ ĐÁNH DẤU, KHÔNG XOÁ: bản mồ côi vẫn có thể là tóm tắt thật của một
   * nhóm thật, và xoá là mất luôn phần việc còn treo ghi trong đó. Bên đọc lọc
   * theo `lyDoBoQua` rồi quyết, việc dọn để người quyết.
   */
  private async dongDauMoCoi(gidPhanTichDuoc: string[], luc: Date): Promise<void> {
    try {
      const r = await this.summaryModel.updateMany(
        { groupGlobalId: { $nin: gidPhanTichDuoc } },
        { $set: { lanChayCuoi: luc, lyDoBoQua: 'khong-co-link-phan-tich' } },
      );
      if (r.modifiedCount > 0) {
        this.logger.warn(`[zalo-summary-sweep] ${r.modifiedCount} bản tóm tắt mồ côi (không khớp nhóm nào phân tích được)`);
      }
    } catch (e) {
      this.logger.warn(`[zalo-summary-sweep] không đánh dấu được bản mồ côi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Đóng dấu lượt quét lên bản tóm tắt: `lanChayCuoi` cho mọi nhóm được xét,
   * `lyDoBoQua` cho nhóm không tóm tắt lượt này (xoá khi nhóm được xếp hàng).
   *
   * `upsert: false` có chủ đích — nhóm CHƯA TỪNG có tóm tắt thì không đẻ bản
   * ghi rỗng, vì bên đọc đếm số dòng của bảng này ra "số nhóm có tóm tắt".
   */
  private async dongDauLuotQuet(items: { groupGlobalId: string; lyDo: string | null }[], luc: Date): Promise<void> {
    if (items.length === 0) return;
    try {
      await this.summaryModel.bulkWrite(
        items.map((it) => ({
          updateOne: {
            filter: { groupGlobalId: it.groupGlobalId },
            update: it.lyDo
              ? { $set: { lanChayCuoi: luc, lyDoBoQua: it.lyDo } }
              : { $set: { lanChayCuoi: luc }, $unset: { lyDoBoQua: '' } },
          },
        })),
        { ordered: false },
      );
    } catch (e) {
      // Đóng dấu hỏng không được làm hỏng lượt tóm tắt — đây là dữ liệu phụ trợ.
      this.logger.warn(`[zalo-summary-sweep] không ghi được dấu lượt quét: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Tự tóm tắt các nhóm tới hạn — 4 tiếng một lượt.
   *
   * Vì sao tới giờ mới có: bộ tóm tắt vốn do script `summarize-zalo-groups.mjs`
   * chạy TAY, và nó buộc phải ở ngoài vì hồi đó engine Zalo nằm trên máy khác
   * (`onosceo`) — API không gọi tới được, nên script đứng giữa: ssh sang đọc
   * Postgres của engine rồi POST vào đây kèm JWT admin. Ràng buộc đó mất từ
   * 11–12/09/2026 khi engine dời về cùng máy, nên vòng lặp vào trong được, và
   * cái giá phải trả cuối cùng — một token admin nằm trên đĩa để cron dùng —
   * không phải trả nữa.
   *
   * Hệ quả của việc chưa từng có lịch: đo 13/09, bản tóm tắt mới nhất là 10/09
   * và các đợt trước rải rác (56 bản ngày 09/09, 18 bản 08/09) — đúng dấu vết
   * của người chạy tay, không phải cron hỏng.
   *
   * `getQueue()` đã lo phần chọn nhóm: áp chốt riêng tư, bỏ nhóm im lâu, bỏ
   * nhóm đã tóm tắt tới đúng tin cuối. Ở đây chỉ kéo tin và xếp hàng.
   */
  @Cron('0 */4 * * *', { name: 'zalo-summary-sweep', timeZone: TZ_VN })
  async cronQuetTomTat(): Promise<void> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return;
    if (!this.engine.daCauHinh) return;

    let hang: ZaloSummaryQueueItem[];
    let boQua: { groupGlobalId: string; lyDo: string }[];
    let gidPhanTichDuoc: string[];
    try {
      ({ hang, boQua, gidPhanTichDuoc } = await this.phanLoaiTatCa());
    } catch (e) {
      this.logger.error(`[zalo-summary-sweep] không lấy được hàng đợi: ${e instanceof Error ? e.message : String(e)}`);

      return;
    }

    // Trần mỗi lượt: mỗi nhóm là một lần gọi mô hình. Không có trần thì một ngày
    // nào đó 113 nhóm cùng tới hạn và lượt quét đó tốn gấp trăm lần bình thường.
    const lam = hang.slice(0, SWEEP_MOI_LUOT);

    // Đóng dấu TRƯỚC khi gọi mô hình: lượt quét có chạy là sự thật, kể cả khi
    // phần tóm tắt phía sau hỏng. Nhóm quá trần lượt này mang lý do riêng để
    // bên đọc phân biệt "hệ bận" với "cố ý bỏ qua".
    const luc = new Date();
    await this.dongDauLuotQuet(
      [
        ...lam.map((it) => ({ groupGlobalId: it.groupGlobalId, lyDo: null })),
        ...hang.slice(SWEEP_MOI_LUOT).map((it) => ({ groupGlobalId: it.groupGlobalId, lyDo: 'qua-tran-luot' })),
        ...boQua.map((it) => ({ groupGlobalId: it.groupGlobalId, lyDo: it.lyDo })),
      ],
      luc,
    );
    await this.dongDauMoCoi(gidPhanTichDuoc, luc);
    if (hang.length === 0) return;

    this.logger.log(
      `[zalo-summary-sweep] ${hang.length} nhóm tới hạn, xếp hàng ${lam.length}, bỏ qua ${boQua.length} (${hang.length - lam.length} quá trần)`,
    );

    let xong = 0;
    for (const item of lam) {
      try {
        const link = await this.linkModel.findOne({ groupGlobalId: item.groupGlobalId }).select('conversationIds').lean();
        const hoiThoai = (link as { conversationIds?: string[] } | null)?.conversationIds ?? [];
        if (hoiThoai.length === 0) continue;

        // `tuMoc` rỗng nghĩa là đọc lại từ đầu; engine đã khử trùng theo zaloMsgId.
        const tho = await this.engine.tinCuaNhom(hoiThoai, MAX_TIN_MOI_LUOT, item.tuMoc ? new Date(item.tuMoc).toISOString() : undefined);
        const messages = tho
          .filter((m) => (m.content ?? '').trim() !== '')
          // Xếp XUÔI thời gian: mô hình đọc hội thoại theo thứ tự người ta nói.
          .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
          .map((m) => ({
            nguoiGui: m.senderName || undefined,
            zaloUid: m.senderUid || undefined,
            // Engine không gắn uid cho tin do chính nick công ty gửi; `self` là dấu duy nhất.
            laTroLyAi: m.senderType === 'self' || undefined,
            noiDung: (m.content ?? '').replace(/[\r\n]+/g, ' ').slice(0, 4000),
            // DTO nhận `Date` (Zod coerce ở tầng HTTP, còn đây gọi trực tiếp).
            luc: new Date(m.sentAt),
          }));
        if (messages.length === 0) continue;

        await this.enqueue({ groupGlobalId: item.groupGlobalId, messages, docLaiTuDau: item.docLaiTuDau || undefined });
        xong++;
      } catch (e) {
        // Một nhóm hỏng không được làm dừng lượt quét.
        this.logger.warn(`[zalo-summary-sweep] ${item.groupGlobalId} bỏ qua: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.logger.log(`[zalo-summary-sweep] đã xếp hàng ${xong}/${lam.length}`);
  }

  /**
   * Chốt riêng tư: chỉ nhóm đã phân loại `seller`/`operation` mới được đọc chat.
   *
   * Gọi ở CẢ hai chỗ — lúc xếp hàng và lúc worker chạy. Chỉ kiểm ở worker thì
   * người gọi nhận `queued: true` rồi job âm thầm hỏng, lại còn tốn 3 lần thử
   * lại cho một lỗi không bao giờ tự khỏi. Chỉ kiểm ở cửa vào thì job cũ nằm
   * sẵn trong hàng đợi vẫn chạy được sau khi nhóm bị đổi sang `internal`.
   */
  private async assertDuocDocChat(groupGlobalId: string): Promise<Record<string, unknown>> {
    const link = await this.linkModel.findOne({ groupGlobalId }).lean();
    if (!link) throw new NotFoundException('Không tìm thấy nhóm Zalo.');

    const kind = (link as { kind?: string }).kind;
    if (!kind || !ZALO_GROUP_ANALYZABLE_KINDS.includes(kind as never)) {
      throw new BadRequestException(
        'Nhóm này chưa được phân loại là nhóm khách hoặc nhóm vận hành — không đọc nội dung chat.',
      );
    }

    return link as Record<string, unknown>;
  }

  /** Gọi mô hình tóm tắt một nhóm rồi lưu kết quả. */
  async summarize(dto: SummarizeZaloGroupDto): Promise<ZaloGroupSummaryDocument> {
    const link = await this.assertDuocDocChat(dto.groupGlobalId);

    const prev = await this.summaryModel.findOne({ groupGlobalId: dto.groupGlobalId }).lean();
    const docLaiTuDau = dto.docLaiTuDau ?? false;

    // Đổi tin đính kèm (JSON thô) thành chữ MỘT LẦN, dùng cho cả regex mã đơn lẫn
    // dòng chat — hai chỗ cùng đọc `noiDung`, đổi lệch nhau là mô hình và dữ liệu
    // đơn nhìn hai phiên bản khác nhau của cùng một tin.
    const messages = dto.messages.map((m) => ({ ...m, noiDung: moTaDinhKem(m.noiDung) }));

    const mocCuoi = dto.messages.reduce<Date | undefined>((max, m) => {
      if (!m.luc) return max;
      const d = new Date(m.luc);

      return !max || d > max ? d : max;
    }, undefined);

    // Đọc lại định kỳ mà KHÔNG có tin có nội dung mới → không gọi mô hình: tóm
    // tắt lại y nguyên chỉ tốn tiền và vứt ngữ cảnh checklist. KHÔNG đụng
    // `docDayDuLuc` để lượt đọc lại nổ ngay khi có nội dung thật.
    if (!dto.epDocLai && docLaiTuDau && prev?.denMocTin && mocCuoi && mocCuoi <= new Date(prev.denMocTin)) {
      this.logger.log(
        `[zalo-summary] bỏ đọc lại nhóm ${dto.groupGlobalId}: không có tin có nội dung sau ${new Date(prev.denMocTin).toISOString()}`,
      );

      return prev as unknown as ZaloGroupSummaryDocument;
    }

    const { vanBan: duLieuDon, bangChung } = await this.layDuLieuDon(
      link as { customerId?: string; userSku?: string },
      messages,
    );

    const kind = (link as { kind?: string }).kind;
    const ketQua = await this.goiMoHinh({
      title: (link as { title?: string }).title,
      kind,
      messages,
      truoc: docLaiTuDau ? null : prev,
      duLieuDon,
    });

    // Chỉ ghi log, KHÔNG tự sửa: thay bằng mã gần giống có thể sai nặng hơn. Xét
    // lại nếu tỉ lệ cảnh báo vượt ~1/200 sau khi đã có luật "chép nguyên văn".
    // Nguồn = ĐÚNG những gì mô hình được đọc: tin nhắn + khối đơn + bản tóm tắt
    // lần trước (chỉ khi lượt này thực sự gửi nó, tức không đọc lại từ đầu).
    const banTruoc =
      !docLaiTuDau && prev
        ? [prev.tieuDe, prev.khachQuanTam, prev.salePhanHoi, prev.tonDong, ...(prev.nghiNgo ?? []), ...(prev.checklist ?? []).map((c) => c.viec)]
            .filter(Boolean)
            .join('\n')
        : '';
    const maLa = maKhongCoTrongNguon(ketQua, `${messages.map((m) => m.noiDung).join('\n')}\n${duLieuDon}\n${banTruoc}`);
    if (maLa.length) {
      this.logger.warn(`[zalo-summary] mã không có trong chat: ${maLa.join(', ')} (nhóm ${dto.groupGlobalId})`);
    }

    // Sàn mức độ từ bằng chứng cứng — mô hình có thể dịu giọng, dữ liệu đơn thì không.
    const sanMucDo = apDungSanMucDo(ketQua.mucDo, bangChung);
    if (sanMucDo.nangTu) {
      this.logger.log(
        `[zalo-summary] nâng mức ${sanMucDo.nangTu} → ${sanMucDo.mucDo} theo dữ liệu đơn (nhắc: ${bangChung.donNhacBiGiuHoacLoi}, khách: ${bangChung.donKhachBiGiuHoacLoi}; nhóm ${dto.groupGlobalId})`,
      );
    } else if (bangChung.donNhacBiGiuHoacLoi > 0 || bangChung.donKhachBiGiuHoacLoi > 0) {
      // Ghi cả khi KHÔNG phải nâng: đọc log là biết vì sao một nhóm màu đỏ, và
      // biết đường đếm bằng chứng có chạy hay không (sàn im lặng thì không phân
      // biệt được "không có bằng chứng" với "hàm đếm hỏng").
      this.logger.log(
        `[zalo-summary] bằng chứng đơn (nhắc: ${bangChung.donNhacBiGiuHoacLoi}, khách: ${bangChung.donKhachBiGiuHoacLoi}) — mô hình đã chấm ${sanMucDo.mucDo}, không cần nâng (nhóm ${dto.groupGlobalId})`,
      );
    }

    const now = new Date();

    const set: Record<string, unknown> = {
      groupGlobalId: dto.groupGlobalId,
      customerId: (link as { customerId?: string }).customerId,
      userSku: (link as { userSku?: string }).userSku,
      title: (link as { title?: string }).title,
      // Lưu loại nhóm lúc tóm tắt để UI đổi nhãn ô ("Bên yêu cầu"/"Người xử lý").
      kind,
      tieuDe: ketQua.tieuDe,
      khachQuanTam: ketQua.khachQuanTam,
      salePhanHoi: ketQua.salePhanHoi,
      tonDong: ketQua.tonDong,
      nghiNgo: ketQua.nghiNgo,
      mucDo: sanMucDo.mucDo,
      soTin: dto.messages.length,
      model: MODEL,
      tomTatLuc: now,
      ...(mocCuoi ? { denMocTin: mocCuoi } : {}),
      ...(docLaiTuDau ? { docDayDuLuc: now } : {}),
    };

    // Checklist: ĐỌC LẠI SAU khi mô hình trả lời rồi gộp, và ghi CÓ ĐIỀU KIỆN
    // theo `checklistRev`. `prev` đọc trước lượt gọi 40–150 giây — người tick
    // trong khoảng đó mà gộp từ `prev` là mất tick. Rev lệch (ai đó tick đúng
    // vài mili giây giữa đọc và ghi) thì đọc lại, tối đa 3 vòng.
    let saved: ZaloGroupSummaryDocument | null = null;
    for (let vong = 0; vong < 3 && !saved; vong += 1) {
      const hienTai = await this.summaryModel
        .findOne({ groupGlobalId: dto.groupGlobalId })
        .select('checklist checklistRev')
        .lean();
      const rev = hienTai?.checklistRev ?? 0;
      const checklist = gopChecklist(ketQua.checklist, (hienTai?.checklist as ZaloSummaryTask[]) ?? [], now);
      const dieuKien = hienTai
        ? // Bản cũ chưa có `checklistRev` → coi như 0.
          { groupGlobalId: dto.groupGlobalId, $or: [{ checklistRev: rev }, ...(rev === 0 ? [{ checklistRev: { $exists: false } }] : [])] }
        : { groupGlobalId: dto.groupGlobalId };
      saved = await this.summaryModel.findOneAndUpdate(
        dieuKien,
        { $set: { ...set, checklist }, $inc: { checklistRev: 1 } },
        { upsert: !hienTai, new: true },
      );
    }
    if (!saved) throw new ConflictException('Checklist đang được sửa liên tục — lượt tóm tắt sẽ thử lại sau.');

    return saved;
  }

  /**
   * Tra dữ liệu ĐƠN HÀNG THẬT cho nhóm, để mô hình đối chiếu với lời nói trong chat.
   *
   * Đây là điểm ăn tiền của việc đặt tính năng trong OnosFactory thay vì ở máy
   * Zalo: chat chỉ cho biết người ta NÓI gì, còn bảng `orders` cho biết đơn
   * THỰC SỰ đang ở đâu. Không có vế thứ hai thì bản tóm tắt chỉ chép lại lời hứa.
   */
  private async layDuLieuDon(
    link: { customerId?: string; userSku?: string },
    messages: ZaloMessageInput[],
  ): Promise<{ vanBan: string; bangChung: BangChungDon }> {
    const phan: string[] = [];
    const bangChung: BangChungDon = { donNhacBiGiuHoacLoi: 0, donKhachBiGiuHoacLoi: 0 };

    // ─── Đơn được nhắc đích danh trong chat ───────────────────────
    // Khách gọi đơn bằng MÃ ĐƠN OnosPod (`orderId`) chứ hiếm khi dùng
    // `productionId` — kiểm trên dữ liệu thật: mã trong chat khớp `orderId`.
    // Tra cả hai trường để không hụt.
    const maTrongChat = [
      ...new Set(
        messages
          .flatMap((m) => m.noiDung.match(/\b[A-Z]{1,3}-\d{4,6}-\d{4,6}\b/gi) ?? [])
          .map((x) => x.toUpperCase()),
      ),
    ].slice(0, 15);

    if (maTrongChat.length > 0) {
      const dons = await this.orderModel
        // `externalId` = mã nền tảng (Platform ID) khách hay đọc ra trong chat.
        .find({
          $or: [
            { productionId: { $in: maTrongChat } },
            { orderId: { $in: maTrongChat } },
            { externalId: { $in: maTrongChat } },
          ],
        })
        .select('productionId orderId externalId type currentFulfillmentStage designerStatus heldAt holdReason productionError productionErrorNote inProductionAt fulfillmentCompletedAt cancelledAt')
        .limit(20)
        .lean();

      const thay = new Set<string>();
      const dong: string[] = [];
      for (const d of dons as Record<string, unknown>[]) {
        const pid = String(d.productionId ?? '');
        const oid = String(d.orderId ?? '');
        thay.add(pid.toUpperCase());
        thay.add(oid.toUpperCase());
        dong.push(`  · ${oid || pid}: ${moTaDon(d)}`);
        if (!d.cancelledAt && (d.heldAt || (d.productionError && !d.fulfillmentCompletedAt))) {
          bangChung.donNhacBiGiuHoacLoi += 1;
        }
      }
      const khongThay = maTrongChat.filter((c) => !thay.has(c));

      if (dong.length > 0) phan.push(`ĐƠN ĐƯỢC NHẮC TRONG CHAT:\n${dong.join('\n')}`);
      if (khongThay.length > 0) {
        phan.push(`Mã nhắc trong chat nhưng KHÔNG TRA ĐƯỢC trong hệ thống: ${khongThay.join(', ')}`);
      }
    }

    // ─── Bức tranh chung của khách ────────────────────────────────
    const sku = link.userSku?.trim();
    if (sku) {
      const [dangChay, giu, loi, cuNhat] = await Promise.all([
        this.orderModel.countDocuments({
          userSku: sku,
          cancelledAt: null,
          fulfillmentCompletedAt: { $exists: false },
        }),
        this.orderModel.countDocuments({ userSku: sku, heldAt: { $exists: true, $ne: null }, cancelledAt: null }),
        this.orderModel.countDocuments({
          userSku: sku,
          productionError: { $exists: true, $nin: [null, ''] },
          cancelledAt: null,
          fulfillmentCompletedAt: { $exists: false },
        }),
        this.orderModel
          .find({ userSku: sku, cancelledAt: null, fulfillmentCompletedAt: { $exists: false }, inProductionAt: { $exists: true } })
          .sort({ inProductionAt: 1 })
          .select('productionId orderId inProductionAt currentFulfillmentStage')
          .limit(1)
          .lean(),
      ]);

      bangChung.donKhachBiGiuHoacLoi = giu + loi;
      const dòng = [`  · đang chạy: ${dangChay} đơn`, `  · đang bị giữ: ${giu}`, `  · đang có lỗi: ${loi}`];
      const cu = (cuNhat as Record<string, unknown>[])[0];
      if (cu?.inProductionAt) {
        const ngay = Math.floor((Date.now() - new Date(cu.inProductionAt as Date).getTime()) / 86_400_000);
        dòng.push(
          `  · đơn nằm lâu nhất: ${String(cu.orderId ?? cu.productionId)} vào sản xuất ${ngay} ngày trước, đang ở ${nhanChang(cu.currentFulfillmentStage as string | undefined)}`,
        );
      }
      phan.push(`TÌNH HÌNH CHUNG CỦA KHÁCH (${sku}):\n${dòng.join('\n')}`);
    }

    if (phan.length === 0) return { vanBan: '', bangChung };

    // Khối này là của KHÁCH, không của nhóm: khách có nhiều nhóm thì mọi nhóm đều
    // nhận cùng khối. Đặt tên rõ để mô hình không chép "2 đơn lỗi" vào tồn đọng
    // của cả hai nhóm DESI như đã thấy trên production.
    const nhanKhach = link.userSku ? ` (${link.userSku})` : '';

    return {
      vanBan: `\n\n--- DỮ LIỆU ĐƠN HÀNG THẬT (tra từ hệ thống, đúng hơn lời nói trong chat) — BỐI CẢNH CHUNG CỦA KHÁCH${nhanKhach}: toàn bộ đơn của khách, KHÔNG riêng nhóm này ---\n${phan.join('\n\n')}`,
      bangChung,
    };
  }

  private async goiMoHinh(input: {
    title?: string;
    /** Loại nhóm — quyết định khung lời nhắc và nhãn ĐỐI TÁC thay KHÁCH. */
    kind?: string;
    messages: ZaloMessageInput[];
    truoc: { tonDong?: string; checklist?: ZaloSummaryTask[] } | null;
    /** Khối dữ liệu đơn thật, rỗng khi nhóm chưa gắn khách hoặc chat không nhắc mã nào. */
    duLieuDon: string;
  }): Promise<KetQua> {
    // Khuôn dòng chat PHẢI khớp thứ mô tả trong lời nhắc: mô hình được yêu cầu
    // trích ngày + tên + vai trò vào mọi kết luận.
    //
    // Vai trò tra từ bảng ĐỊNH DANH theo `zaloUid`, không đoán từ `sender_type`:
    // engine chỉ đánh dấu `self` cho 2 tài khoản công ty nối vào nó, còn nhân
    // viên dùng Zalo cá nhân (Ngọc Mai 46 nhóm, Huyền 26 nhóm) đều rơi vào
    // `contact` y như khách. Dựa vào `sender_type` là để mô hình tự đoán ai là
    // nhân viên — nó đoán đúng nhờ ngữ cảnh, nhưng đó là may chứ không phải dữ liệu.
    const uids = [...new Set(input.messages.map((m) => m.zaloUid).filter((x): x is string => !!x))];
    const dinhDanh = await this.identityService.mapByUid(uids);

    const doanChat = input.messages
      .map((m) => {
        const dd = m.zaloUid ? dinhDanh.get(m.zaloUid) : undefined;
        // Tin của chính tài khoản công ty không mang uid — engine coi đó là
        // "mình", nên nhận diện bằng cờ `laTaiKhoanCongTy` từ script.
        const loai = m.laTroLyAi
          ? ZaloIdentityKind.AiSupport
          : (dd?.kind ?? ZaloIdentityKind.Unknown);
        const ten = m.nguoiGui || dd?.displayName || 'không rõ';
        const luc = m.luc ? dinhDangLuc(new Date(m.luc)) : '??/?? ??:??';

        // Nhóm vận hành không có khách: người ngoài công ty ở đó là đối tác.
        const nhan =
          loai === ZaloIdentityKind.Customer && input.kind === ZaloGroupKind.Operation
            ? ZALO_PARTNER_CHAT_LABEL
            : ZALO_IDENTITY_CHAT_LABELS[loai];

        return `[${luc}] ${nhan}/${ten}: ${m.noiDung}`;
      })
      .join('\n');

    const khoiTruoc = input.truoc
      ? [
          '',
          'BẢN TÓM TẮT LẦN TRƯỚC (cập nhật nó theo tin mới, đừng viết lại từ đầu):',
          `- Tồn đọng: ${input.truoc.tonDong || '(không có)'}`,
          `- Việc cần làm: ${
            (input.truoc.checklist ?? [])
              .map((c) => `${c.viec}${c.xong ? ' [đã tick XONG]' : ''}`)
              .join(' | ') || '(không có)'
          }`,
        ].join('\n')
      : '';

    const loiNhac = `${loiNhacHeThong(input.kind)}

NHÓM: ${input.title ?? '(không tên)'}${input.duLieuDon}${khoiTruoc}

--- ${input.truoc ? 'TIN NHẮN MỚI TỪ LẦN TÓM TẮT TRƯỚC' : 'ĐOẠN CHAT'} ---
${doanChat}`;

    // Quá hạn → hủy thật: SDK nhận tín hiệu abort, tiến trình CLI con bị đóng
    // ở `finally`. Không dùng cờ mềm — cờ chỉ ngừng ĐỌC, không ngừng CHẠY.
    const ac = new AbortController();
    const dongHo = setTimeout(() => ac.abort(), HAN_GIAY * 1000);

    let vanBan = '';
    let coCauTruc: unknown;
    let ketThucLoi: string | undefined;
    let it: ReturnType<typeof query> | undefined;
    try {
      it = query({
        prompt: loiNhac,
        options: {
          model: MODEL,
          abortController: ac,
          ...(CLAUDE_CLI ? { pathToClaudeCodeExecutable: CLAUDE_CLI } : {}),
          // Không cho công cụ nào: đây là việc đọc-rồi-trả-lời, không phải
          // việc cần đọc file hay chạy lệnh.
          allowedTools: [],
          /**
           * `maxTurns: 3` chứ KHÔNG phải 1. thghub chạy thật trên prod 24/08:
           * một số nhóm hỏng với "Reached maximum number of turns (1)" — chat
           * dài thì mô hình cần thêm lượt mới viết xong khối JSON. Đặt 1 là ép
           * nó hỏng đúng ở những nhóm nhiều nội dung nhất, tức những nhóm đáng
           * đọc nhất.
           */
          maxTurns: 3,
          // Ép JSON đúng khuôn ngay tại SDK; `tachJson` bên dưới là đường lui
          // khi bản CLI bỏ qua tuỳ chọn này và chỉ trả văn bản.
          outputFormat: { type: 'json_schema', schema: SUMMARY_JSON_SCHEMA },
        },
      });

      for await (const msg of it) {
        if (msg.type === 'assistant') {
          for (const b of msg.message.content) if (b.type === 'text') vanBan += b.text;
        }
        if (msg.type === 'result') {
          const r = msg as { subtype?: string; structured_output?: unknown };
          if (r.subtype === 'success') {
            if (r.structured_output !== undefined) coCauTruc = r.structured_output;
          } else if (r.subtype) {
            ketThucLoi = r.subtype;
          }
        }
      }
    } catch (error) {
      const mo = error instanceof Error ? error.message : String(error);
      // Hết giờ là nhánh RIÊNG và phải xét TRƯỚC các nhánh map lỗi: SDK ném lỗi
      // abort với câu chữ tuỳ bản, để nó rơi xuống dưới là dịch nhầm thành lỗi khác.
      if (ac.signal.aborted) {
        this.logger.warn(`[zalo-summary] quá ${HAN_GIAY}s, đã hủy lượt gọi (nhóm ${input.title ?? '?'})`);
        throw new ServiceUnavailableException(`Mô hình không trả lời trong ${HAN_GIAY} giây — thử lại nhóm này sau.`);
      }
      // GHI LẠI LỖI THÔ trước khi diễn giải. Bản trước chỉ ném ra câu đã viết
      // lại, nên khi đoán sai nguyên nhân thì không còn manh mối nào để lần —
      // đã mất nhiều lượt truy trên production vì đúng chỗ này.
      this.logger.error(`[zalo-summary] lỗi gốc từ Agent SDK: ${mo.slice(0, 500)}`);
      // Agent SDK dùng phiên đăng nhập Claude Code (thư mục ~/.claude). Thiếu
      // nó thì lỗi nói về xác thực/đăng nhập — dịch sang câu chỉ rõ phải làm gì.
      // Không tìm thấy CLI là lỗi CÀI ĐẶT, khác hẳn lỗi xác thực — tách riêng
      // để người đọc không đi tìm nhầm phía thông tin đăng nhập.
      if (/ENOENT|not found|spawn/i.test(mo)) {
        throw new ServiceUnavailableException(
          'Máy chạy API chưa có CLI `claude` (Agent SDK spawn tiến trình này). Cài Claude Code rồi đặt CLAUDE_CLI_PATH trỏ tới nó.',
        );
      }
      if (/auth|credential|login|unauthor|api[ _-]?key/i.test(mo)) {
        throw new ServiceUnavailableException(
          'Backend chưa đăng nhập được Claude — kiểm tra phiên Claude Code (~/.claude) của user chạy API.',
        );
      }
      throw new ServiceUnavailableException(`Gọi mô hình thất bại: ${mo.slice(0, 200)}`);
    } finally {
      clearTimeout(dongHo);
      // Đóng tiến trình CLI con dù thành công hay hỏng — kể cả khi vòng lặp đã
      // đọc xong, SDK vẫn có thể còn giữ tiến trình tới khi bị đóng tường minh.
      it?.close();
    }

    if (ac.signal.aborted && !vanBan) {
      throw new ServiceUnavailableException(`Mô hình không trả lời trong ${HAN_GIAY} giây — thử lại nhóm này sau.`);
    }

    // Hết lượt / hết số lần ép khuôn: gọi lại y nguyên cũng hỏng y nguyên —
    // KHÔNG thử lại (422 → processor bỏ job). Nhóm tự vào hàng đợi ca sau vì
    // `denMocTin` không tiến. Bản cũ retry 3 lần: tốn 3 lượt gọi cho 1 câu hỏng.
    if (ketThucLoi === 'error_max_turns' || ketThucLoi === 'error_max_structured_output_retries') {
      throw new UnprocessableEntityException(`Mô hình không hoàn thành bản tóm tắt (${ketThucLoi}) — không thử lại.`);
    }
    if (ketThucLoi) {
      throw new ServiceUnavailableException(`Lượt gọi kết thúc với lỗi ${ketThucLoi} — thử lại nhóm này sau.`);
    }

    const parsed = coCauTruc ?? tachJson(vanBan);
    if (!parsed) {
      this.logger.error(`[zalo-summary] không tách được JSON; 300 ký tự đầu: ${vanBan.slice(0, 300)}`);
      throw new UnprocessableEntityException('Mô hình không trả về JSON đúng khuôn — không thử lại.');
    }
    this.logger.log(`[zalo-summary] nguồn kết quả: ${coCauTruc !== undefined ? 'structured_output' : 'văn bản (tachJson)'}`);

    return chuanHoa(parsed);
  }

  async list(dto: GetZaloSummariesDto): Promise<{ data: ZaloSummaryRow[]; total: number }> {
    const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
    if (dto.mucDo) filter.mucDo = dto.mucDo;
    if (dto.customerId) filter.customerId = dto.customerId;
    if (dto.conViec) filter['checklist.xong'] = false;
    if (dto.search?.trim()) {
      const q = dto.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ title: { $regex: q, $options: 'i' } }, { tieuDe: { $regex: q, $options: 'i' } }];
    }

    const { page, limit } = dto;
    const [data, total] = await Promise.all([
      this.summaryModel
        .find(filter)
        // Gấp lên đầu, trong cùng mức thì nhóm mới tóm tắt trước.
        .sort({ mucDo: 1, tomTatLuc: -1 })
        .skip(limit * (page - 1))
        .limit(limit)
        .lean(),
      this.summaryModel.countDocuments(filter),
    ]);

    // Người đọc phải biết bản tóm tắt "biết tới đâu": đo trên production có 21
    // nhóm >5 tin chờ mà UI không hề báo. Tính lúc gọi từ mốc tin cuối của nhóm,
    // không lưu — tươi tới lần `sync-zalo-groups` gần nhất.
    const links = await this.linkModel
      .find({ groupGlobalId: { $in: data.map((d) => d.groupGlobalId) } })
      .select('groupGlobalId lastMessageAt')
      .lean();
    const mocCuoi = new Map(links.map((l) => [String(l.groupGlobalId), (l as { lastMessageAt?: Date }).lastMessageAt]));

    const rows: ZaloSummaryRow[] = data.map((d) => {
      const lastMessageAt = mocCuoi.get(String(d.groupGlobalId));

      return {
        ...(d as ZaloGroupSummaryEntity & { _id: string }),
        lastMessageAt,
        coTinMoi: !!lastMessageAt && (!d.denMocTin || lastMessageAt > d.denMocTin),
      };
    });

    return { data: rows, total };
  }

  /** Người vận hành tick / bỏ tick một việc. */
  async toggleTask(groupGlobalId: string, index: number, xong: boolean): Promise<ZaloGroupSummaryDocument> {
    const truoc = await this.summaryModel.findOne({ groupGlobalId }).select('checklist').lean();
    if (!truoc) throw new NotFoundException('Chưa có bản tóm tắt cho nhóm này.');
    if (index < 0 || index >= (truoc.checklist?.length ?? 0)) {
      throw new BadRequestException('Việc không tồn tại.');
    }

    // Ghi thẳng vào đúng phần tử bằng `$set` theo chỉ số, KHÔNG đọc-sửa-ghi cả
    // mảng: lượt tóm tắt kế tiếp có thể đang thay `checklist` cùng lúc, ghi đè
    // cả mảng là nuốt mất kết quả của nó. Đây cũng là lý do repo cấm `.save()`.
    const updated = await this.summaryModel.findOneAndUpdate(
      { groupGlobalId },
      {
        $set: {
          [`checklist.${index}.xong`]: xong,
          [`checklist.${index}.xongLuc`]: xong ? new Date().toISOString() : null,
        },
        // Lượt tóm tắt đang chạy sẽ thấy rev đổi và đọc lại trước khi ghi.
        $inc: { checklistRev: 1 },
      },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Chưa có bản tóm tắt cho nhóm này.');

    return updated;
  }
}
