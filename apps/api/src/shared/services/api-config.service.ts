import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isNil } from 'lodash';
import cron from 'node-cron';

import { BullQueue } from '@/constants';

@Injectable()
export class ApiConfigService {
  constructor(private configService: ConfigService) {}

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  /**
   * Có gửi `stackTrace` ra THÂN PHẢN HỒI hay không.
   *
   * KHÔNG bám theo `isDevelopment`: production của hệ thống này chạy với
   * `NODE_ENV=development` (env chọn file cấu hình, không phản ánh môi trường
   * thật), nên gắn vào đó là mọi endpoint công khai đều trả về đường dẫn
   * `/root/...` cùng cấu trúc mã nguồn cho bất kỳ ai gọi — kể cả lúc chỉ gõ sai
   * khoá API. Dev bên ngoài đã báo đúng chỗ này.
   *
   * Muốn xem vết lỗi thì bật tường minh `EXPOSE_STACK_TRACE=true` trên máy mình.
   * Mặc định TẮT; vết lỗi vẫn được ghi ra log máy chủ như cũ.
   */
  get exposeStackTrace(): boolean {
    return this.configService.get<string>('EXPOSE_STACK_TRACE') === 'true';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  private getNumber(key: string): number {
    const value = this.get(key);

    try {
      return Number(value);
    } catch {
      throw new Error(key + ' environment variable is not a number');
    }
  }

  private getBoolean(key: string): boolean {
    const value = this.get(key);

    try {
      return Boolean(JSON.parse(value));
    } catch {
      throw new Error(key + ' env var is not a boolean');
    }
  }

  private getString(key: string): string {
    const value = this.get(key);

    return value.replaceAll('\\n', '\n');
  }

  private getCronTime(key: string) {
    const value = this.configService.get<string>(key);

    if (value && !cron.validate(value)) {
      throw new Error(key + ' is not a valid cron time');
    }

    return value;
  }

  get nodeEnv(): string {
    return this.getString('NODE_ENV');
  }

  get fallbackLanguage(): string {
    return this.getString('FALLBACK_LANGUAGE');
  }

  get mongodbURI(): string {
    return this.getString('DB_URI');
  }

  /**
   * Giới hạn kích thước file design khách tải lên. Đọc TÁCH khỏi `r2Config` vì
   * nó không phải credential: FE cần biết con số này để chặn sớm ngay cả khi
   * kho R2 chưa cấu hình (ORD-17). `r2Config.maxUploadMb` đọc cùng env, cùng
   * mặc định, nên hai chỗ không bao giờ lệch nhau.
   */
  get designUploadMaxMb(): number {
    const v = Number(this.configService.get<string>('DESIGN_MAX_UPLOAD_MB'));
    return Number.isFinite(v) && v > 0 ? v : 300;
  }

  /**
   * R2 (Cloudflare) config. Lenient — chỉ active khi đủ 4 field cốt lõi
   * (account/key/secret/bucket/publicBase). Thiếu → trả `null` để
   * DesignImageService skip queue, importOrders fallback giữ URL gốc thẳng.
   */
  get r2Config(): null | {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicBase: string;
    maxDownloadMb: number;
    maxUploadMb: number;
    originalTtlDays: number;
    iaDeleteMonths: number;
    previewMaxDim: number;
    previewQuality: number;
    thumbDim: number;
    thumbQuality: number;
    queueConcurrency: number;
  } {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID') || '';
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID') || '';
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY') || '';
    const bucket = this.configService.get<string>('R2_BUCKET') || '';
    const publicBase = (this.configService.get<string>('R2_PUBLIC_BASE') || '').replace(/\/$/, '');
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) return null;
    const num = (k: string, fb: number) => {
      const v = Number(this.configService.get<string>(k));
      return Number.isFinite(v) && v > 0 ? v : fb;
    };
    return {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      publicBase,
      maxDownloadMb: num('R2_MAX_DOWNLOAD_MB', 120),
      // Design storage (worker riêng) — xem documents/Plans/DesignStorage-R2-ProcessingWorker.md
      maxUploadMb: num('DESIGN_MAX_UPLOAD_MB', 300),
      originalTtlDays: num('DESIGN_ORIGINAL_TTL_DAYS', 60),
      iaDeleteMonths: num('DESIGN_IA_DELETE_MONTHS', 12),
      previewMaxDim: num('R2_PREVIEW_MAX_DIM', 1000),
      previewQuality: num('R2_PREVIEW_QUALITY', 80),
      thumbDim: num('R2_THUMB_DIM', 300),
      thumbQuality: num('R2_THUMB_QUALITY', 70),
      queueConcurrency: num('DESIGN_QUEUE_CONCURRENCY', 3),
    };
  }

