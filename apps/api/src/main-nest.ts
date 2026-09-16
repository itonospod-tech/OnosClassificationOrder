import type { ZodDtoStatic } from '@anatine/zod-nestjs/src/lib/create-zod-dto';
import { default as multipart } from '@fastify/multipart';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Transport } from '@nestjs/microservices';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
// import compression from 'compression';
import { CustomExceptionFilter, UnprocessableEntityFilter } from 'core';
import helmet from 'helmet';
// import morgan from 'morgan';
import { I18nService } from 'nestjs-i18n';

import { AppModule } from './app.module';
import { setupSwagger } from './setup-swagger';
import { isMachineSurfaceUrl, resolveRequestLang, runWithRequestLang } from './shared/i18n/request-language';
import { ApiConfigService } from './shared/services';
import { SharedModule } from './shared/shared.module';

/**
 * 3 origin cố định của hệ thống. Trước đây `ALLOWED_ORIGINS` trong env sẽ THAY
 * THẾ trọn bộ này — đặt env cho tunnel là mất luôn quyền truy cập từ
 * onosfactory.com. Giờ env chỉ BỔ SUNG thêm.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://onosfactory.com',
  'https://api.onosfactory.com',
  // Seller Portal (apps/seller). Luồng chính đi qua proxy Next server→server (không CORS);
  // giữ ở đây để upload/preview gọi thẳng khi cần và dev tunnel qua ALLOWED_ORIGINS.
  'https://seller.onosfactory.com',
];

/**
 * Origin ngoài danh sách cứng — khai báo qua env `ALLOWED_ORIGINS`, ngăn cách
 * bằng dấu phẩy. Dùng cho domain Cloudflare Tunnel khi dev (vd
 * `https://task.lcndev.online`) vì `isLocalDevOrigin()` bên dưới chỉ nhận
 * localhost/IP LAN, không nhận domain thật.
 */
const ALLOWED_ORIGINS = [
  ...new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(process.env.ALLOWED_ORIGINS?.split(',') ?? []).map((origin) => origin.trim()).filter(Boolean),
  ]),
];

/**
 * Origin của máy dev: `localhost`/`127.0.0.1`/`::1` hoặc IP LAN riêng tư, cổng bất kỳ.
 *
 * `apps/web` chạy `vite --host` nên cổng có thể tự nhảy sang 5174/5175… khi 5173
 * đã bị chiếm, và trang còn mở được qua IP LAN để test trên điện thoại. Nếu chỉ
 * whitelist đúng `localhost:5173` thì mọi trường hợp đó đều bị chặn, và trình
 * duyệt chỉ báo "Network Error" chung chung — rất khó lần ra nguyên nhân.
 */
function isLocalDevOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/.test(
    origin,
  );
}

