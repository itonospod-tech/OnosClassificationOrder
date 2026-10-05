import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ProductTagController } from './product-tag.controller';
import { ProductTagEntity, ProductTagSchema } from './product-tag.entity';
import { ProductTagRepository } from './product-tag.repository';
import { ProductTagService } from './product-tag.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: ProductTagEntity.name, schema: ProductTagSchema }])],
  controllers: [ProductTagController],
  providers: [ProductTagService, ProductTagRepository],
  exports: [ProductTagService, ProductTagRepository],
})
export class ProductTagModule {}
