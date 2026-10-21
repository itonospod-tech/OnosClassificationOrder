import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiFile, AuthUser, IFile } from 'core';
import type { FastifyRequest } from 'fastify';
import { createReadStream } from 'fs';
import {
  CrawlPageInfoDto,
  CrawlPageInfoResDto,
  CrawlProductMockupsDto,
  CrawlProductMockupsResDto,
  CreateProductConfigDto,
  CreateProductConfigResDto,
  GetOnospodFactorySyncLastRunResDto,
  GetProductConfigResDto,
  GetProductConfigsDto,
  GetProductConfigsResDto,
  GetUnmatchedOrderTypesDto,
  GetUnmatchedOrderTypesResDto,
  ImportFromOnospodDto,
  ImportFromOnospodResDto,
  ImportFullProductsDto,
  ImportFullProductsResDto,
  ImportProductConfigDto,
  ImportProductConfigResDto,
  ResDto,
  RoleType,
  SyncOnospodFactoryDto,
  SyncOnospodFactoryResDto,
  UpdateProductConfigDto,
  UpdateProductConfigResDto,
  UploadProductImageDto,
  UploadProductImageResDto,
} from 'shared';
import { Logger } from 'winston';

import { Auth } from '@/decorators';

import type { UserDocument } from '../user/user.entity';
import { OnospodFactorySyncService } from './onospod-factory-sync.service';
import { OnospodProductImportService } from './onospod-product-import.service';
import { ProductConfigService } from './product-config.service';

