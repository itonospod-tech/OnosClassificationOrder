import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import type { DirectoryUser, ZaloProxyUser } from '@zero-126/zalo-sdk/next';
import { Model } from 'mongoose';
import { RoleType, Status } from 'shared';

import { duocTruyCapZalo } from '@/utils/zalo-access';

import { ApiConfigService } from '../../shared/services/api-config.service';
import { UserEntity } from '../user/user.entity';
import { ZALO_COOKIE_PATHS, ZALO_SESSION_COOKIE, ZALO_SESSION_TTL_SEC } from './zalo-chat.constants';

/** Payload của cookie phiên — vừa đủ để proxy dựng 4 header danh tính. */
interface PhienZalo {
  sub: string;
  ten: string;
  vai: ZaloProxyUser['role'];
  /** Nhãn chức danh hiển thị (tên role hệ thống) — engine không lưu, chỉ để UI hiện. */
  nhan?: string;
  /** Phạm vi (`role:*`, `dept:*`, `factory:*`) — vế "Match scope" của rule bên engine. */
  pv?: string[];
}

/** Hình dạng tối thiểu của user cần để suy vai + phạm vi (khỏi phụ thuộc UserDocument đầy đủ). */
export interface NhanSuZalo {
  _id: unknown;
  fullName?: string;
  email?: string;
  status?: string;
  factoryId?: string;
  role?: { name?: string };
  department?: { code?: string; name?: string };
}

/**
 * Cấp và đọc phiên cho màn chat Zalo.
 *
 * Cố ý KHÔNG tự nghĩ ra cơ chế ký mới: dùng luôn cặp khoá RS256 của hệ thống
 * (`JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`) — một nơi để xoay khoá, một nơi để hỏng.
 */
@Injectable()
export class ZaloChatService {
  private readonly logger = new Logger(ZaloChatService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ApiConfigService,
    @InjectModel(UserEntity.name) private readonly userModel: Model<UserEntity>,
  ) {}

  /**
   * Vai trò trong engine suy từ vai trò hệ thống.
   *
   * Đợt đầu CHỈ SuperAdmin/Admin được vào, và vào là `owner` (thấy mọi hội
   * thoại). Người khác trả `null` → controller từ chối, không cấp cookie.
   * Muốn mở cho Manager/Support sau này thì thêm nhánh `member` ở đây, KHÔNG
   * phải nới ở proxy — proxy chỉ đọc lại thứ đã ký.
   */
  vaiTro(role?: string, email?: string): ZaloProxyUser['role'] | null {
    // Chốt danh sách trắng đứng TRƯỚC mọi xét role: quyền đọc chat không đi theo
    // role, vì role SuperAdmin còn được cấp thêm mỗi khi có người mới tham gia.
    // Xem `utils/zalo-access.ts`.
    if (!duocTruyCapZalo(email)) return null;
    if (role === RoleType.SuperAdmin || role === RoleType.Admin) return 'owner';
    // Nhân sự khác vào với tier `member`: engine CHƯA cho thấy gì cho tới khi có
    // rule theo role/scope hoặc grant lẻ (dialog "Phân quyền" của nhà cung cấp).
    // Trước 08/09/2026 chỗ này trả null cho mọi role khác → không ai ngoài Admin
    // lấy được phiên, nên rule/grant bên engine vĩnh viễn không khớp ai.
    if (!role || role === String(RoleType.Customer)) return null;

    return 'member';
  }

  /**
   * Phạm vi của một nhân sự — vế phải của rule "Match scope" bên engine.
   *
   * Tiền tố cố định để tự mô tả và để autocomplete bên engine gom nhóm được:
   *   `role:<Tên role>` · `dept:<mã phòng ban>` · `factory:<mã xưởng>`
   * Engine không hiểu ngữ nghĩa, nó chỉ so chuỗi — nên chuỗi phải ỔN ĐỊNH.
   */
  phamVi(user: NhanSuZalo, tenXuong?: string): string[] {
    const pv: string[] = [];
    if (user.role?.name) pv.push(`role:${user.role.name}`);
    const dept = user.department?.code || user.department?.name;
    if (dept) pv.push(`dept:${dept}`);
    if (tenXuong) pv.push(`factory:${tenXuong}`);

    return pv;
  }

  /** Mã xưởng (shortName) từ `factoryId` — dùng dựng scope `factory:*`. */
  async maXuong(factoryId?: string): Promise<string | undefined> {
    if (!factoryId) return undefined;
    const f = await this.userModel.db
      .collection('factories')
      .findOne<{ shortName?: string; name?: string }>({ _id: factoryId } as unknown as Record<string, unknown>, {
        projection: { shortName: 1, name: 1 },
      });

    return f?.shortName || f?.name || undefined;
  }

