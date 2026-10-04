import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ProductTechniqueController } from './product-technique.controller';
import { ProductTechniqueEntity, ProductTechniqueSchema } from './product-technique.entity';
import { ProductTechniqueRepository } from './product-technique.repository';
import { ProductTechniqueService } from './product-technique.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: ProductTechniqueEntity.name, schema: ProductTechniqueSchema }])],
  controllers: [ProductTechniqueController],
  providers: [ProductTechniqueService, ProductTechniqueRepository],
  exports: [ProductTechniqueService, ProductTechniqueRepository],
})
export class ProductTechniqueModule {}