  get awsS3Config() {
    return {
      bucketRegion: this.getString('AWS_S3_BUCKET_REGION'),
      bucketApiVersion: this.getString('AWS_S3_API_VERSION'),
      imagesBucketName: this.getString('AWS_S3_IMAGES_BUCKET_NAME'),
      accessKey: this.getString('AWS_S3_ACCESS_KEY_ID'),
      secretKey: this.getString('AWS_S3_SECRET_ACCESS_KEY'),
      endpoint: this.getString('AWS_S3_ENDPOINT'),
      backblazeEndpoint: this.getString('BACKBLAZE_ENDPOINT'),
    };
  }

  get documentationEnabled(): boolean {
    return this.getBoolean('ENABLE_DOCUMENTATION');
  }

  get authConfig() {
    return {
      privateKey: this.getString('JWT_PRIVATE_KEY'),
      publicKey: this.getString('JWT_PUBLIC_KEY'),
      jwtExpirationTime: this.getNumber('JWT_EXPIRATION_TIME'),
      // TTL khi user check "Ghi nhớ đăng nhập" — optional env, mặc định 30 ngày
      // nếu không set (không dùng helper `get()` vì nó throw khi thiếu key).
      jwtRememberExpirationTime: Number(this.configService.get('JWT_REMEMBER_EXPIRATION_TIME')) || 30 * 24 * 60 * 60,
      // TTL phiên mạo danh (AUTH-1 BR-10) — NGẮN hơn phiên thường. Mặc định 60
      // phút đúng con số BA chốt ở AC-09; optional env để test hạ xuống cho dễ
      // kiểm chứ không phải để nới dài ra.
      jwtImpersonationExpirationTime: Number(this.configService.get('JWT_IMPERSONATION_EXPIRATION_TIME')) || 60 * 60,
      // Chặn cứng: token mạo danh phát quá lâu thì KHÔNG cho đổi ra token
      // SuperAdmin nữa, kể cả chữ ký còn hợp lệ (lớp 3 của endpoint thoát).
      impersonationExchangeMaxAge:
        Number(this.configService.get('IMPERSONATION_EXCHANGE_MAX_AGE')) || 24 * 60 * 60,
    };
  }

  get appConfig() {
    return {
      port: this.getString('PORT'),
    };
  }

  get domainName(): string {
    return this.getString('DOMAIN_NAME');
  }

  get captchaToken(): string {
    return this.getString('RECAPTCHA_SECRET_KEY');
  }

  private get(key: string): string {
    const value = this.configService.get<string>(key);

    if (isNil(value)) {
      throw new Error(key + ' environment variable does not set'); // probably we should call process.exit() too to avoid locking the service
    }

    return value;
  }

  get adminEmail(): string {
    return this.getString('ADMIN_EMAIL');
  }

  get smtpConfig() {
    return {
      host: this.getString('SMTP_HOST'),
      user: this.getString('SMTP_USER'),
      password: this.getString('SMTP_PASSWORD'),
      from: this.getString('SMTP_FROM'),
    };
  }

  get telegram() {
    return {
      botToken: this.getString('TELEGRAM_BOT_TOKEN'),
      channelId: this.getString('TELEGRAM_CHANNEL_ID'),
      scanNotificationChannelId: this.getString('TELEGRAM_SCAN_NOTIFICATION_CHANNEL_ID'),
      notificationChannelId: this.getString('TELEGRAM_NOTIFICATION_CHANNEL_ID'),
      notificationEnabled: process.env.TELEGRAM_NOTIFICATION_ENABLED === 'true',
      // Webhook nhận callback nút bấm trên message Telegram — optional:
      // thiếu 1 trong 2 env → không đăng ký webhook, nút vẫn hiện nhưng bấm
      // không có tác dụng. URL phải là HTTPS public đầy đủ tới endpoint
      // (vd https://api.example.com/api/v1/telegram/webhook).
      webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    };
  }