@Controller('product-configs')
@ApiTags('product-configs')
export class ProductConfigController {
  constructor(
    private readonly productConfigService: ProductConfigService,
    private readonly onospodProductImportService: OnospodProductImportService,
    private readonly onospodFactorySyncService: OnospodFactorySyncService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  @Get()
  // AUTH-6 — Support ĐỌC được (trang /adm/products). Từ 10/09/2026 Support được thêm
  // quyền TẠO + SỬA sản phẩm (GET :id / POST / PATCH :id / upload-image); các route
  // còn lại (delete, import*, crawl*) GIỮ NGUYÊN Admin+Manager.
  @Auth([RoleType.Admin, RoleType.Manager, RoleType.Support])
  @ApiOperation({ summary: 'List product configs' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetProductConfigsResDto })
  async getProductConfigs(@Query() dto: GetProductConfigsDto): Promise<GetProductConfigsResDto> {
    return this.productConfigService.getProductConfigs(dto);
  }

  // Khai báo TRƯỚC `@Get(':id')` — route param 1 segment sẽ nuốt path này nếu đứng sau.
  @Get('unmatched-order-types')
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Loại sản phẩm xuất hiện trên đơn N ngày gần nhất nhưng CHƯA có Product Config' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetUnmatchedOrderTypesResDto })
  async getUnmatchedOrderTypes(@Query() dto: GetUnmatchedOrderTypesDto): Promise<GetUnmatchedOrderTypesResDto> {
    return { success: true, data: await this.productConfigService.getUnmatchedOrderTypes(dto.days) };
  }

  @Get(':id')
  @Auth([RoleType.Admin, RoleType.Manager, RoleType.Support])
  @ApiOperation({ summary: 'Get 1 product config by id' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetProductConfigResDto })
  async getProductConfig(@Param('id') id: string): Promise<GetProductConfigResDto> {
    return { success: true, data: await this.productConfigService.getProductConfig(id) };
  }

  @Get('uploaded-image/:folder/:filename')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: 'Serve mockup/size-chart image uploaded to local disk (public, dùng cho <img src>)' })
  // Web app (vd :5173) và API (vd :3007) khác origin — helmet mặc định set
  // Cross-Origin-Resource-Policy: same-origin nên trình duyệt CHẶN hiển thị ảnh
  // qua <img> dù URL mở trực tiếp vẫn OK (CORP chỉ chặn embed cross-origin,
  // không chặn navigation). Override riêng route này thành cross-origin.
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  serveProductImage(@Param('folder') folder: string, @Param('filename') filename: string): StreamableFile {
    const { filePath, mimetype } = this.productConfigService.resolveProductImagePath(folder, filename);
    return new StreamableFile(createReadStream(filePath), { type: mimetype });
  }

  @Post()
  @Auth([RoleType.Admin, RoleType.Manager, RoleType.Support])
  @ApiOperation({ summary: 'Create product config' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CreateProductConfigResDto })
  async createProductConfig(@Body() dto: CreateProductConfigDto): Promise<CreateProductConfigResDto> {
    return { success: true, data: await this.productConfigService.createProductConfig(dto) };
  }

  @Patch(':id')
  @Auth([RoleType.Admin, RoleType.Manager, RoleType.Support])
  @ApiOperation({ summary: 'Update product config' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UpdateProductConfigResDto })
  async updateProductConfig(
    @Param('id') id: string,
    @Body() dto: UpdateProductConfigDto,
  ): Promise<UpdateProductConfigResDto> {
    return { success: true, data: await this.productConfigService.updateProductConfig(id, dto) };
  }

  @Delete(':id')
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Delete product config' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ResDto })
  async deleteProductConfig(@Param('id') id: string): Promise<ResDto> {
    await this.productConfigService.deleteProductConfig(id);
    return { success: true };
  }

  @Post('import')
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Bulk import product configs from parsed Excel rows' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ImportProductConfigResDto })
  async importProductConfigs(@Body() dto: ImportProductConfigDto): Promise<ImportProductConfigResDto> {
    return this.productConfigService.importProductConfigs(dto);
  }

  @Post('import-full')
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Bulk import FULL products (catalog + variations) from parsed Excel rows' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ImportFullProductsResDto })
  async importFullProducts(@Body() dto: ImportFullProductsDto): Promise<ImportFullProductsResDto> {
    return this.productConfigService.importFullProducts(dto);
  }

  @Post('import-from-onospod')
  @Auth([RoleType.Admin])
  @ApiOperation({
    summary:
      'Import TẤT CẢ sản phẩm từ OnosPod (GraphQL productPreset) — theo trang, FE gọi lặp đến khi nextPage null; fill-only, KHÔNG đè field đã có',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ImportFromOnospodResDto })
  async importFromOnospod(@Body() dto: ImportFromOnospodDto): Promise<ImportFromOnospodResDto> {
    return this.onospodProductImportService.importFromOnospod(dto);
  }

  @Post('onospod-factory-sync')
  @Auth([RoleType.Admin])
  @ApiOperation({
    summary:
      'Đồng bộ XƯỞNG sản phẩm theo app OnosPod 1 lượt (Products.md §2.7a) — dryRun=true (mặc định) xem trước + trả planToken; dryRun=false + planToken áp dụng đúng kế hoạch đó (env phải là on)',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SyncOnospodFactoryResDto })
  async syncOnospodFactory(
    @Body() dto: SyncOnospodFactoryDto,
    @AuthUser() user: UserDocument,
  ): Promise<SyncOnospodFactoryResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: '/product-configs/onospod-factory-sync', userId: user._id, dryRun: dto.dryRun, force: dto.force }),
    });
    const userId = String(user._id);
    return {
      success: true,
      data: dto.dryRun
        ? await this.onospodFactorySyncService.preview(userId)
        : await this.onospodFactorySyncService.apply(dto.planToken, userId, dto.force),
    };
  }

  @Get('onospod-factory-sync/last-run')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Kết quả lượt đồng bộ xưởng theo OnosPod gần nhất (tự động hoặc chạy tay)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetOnospodFactorySyncLastRunResDto })
  async getOnospodFactorySyncLastRun(@AuthUser() user: UserDocument): Promise<GetOnospodFactorySyncLastRunResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/product-configs/onospod-factory-sync/last-run', userId: user._id }),
    });
    return { success: true, data: await this.onospodFactorySyncService.getLastRun() };
  }

  @Get('onospod-factory-sync/last-write')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Lượt đồng bộ xưởng theo OnosPod GHI THẬT gần nhất (không bị lượt 0 thay đổi đè)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetOnospodFactorySyncLastRunResDto })
  async getOnospodFactorySyncLastWrite(@AuthUser() user: UserDocument): Promise<GetOnospodFactorySyncLastRunResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/product-configs/onospod-factory-sync/last-write', userId: user._id }),
    });
    return { success: true, data: await this.onospodFactorySyncService.getLastWrite() };
  }

  @Post('crawl-mockups')
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({
    summary: 'Crawl ảnh mockup từ onospod.com cho sản phẩm chưa có ảnh — theo lô, FE gọi lặp với cursor đến khi done',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CrawlProductMockupsResDto })
  async crawlProductMockups(@Body() dto: CrawlProductMockupsDto): Promise<CrawlProductMockupsResDto> {
    return { success: true, data: await this.productConfigService.crawlMockups(dto.limit, dto.cursor) };
  }

  @Post('crawl-page-info')
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({
    summary:
      'Crawl "Import US Tax" + "Package gram" từ trang sản phẩm public hệ cũ (onospod.com/product/{slug}) — theo lô cursor, FE gọi lặp đến done',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CrawlPageInfoResDto })
  async crawlPageInfo(@Body() dto: CrawlPageInfoDto): Promise<CrawlPageInfoResDto> {
    return { success: true, data: await this.productConfigService.crawlPageInfo(dto.limit, dto.cursor) };
  }

  @Post('upload-image')
  // Support cần upload mockup/size-chart khi tạo/sửa sản phẩm (MockupImagesEditor).
  @Auth([RoleType.Admin, RoleType.Manager, RoleType.Support])
  @ApiOperation({ summary: 'Upload mockup/size-chart image (lưu local disk, KHÔNG qua S3/Backblaze)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UploadProductImageResDto })
  @ApiFile({ name: 'file' })
  async uploadProductImage(
    @Body() dto: UploadProductImageDto,
    @UploadedFile() file: IFile,
    @Req() req: FastifyRequest,
  ): Promise<UploadProductImageResDto> {
    const origin = `${req.protocol}://${req.headers.host}`;
    const url = await this.productConfigService.uploadProductImage(dto.type, file, origin);
    return { success: true, data: { url } };
  }

  @Delete('all')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Hard-delete every product config (start fresh)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ResDto })
  async clearAll(): Promise<ResDto> {
    const data = await this.productConfigService.clearAll();
    return { success: true, data };
  }
}