  /** Ký cookie phiên. Trả MỘT chuỗi `Set-Cookie` cho MỖI đường proxy (Zalo + Telegram). */
  async cookiePhien(
    userId: string,
    displayName: string,
    vai: ZaloProxyUser['role'],
    nhan?: string,
    pv?: string[],
  ): Promise<string[]> {
    const token = await this.jwtService.signAsync(
      { sub: userId, ten: displayName, vai, nhan, pv } satisfies PhienZalo,
      { privateKey: this.configService.authConfig.privateKey, expiresIn: ZALO_SESSION_TTL_SEC },
    );

    // `Path` hẹp đúng đường proxy: cookie này không đi kèm mọi request của app.
    // `SameSite=Lax` đủ vì SDK gọi same-origin; `Secure` chỉ bật ở production
    // (dev có thể chạy http trên máy trong mạng).
    // Một cookie cho MỖI đường proxy thay vì nới `Path=/api`: nới ra là cookie
    // này đi kèm mọi lời gọi `api/v1` của app, rộng hơn mức cần.
    return ZALO_COOKIE_PATHS.map((duong) => {
      const phan = [`${ZALO_SESSION_COOKIE}=${token}`, `Path=${duong}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${ZALO_SESSION_TTL_SEC}`];
      if (this.configService.isProduction) phan.push('Secure');

      return phan.join('; ');
    });
  }

  /** Cookie xoá phiên (đăng xuất khỏi màn chat) — xoá ở CẢ hai đường proxy. */
  cookieXoa(): string[] {
    return ZALO_COOKIE_PATHS.map((duong) => `${ZALO_SESSION_COOKIE}=; Path=${duong}; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  /** Đọc phiên từ header `cookie` thô. Trả `null` nếu thiếu/hỏng/hết hạn. */
  async docPhien(cookieHeader?: string): Promise<ZaloProxyUser | null> {
    const token = this.layCookie(cookieHeader, ZALO_SESSION_COOKIE);
    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync<PhienZalo>(token, {
        publicKey: this.configService.authConfig.publicKey,
        algorithms: ['RS256'],
      });
      if (!payload?.sub || !payload.vai) return null;

      return {
        id: payload.sub,
        displayName: payload.ten,
        role: payload.vai,
        roleLabel: payload.nhan,
        // Trước 08/09/2026 luôn trả `[]` → rule "Theo scope của user" không khớp ai.
        scopes: payload.pv ?? [],
      };
    } catch {
      // Hết hạn là chuyện thường (phiên 8 giờ) — không ghi log ồn.
      return null;
    }
  }

  /**
   * Danh bạ nhân sự cho `GET /api/zalo-multi/directory` — dialog "Phân quyền"
   * của nhà cung cấp dùng nó để (1) liệt kê người cấp quyền lẻ, (2) gợi ý chuỗi
   * scope ở phần rule tự động.
   *
   * Chưa khai `listUsers` thì proxy trả `[]` và dialog báo "Không có user nào
   * trong role này" — đúng lỗi ops gặp 08/09/2026. Dữ liệu nhân sự phục vụ TẠI
   * app, KHÔNG forward sang engine.
   */
  async danhBa(): Promise<DirectoryUser[]> {
    const rows = await this.userModel
      .find({ status: Status.Active, deletedAt: { $exists: false } })
      .select('fullName email roleId departmentId factoryId avatarId')
      .populate({ path: 'role', select: 'name' })
      .populate({ path: 'department', select: 'name code' })
      .lean<Array<NhanSuZalo & { _id: unknown }>>();

    // Xưởng: tra một lượt rồi map, khỏi populate từng dòng.
    const factoryIds = [...new Set(rows.map((r) => r.factoryId).filter((x): x is string => !!x))];
    const factories = factoryIds.length
      ? await this.userModel.db
          .collection('factories')
          .find<{ _id: string; shortName?: string; name?: string }>(
            // `_id` của xưởng là chuỗi 16 ký tự (DatabaseEntityAbstract), không phải ObjectId.
            { _id: { $in: factoryIds } } as unknown as Record<string, unknown>,
            { projection: { shortName: 1, name: 1 } },
          )
          .toArray()
      : [];
    const tenXuong = new Map(factories.map((f) => [String(f._id), String(f.shortName || f.name || '')]));

    return rows.flatMap((u) => {
      const vai = this.vaiTro(u.role?.name, u.email);
      if (!vai) return [];

      return [
        {
          id: String(u._id),
          displayName: u.fullName || u.email || String(u._id),
          role: vai,
          roleLabel: u.role?.name,
          scopes: this.phamVi(u, u.factoryId ? tenXuong.get(u.factoryId) : undefined),
          email: u.email,
          department: u.department?.name,
        } satisfies DirectoryUser,
      ];
    });
  }

  /** Tự tách cookie thay vì thêm plugin: chỉ cần đúng một tên, không cần ký/giải mã. */
  private layCookie(header: string | undefined, ten: string): string | null {
    if (!header) return null;
    for (const phan of header.split(';')) {
      const i = phan.indexOf('=');
      if (i < 0) continue;
      if (phan.slice(0, i).trim() === ten) return phan.slice(i + 1).trim();
    }

    return null;
  }
}