export async function bootstrap(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 10_048_576,
    }),
    {
      cors: {
        origin: (origin, callback) => {
          // Request không có Origin (curl, server-to-server, health check) — không phải CORS.
          if (!origin) {
            callback(null, true);
            return;
          }

          // Nới cho máy dev, và CHỈ ngoài production — production vẫn đúng whitelist.
          const allowed =
            ALLOWED_ORIGINS.includes(origin) || (process.env.NODE_ENV !== 'production' && isLocalDevOrigin(origin));

          // Từ chối bằng `false` (không gắn header CORS) thay vì ném Error — ném
          // Error sẽ biến thành lỗi 500 thay vì để trình duyệt chặn như bình thường.
          callback(null, allowed);
        },
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        preflightContinue: false,
        optionsSuccessStatus: 204,
        credentials: true,
        maxAge: 86_400,
        // `X-Agent-Api-Key` cho phần "Thử gọi" của trang hướng dẫn Agent API (`API-3`):
        // trình duyệt gọi thẳng /v1/agent/* nên preflight phải cho gửi header này.
        // Chỉ nới HEADER — whitelist `origin` ở trên giữ nguyên, bên thứ ba vẫn bị
        // chặn từ vòng origin trước khi tới đây.
        allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Agent-Api-Key',
      },
    },
  );

  const configService = app.select(SharedModule).get(ApiConfigService);

  if (configService.isProduction) {
    // app.enable('trust proxy');
  }

  // @ts-expect-error multipart
  void app.register(multipart);

  // Preserve raw body cho /api/v1/partner/* — cần để verify HMAC signature đúng byte-for-byte
  // Dùng preParsing hook để capture raw stream BEFORE Nest's JSON parser chạy
  const fastifyInstance = app.getHttpAdapter().getInstance();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify preParsing hook generics quá phức tạp, chỉ đọc request.url
  fastifyInstance.addHook('preParsing', async (request: any, _reply: any, payload: any) => {
    // Hai đường cần thân THÔ: chữ ký HMAC ký trên nguyên văn byte gửi đi, nên
    // dựng lại từ object đã parse là không khớp (thứ tự khoá, khoảng trắng).
    const canThanTho = request.url?.startsWith('/api/v1/partner') || request.url?.startsWith('/api/v1/agent/zalo/inbound');
    if (!canThanTho) {
      return payload;
    }

    const chunks: Buffer[] = [];

    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }

    const rawBuffer = Buffer.concat(chunks);
    request.rawBody = rawBuffer.toString('utf8');

    const { Readable } = await import('node:stream');

    // Phải emit Buffer chunks (không phải string) để Fastify default parser xử lý được
    return Readable.from([rawBuffer]);
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Ngôn ngữ của request, giữ trong AsyncLocalStorage để service ném lỗi đúng
  // thứ tiếng mà không phải thêm tham số vào từng hàm (ORD-29). Phải gọi
  // `next()` BÊN TRONG `runWithRequestLang` thì ngữ cảnh mới theo được chuỗi
  // async của request. Không khai gì / thứ tiếng lạ / bề mặt máy → tiếng Việt.
  app.use((req: { headers: Record<string, string | undefined>; url?: string }, _res: unknown, next: () => void) => {
    const url = req.url ?? '';
    runWithRequestLang(resolveRequestLang(req.headers['accept-language'], url), () => next(), isMachineSurfaceUrl(url));
  });
  // app.setGlobalPrefix('/api'); use api as global prefix if you don't have subdomain
  // app.use(
  //   rateLimit({
  //     windowMs: 1 * 60 * 1000, // 1 minutes
  //     max: 100, // limit each IP to 100 requests per windowMs
  //   }),
  // );
  // app.enableCors();
  // app.use(compression());
  // app.use(morgan('combined'));
  app.enableVersioning();
  app.setGlobalPrefix('api/v1');

  const reflector = app.get(Reflector);

  app.useGlobalFilters(
    new CustomExceptionFilter(configService.exposeStackTrace, app.select(SharedModule).get(I18nService)),
    new UnprocessableEntityFilter(reflector, configService.exposeStackTrace, app.select(SharedModule).get(I18nService)),
  );

  @Injectable()
  class ZodValidationPipe implements PipeTransform {
    public transform(value: unknown, metadata: ArgumentMetadata): unknown {
      const zodSchema = (metadata.metatype as ZodDtoStatic).zodSchema;

      if (zodSchema) {
        const parseResult = zodSchema.safeParse(value);

        if (!parseResult.success) {
          const { error } = parseResult;

          // const message = error.errors.map((error2) => `${error2.path.join('.')}: ${error.message}`);

          throw new UnprocessableEntityException(error);
        }

        return parseResult.data;
      }

      return value;
    }
  }

  app.useGlobalPipes(new ZodValidationPipe());

  if (configService.documentationEnabled) {
    setupSwagger(app);
  }

  // Starts listening for shutdown hooks
  if (!configService.isDevelopment) {
    app.enableShutdownHooks();
  }

  const port = configService.appConfig.port;

  if (!process.env.VITE) {
    await app.listen(port, '0.0.0.0');
    console.info(`server running on ${await app.getUrl()}`);
  }

  return app;
}

export async function bootstrapMicroservice() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URI!],
    },
  });

  // Tiến trình này nạp CÙNG `AppModule` với tiến trình HTTP (`main.ts` gọi cả
  // hai), nên `ScheduleModule` đăng ký MỌI `@Cron` hai lần và tới giờ chúng nổ
  // hai lần. Đo trên prod 10/09/2026: mỗi báo cáo CEO sinh 2 bản cách nhau 1
  // giây, tức mỗi ngày gọi Agent SDK gấp đôi — tốn tiền thật, chưa kể cron nào
  // ghi dữ liệu thì chạy đúp.
  //
  // Hẹn giờ là việc của tiến trình HTTP; việc của tiến trình này là nghe RMQ.
  // Gỡ lịch Ở ĐÂY, một chỗ, để cron THÊM SAU NÀY cũng không dính lại lỗi này.
  // KHÔNG dọn lịch cron ở đây.
  //
  // Đã thử hai cách và cả hai đều sai (11/09/2026): gỡ SAU `listen()` thì trên
  // prod không bao giờ chạy vì `listen()` của transport RMQ không trả về; gọi
  // `init()` trước để gỡ thì `listen()` đăng ký lịch LẦN NỮA trong cùng context
  // → trùng tên → `SchedulerRegistry` ném và sập cả tiến trình.
  //
  // Chốt thật nằm trong THÂN từng cron (`utils/cron-guard.ts`): lịch vẫn được
  // đăng ký ở context này nhưng tới giờ thì thoát ngay. Cách đó không phụ thuộc
  // vào việc bootstrap chạy tới đâu.
  await app.listen();
  console.info('Microservice is listening...');
}

// void bootstrap();
// void bootstrapMicroservice();