  get scheduledReports() {
    return {
      enabled: process.env.SCHEDULED_REPORTS_ENABLED === 'true',
    };
  }

  /**
   * OnosPod QC production-report export (xem OnospodImportService). Optional
   * integration — thiếu config → getter trả null, feature tự disable thay vì
   * crash app boot (giống r2Config).
   */
  get onospodQcConfig(): null | { apiUrl: string; bearerToken: string } {
    const apiUrl = this.configService.get<string>('ONOSPOD_QC_API_URL') || '';
    const bearerToken = this.configService.get<string>('ONOSPOD_QC_BEARER_TOKEN') || '';
    if (!apiUrl || !bearerToken) return null;
    return { apiUrl, bearerToken };
  }

  /**
   * Đồng bộ XƯỞNG sản phẩm theo app OnosPod (Products.md §2.7a). Mặc định TẮT.
   * - `ONOSPOD_FACTORY_SYNC_MODE`: `off` | `dry-run` (chỉ báo cáo + Telegram) | `on` (ghi thật)
   * - `ONOSPOD_FACTORY_MAP`: mã manufacture app → shortName xưởng fac, vd `ML=ML,TN=TN,TN-DECOR=TNW`
   *   (trống = mặc định `DEFAULT_ONOSPOD_FACTORY_MAP`)
   * Đọc mỗi lần gọi (không cache) để đổi env + restart là ăn ngay.
   */
  get onospodFactorySync(): { mode: string; factoryMap: string } {
    return {
      mode: this.configService.get<string>('ONOSPOD_FACTORY_SYNC_MODE') || 'off',
      factoryMap: this.configService.get<string>('ONOSPOD_FACTORY_MAP') || '',
    };
  }

  /**
   * OnosPod order API (api.onospod.com/graphql) — dùng để "lấy ngược"
   * design/địa chỉ ship cho đơn đang GIỮ chờ khách cập nhật (xem
   * `OnospodOrderLookupService`). Token lấy từ phiên đăng nhập admin OnosPod —
   * PHẢI rotate định kỳ, TUYỆT ĐỐI không hardcode giá trị thật vào code/commit.
   * Optional integration — thiếu config → getter trả null, feature tự disable.
   */
  get onospodApiConfig(): null | { apiUrl: string; bearerToken: string; superToken: string } {
    const apiUrl = this.configService.get<string>('ONOSPOD_API_URL') || '';
    const bearerToken = this.configService.get<string>('ONOSPOD_API_BEARER_TOKEN') || '';
    const superToken = this.configService.get<string>('ONOSPOD_API_SUPER_TOKEN') || '';
    if (!apiUrl || !bearerToken || !superToken) return null;
    return { apiUrl, bearerToken, superToken };
  }

  /**
   * VNP eGlobal Shipment API (vận đơn/label quốc tế) — spec ở
   * `Data/Tai_lieu_API_VNP_eGlobal_dev.pdf` + swagger `/api/v3/api-docs`.
   * Auth bằng email/password → JWT (`POST /auth/signin`). `shippingUnitId`
   * do Nexo cấp theo môi trường (staging/production khác nhau).
   * Optional integration — thiếu email/password → getter trả null, feature
   * tự disable (endpoint trả lỗi "chưa cấu hình" thay vì crash).
   */
  get vnpEglobalConfig(): null | {
    apiUrl: string;
    email: string;
    password: string;
    shippingUnitId: string;
    fromAddressId: string;
  } {
    const apiUrl = this.configService.get<string>('VNP_EGLOBAL_API_URL') || 'https://vnp-eglobal.itel.dev/api';
    const email = this.configService.get<string>('VNP_EGLOBAL_EMAIL') || '';
    const password = this.configService.get<string>('VNP_EGLOBAL_PASSWORD') || '';
    const shippingUnitId = this.configService.get<string>('VNP_EGLOBAL_SHIPPING_UNIT_ID') || '';
    const fromAddressId = this.configService.get<string>('VNP_EGLOBAL_FROM_ADDRESS_ID') || '';
    if (!email || !password) return null;
    return { apiUrl, email, password, shippingUnitId, fromAddressId };
  }

