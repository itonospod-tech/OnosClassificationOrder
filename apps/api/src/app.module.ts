import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { redisStore } from 'cache-manager-redis-yet';
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from 'nestjs-i18n';
import path from 'path';
import { format, transports } from 'winston';
import rotateFile from 'winston-daily-rotate-file';

import { AuthModule } from '@/modules/auth/auth.module';
import { CounterModule } from '@/modules/counter/counter.module';
import { CronjobModule } from '@/modules/cronjob/cronjob.module';
import { CustomRoleModule } from '@/modules/custom-role/custom-role.module';
import { PermissionModule } from '@/modules/permission/permission.module';
import { RoleModule } from '@/modules/role/role.module';
import { SystemConfigModule } from '@/modules/system-config/system-config.module';
import { UserModule } from '@/modules/user/user.module';
import { WinstonModule } from '@/modules/winston/winston.module';

import { FastifyThrottlerGuard } from './guards/fastify-throttler.guard';
import { ActionModule } from './modules/actions/action.module';
import { AgentApiModule } from './modules/agent-api/agent-api.module';
import { AmqpModule } from './modules/amqp/amqp.module';
import { CeoDashboardModule } from './modules/ceo-dashboard/ceo-dashboard.module';
import { CustomerReportModule } from './modules/customer-report/customer-report.module';
import { CollectionModule } from './modules/collection/collection.module';
import { CustomerModule } from './modules/customer/customer.module';
import { CustomerAssignmentModule } from './modules/customer-assignment/customer-assignment.module';
import { CustomerNotificationModule } from './modules/customer-notification/customer-notification.module';
import { CustomerPortalModule } from './modules/customer-portal/customer-portal.module';
import { CustomerWalletModule } from './modules/customer-wallet/customer-wallet.module';
import { CustomerWebhookModule } from './modules/customer-webhook/customer-webhook.module';
import { DepartmentModule } from './modules/departments/department.module';
import { DesignStorageModule } from './modules/design-storage/design-storage.module';
import { DesignerModule } from './modules/designer/designer.module';
import { DesignerAssignmentModule } from './modules/designer-assignment/designer-assignment.module';
import { FactoryModule } from './modules/factory/factory.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { MachineTypeModule } from './modules/machine-type/machine-type.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { OrderModule } from './modules/order/order.module';
import { OrderLogModule } from './modules/order-log/order-log.module';
import { ProductCategoryModule } from './modules/product-category/product-category.module';
import { ProductConfigModule } from './modules/product-config/product-config.module';
import { PromotionModule } from './modules/promotion/promotion.module';
import { BullMQModule } from './modules/queue/bullmq.module';
import { RedisCacheModule } from './modules/redis-cache/redis-cache.module';
import { RedisCacheService } from './modules/redis-cache/redis-cache.service';
import { ScheduledReportsModule } from './modules/scheduled-reports/scheduled-reports.module';
import { SellerShippingModule } from './modules/seller-shipping/seller-shipping.module';
import { ShippingVnpModule } from './modules/shipping-vnp/shipping-vnp.module';
import { TelegramNotificationModule } from './modules/telegram-notification/telegram-notification.module';
import { UploadModule } from './modules/upload/upload.module';
import { WorkshopConfigModule } from './modules/workshop-config/workshop-config.module';
import { ZaloChatModule } from './modules/zalo-chat/zalo-chat.module';
import { ZaloGroupModule } from './modules/zalo-group/zalo-group.module';
import { ApiConfigService } from './shared/services';
import { RateLimiterService } from './shared/services/rate-limiter.service';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    AuthModule,
    UserModule,
    CounterModule,
    CronjobModule,
    RoleModule,
    CustomRoleModule,
    PermissionModule,
    UploadModule,
    DepartmentModule,
    FactoryModule,
    MachineTypeModule,
    ProductCategoryModule,
    CollectionModule,
    ProductConfigModule,
    PromotionModule,
    WorkshopConfigModule,
    ZaloGroupModule,
    ZaloChatModule,
    OrderModule,
    OrderLogModule,
    DesignerModule,
    DesignerAssignmentModule,
    CustomerModule,
    CustomerAssignmentModule,
    AgentApiModule,
    CeoDashboardModule,
    CustomerReportModule,
    CustomerNotificationModule,
    CustomerPortalModule,
    // ORD-4 — webhook báo đổi trạng thái đơn cho khách API.
    CustomerWebhookModule,
    // Ví seller (USD) — sổ cái + cache số dư (SellerWallet-LabelPurchase plan).
    CustomerWalletModule,
    DesignStorageModule,
    FulfillmentModule,
    ShippingVnpModule,
    SellerShippingModule,
    TelegramNotificationModule,
    ScheduledReportsModule,
    NotificationModule,
    ActionModule,
    MailModule,
    BullMQModule,
    SystemConfigModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 300,
      },
    ]),
    /**
     * Redis cache — client này dùng chung cho `CACHE_MANAGER`, `RedisCacheService` và rate limiter.
     *
     * KHÔNG rút gọn lại thành `{ store: redisStore, ... }`. Hai thứ bên dưới là bắt buộc:
     *
     * 1. `.on('error')` — `redisStore()` chỉ gọi `createClient()` chứ không gắn listener nào.
     *    Client node-redis là EventEmitter, mà EventEmitter phát `'error'` khi không có
     *    listener thì Node ném thẳng thành uncaught exception → chết cả process. Chỉ cần
     *    Redis đóng connection đang rỗi (`timeout` trong redis.conf, máy dev hay để 300s)
     *    là API tự crash sau vài phút không ai dùng, dev phải chạy lại liên tục.
     * 2. `pingInterval` — PING định kỳ để connection không bao giờ "rỗi" dưới mắt Redis,
     *    nên Redis không đóng nó ngay từ đầu. `tcp-keepalive` KHÔNG thay được: Redis tính
     *    `timeout` theo lần chạy lệnh cuối, không theo gói keep-alive tầng TCP.
     */
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ApiConfigService],
      useFactory: async (configService: ApiConfigService) => {
        const logger = new Logger('RedisCache');
        const store = await redisStore({
          password: configService.redis.password,
          database: Number(configService.redis.db),
          socket: {
            host: configService.redis.host,
            port: Number(configService.redis.port),
            // Không bao giờ bỏ cuộc: backoff tăng dần rồi chốt ở 10s.
            reconnectStrategy: (retries: number) => Math.min(1000 + retries * 500, 10_000),
          },
          pingInterval: 60_000,
        });

        store.client.on('error', (error: Error) => logger.error(`Redis client error: ${error.message}`));
        store.client.on('reconnecting', () => logger.warn('Redis reconnecting...'));
        store.client.on('ready', () => logger.log('Redis ready'));

        return { store };
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV}`,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ApiConfigService],
      useFactory: (configService: ApiConfigService) => ({
        uri: configService.mongodbURI,
      }),
    }),
    I18nModule.forRootAsync({
      useFactory: (configService: ApiConfigService) => ({
        fallbackLanguage: configService.fallbackLanguage,
        loaderOptions: {
          path: path.join(__dirname, 'i18n'),
          watch: configService.isDevelopment,
        },
      }),
      resolvers: [{ use: QueryResolver, options: ['lang'] }, AcceptLanguageResolver, new HeaderResolver(['x-lang'])],
      imports: [SharedModule],
      inject: [ApiConfigService],
    }),
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ApiConfigService],
      useFactory: (apiConfigService: ApiConfigService) =>
        apiConfigService.isDevelopment
          ? {
              level: 'info',
              format: format.json(),
              defaultMeta: { '@timestamp': new Date() },
              transports: [
                new transports.File({
                  filename: 'logs/activity.log',
                  level: 'error',
                }),
                new transports.Console({
                  format: format.simple(),
                }),
                new rotateFile({
                  filename: 'logs/application-%DATE%.log',
                  datePattern: 'YYYY-MM-DD',
                  zippedArchive: true,
                  maxSize: '20m',
                  maxFiles: '14d',
                }),
              ],
            }
          : {
              level: 'activity',
              format: format.json(),
              defaultMeta: { service: 'user-service' },
              transports: [
                new transports.File({
                  filename: 'logs/activity.log',
                  level: 'error',
                }),
                new transports.Console({
                  format: format.simple(),
                }),
                new rotateFile({
                  filename: 'logs/application-%DATE%.log',
                  datePattern: 'YYYY-MM-DD',
                  zippedArchive: true,
                  maxSize: '20m',
                  maxFiles: '14d',
                }),
              ],
            },
    }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: path.resolve('./src/assets'),
      exclude: ['/api/(.*)'],
      serveStaticOptions: {
        setHeaders: (res, filepath) => {
          if (filepath.endsWith('doc.html')) {
            res.setHeader('Content-Security-Policy', '');
          }
        },
      },
    }),
    AmqpModule,
    RedisCacheModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ApiConfigService],
      useFactory: (configService: ApiConfigService) => ({
        connection: {
          password: configService.redis.password,
          db: Number(configService.redis.db),
          host: configService.redis.host,
          port: Number(configService.redis.port),
        },
      }),
    }),
  ],
  providers: [
    RedisCacheService,
    RateLimiterService,
    {
      provide: APP_GUARD,
      useClass: FastifyThrottlerGuard,
    },
  ],
})
export class AppModule {}