  /** Tên các env còn thiếu của VNP eGlobal — cho endpoint status (không lộ giá trị). */
  get vnpEglobalMissingEnv(): string[] {
    const missing: string[] = [];
    if (!this.configService.get<string>('VNP_EGLOBAL_EMAIL')) missing.push('VNP_EGLOBAL_EMAIL');
    if (!this.configService.get<string>('VNP_EGLOBAL_PASSWORD')) missing.push('VNP_EGLOBAL_PASSWORD');
    if (!this.configService.get<string>('VNP_EGLOBAL_SHIPPING_UNIT_ID')) missing.push('VNP_EGLOBAL_SHIPPING_UNIT_ID');
    return missing;
  }

  get cdn() {
    return {
      url: this.getString('CDN_URL'),
    };
  }

  /**
   * Bộ API nội bộ cho AI agent (`API-1`). Khoá RIÊNG, tách hẳn khỏi tài khoản
   * người thật và khỏi cụm `partnerApi` bên dưới — xem quyết định D5 ở
   * `.devtasks/design/API-1.md`. Thiếu `AGENT_API_KEY` thì mọi endpoint đóng,
   * không có chế độ "mở khi thiếu cấu hình".
   */
  /**
   * Zalo Engine — dịch vụ của nhà cung cấp cho màn chat `/adm/zalo`.
   *
   * `url` trỏ vào cổng loopback mà `docker/zalo-engine/docker-compose.yml` mở
   * (mặc định 4001). `secret` PHẢI trùng `ZALO_ENGINE_SECRET` của engine —
   * lệch là mọi lời gọi bị engine từ chối với 401 không nói lý do.
   * Thiếu cả hai thì proxy trả lỗi cấu hình, phần còn lại của API vẫn chạy.
   */
  get zaloEngine() {
    return {
      url: process.env.ZALO_ENGINE_URL || '',
      secret: process.env.ZALO_ENGINE_SECRET || '',
    };
  }

  get agentApi() {
    return {
      key: process.env.AGENT_API_KEY || '',
      /** Trần lô cứng — `limit` lớn hơn bị KẸP xuống đây, không báo lỗi (AC-03). */
      maxLimit: Number(process.env.AGENT_API_MAX_LIMIT || 200),
      readTimeoutMs: Number(process.env.AGENT_API_READ_TIMEOUT_MS || 3000),
      queryTimeoutMs: Number(process.env.AGENT_API_QUERY_TIMEOUT_MS || 8000),
      // Hạn mức KHÔNG cấu hình được bằng env — con số chặn thật nằm ở
      // `agent-api/agent-api.constants.ts`. Xem `API-4`: biến env cũ ở đây
      // chưa từng được tiêu thụ, nên nó chỉ hứa suông với người vận hành.
      /** Ghi đè thư mục tài liệu; rỗng thì tự dò theo thứ tự ở `agent-docs.service.ts`. */
      docsDir: process.env.AGENT_DOCS_DIR || '',
    };
  }

  /**
   * CHƯA CÓ TÍNH NĂNG NÀO DÙNG CỤM NÀY (`QA-4`).
   *
   * Không module partner nào tồn tại trong `apps/api/src/modules`, và
   * `grep partnerApi` toàn `apps/api/src` chỉ ra đúng dòng khai báo dưới đây.
   * Đặt `PARTNER_API_*` trong `.env` **không đổi hành vi nào của hệ thống** —
   * ghi rõ ở đây để người vận hành không tưởng là đã siết được hạn mức hay cửa
   * sổ nonce, giống hiểu nhầm mà `API-4` vừa phải gỡ cho cụm `agentApi`.
   *
   * Cụm này có từ commit đầu tiên của repo. Giữ nguyên chứ không xoá: nếu đây
   * là phần chuẩn bị cho Partner API sắp làm thì xoá là phá. Đã hỏi người dùng
   * ở `task_notes` #15; có câu trả lời rồi mới quyết dọn hay giữ.
   *
   * Lưu ý khi dọn: `masterKey` dùng `getString(...)` nên là biến **bắt buộc** —
   * nó chưa nổ chỉ vì getter này chưa từng được gọi.
   */
  get partnerApi() {
    return {
      masterKey: this.getString('API_KEY_MASTER_KEY'),
      timestampWindowSeconds: Number(process.env.PARTNER_API_TIMESTAMP_WINDOW || 300),
      rateLimitPerMin: Number(process.env.PARTNER_API_RATE_LIMIT_PER_MIN || 60),
      rateLimitPerDay: Number(process.env.PARTNER_API_RATE_LIMIT_PER_DAY || 10000),
      nonceTtlSeconds: Number(process.env.PARTNER_API_NONCE_TTL || 600),
    };
  }

  get GDriveCDNUrl() {
    return this.getString('GDRIVE_CDN_URL');
  }

  get bottleneck() {
    return {
      downloadImagesMaxConcurrent: this.getString('DOWNLOAD_IMAGES_MAX_CONCURRENT'),
      downloadImagesMaxRetry: this.getString('DOWNLOAD_IMAGES_MAX_RETRY'),
      uploadImagesMaxRetry: this.getString('UPLOAD_IMAGES_MAX_RETRY'),
    };
  }

  get bullmq() {
    return {
      cronTime: {
        [BullQueue.RefreshTrackingStatus]: this.getCronTime('BULLMQ_REFRESH_TRACKING_STATUS_CRON_TIME'),
        [BullQueue.ScanTransactionEmail]: this.getCronTime('BULLMQ_SCAN_TRANSACTION_EMAIL_CRON_TIME'),
        [BullQueue.SendMail]: this.getCronTime('BULLMQ_SEND_MAIL_CRON_TIME'),
      },
    };
  }

  get rabbitmq() {
    return {
      uri: this.getString('RABBITMQ_URI'),
      mainExchange: this.getString('RABBITMQ_MAIN_EXCHANGE'),
    };
  }

  get beefun() {
    return {
      username: this.getString('BEEFUN_USERNAME'),
      password: this.getString('BEEFUN_PASSWORD'),
    };
  }

  get flashship() {
    return {
      apiUrl: this.getString('FLASHSHIP_API_URL'),
      username: this.getString('FLASHSHIP_USERNAME'),
      password: this.getString('FLASHSHIP_PASSWORD'),
    };
  }

  get printcare() {
    return {
      username: this.getString('PRINTCARE_USERNAME'),
      password: this.getString('PRINTCARE_PASSWORD'),
    };
  }

  get burgerPrints() {
    return {
      apiUrl: this.getString('BURGER_PRINTS_API_URL'),
      apiKey: this.getString('BURGER_PRINTS_API_KEY'),
      webApiUrl: this.getString('BURGER_PRINTS_WEB_API_URL'),
      username: this.getString('BURGER_PRINTS_USERNAME'),
      password: this.getString('BURGER_PRINTS_PASSWORD'),
    };
  }

  get onosPod() {
    return {
      apiUrl: this.getString('ONOS_POD_API_URL'),
      username: this.getString('ONOS_POD_USERNAME'),
      password: this.getString('ONOS_POD_PASSWORD'),
    };
  }

  get gearment() {
    return {
      apiUrl: this.getString('GEARMENT_API_URL'),
      apiKey: this.getString('GEARMENT_API_KEY'),
      apiSignature: this.getString('GEARMENT_API_SIGNATURE'),
      storeId: this.getString('GEARMENT_STORE_ID'),
    };
  }

  get merchize() {
    return {
      apiUrl: this.getString('MERCHIZE_API_URL'),
      apiKey: this.getString('MERCHIZE_API_TOKEN'),
    };
  }

  get customCat() {
    return {
      apiUrl: this.getString('CUSTOMCAT_API_URL'),
      apiKey: this.getString('CUSTOMCAT_API_KEY'),
    };
  }

  get usFulfill() {
    return {
      apiUrl: this.getString('US_FULFILL_API_URL'),
      apiKey: this.getString('US_FULFILL_API_KEY'),
    };
  }

  get hubFulfill() {
    return {
      apiUrl: this.getString('HUB_FULFILL_API_URL'),
      apiKey: this.getString('HUB_FULFILL_API_KEY'),
    };
  }

  get dreamship() {
    return {
      apiUrl: this.getString('DREAMSHIP_API_URL'),
      apiKey: this.getString('DREAMSHIP_API_KEY'),
    };
  }

  get printees() {
    return {
      apiUrl: this.getString('PRINTEES_API_URL'),
      apiKey: this.getString('PRINTEES_API_KEY'),
    };
  }

  get printify() {
    return {
      apiUrl: this.getString('PRINTIFY_API_URL'),
      apiToken: this.getString('PRINTIFY_API_TOKEN'),
      shopId: this.getString('PRINTIFY_SHOP_ID'),
    };
  }

  get labelService() {
    return {
      url: this.getString('LABEL_SERVICE_API_URL'),
    };
  }

  get webUrl() {
    return this.getString('WEB_URL');
  }

  get redis() {
    return {
      password: this.getString('REDIS_PASSWORD'),
      host: this.getString('REDIS_HOST'),
      port: this.getString('REDIS_PORT'),
      db: this.getString('REDIS_DB'),
    };
  }

  get rateLimiter() {
    return {
      enabled: this.getBoolean('RATE_LIMITER_ENABLED'),
      sessionMax: this.getNumber('RATE_LIMITER_SESSION_MAX'),
      sessionTtl: this.getNumber('RATE_LIMITER_SESSION_TTL'),
      userMax: this.getNumber('RATE_LIMITER_USER_MAX'),
      userTtl: this.getNumber('RATE_LIMITER_USER_TTL'),
    };
  }

  get adminChannel() {
    return {
      channelId: this.getString('TELEGRAM_CHANNEL_ID'),
      botToken: this.getString('TELEGRAM_BOT_TOKEN'),
    };
  }

  get elasticsearch() {
    return {
      host: this.getString('ELASTICSEARCH_HOST'),
      apiKey: this.getString('ELASTICSEARCH_APIKEY'),
      userActionIndex: this.getString('USER_ACTION_INDEX'),
    };
  }

  get smtp() {
    return {
      username: this.getString('SMTP_USERNAME'),
      password: this.getString('SMTP_PASSWORD'),
      host: this.getString('SMTP_HOST'),
      port: this.getNumber('SMTP_PORT'),
    };
  }

  get trackingStatus() {
    return {
      apiUrl: this.getString('TRACKING_STATUS_API_URL'),
    };
  }

  get Ocr() {
    return {
      url: this.getString('OCR_URL'),
    };
  }

  get GOauth() {
    return {
      type: this.getString('GOAUTH_TYPE'),
      projectId: this.getString('GOAUTH_PROJECT_ID'),
      clientId: this.getString('GOAUTH_CLIENT_ID'),
      clientSecret: this.getString('GOAUTH_CLIENT_SECRET'),
      authUri: this.getString('GOAUTH_AUTH_URI'),
      tokenUri: this.getString('GOAUTH_TOKEN_URI'),
      authProviderX509CertUrl: this.getString('GOAUTH_AUTH_PROVIDER_X509_CERT_URL'),
      accessToken: this.getString('GOAUTH_ACCESS_TOKEN'),
      refreshToken: this.getString('GOAUTH_REFRESH_TOKEN'),
      redirectUri: this.getString('GOAUTH_REDIRECT_URL'),
    };
  }

  get emailScanFrom() {
    return {
      pingpong: this.getString('PINGPONG_EMAIL_SCAN_FROM'),
      lianlian: this.getString('LIANLIAN_EMAIL_SCAN_FROM'),
    };
  }

  get lark() {
    return {
      onosfactoryBotId: this.getString('LARK_PRINTSEL_BOT_ID'),
    };
  }

  get payOS() {
    return {
      clientId: this.getString('PAYOS_CLIENT_ID'),
      apiKey: this.getString('PAYOS_API_KEY'),
      checksumKey: this.getString('PAYOS_CHECKSUM_KEY'),
    };
  }

  get topup() {
    return {
      urlCallback: this.getString('TOPUP_URL_CALLBACK'),
      urlProcessedCallback: this.getString('TOPUP_URL_PROCESSED_CALLBACK'),
    };
  }
}
