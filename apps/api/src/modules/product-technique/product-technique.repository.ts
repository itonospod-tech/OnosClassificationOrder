import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DatabaseRepositoryAbstract } from 'core';
import { Model } from 'mongoose';

import type { ProductTechniqueDocument } from './product-technique.entity';
import { ProductTechniqueEntity } from './product-technique.entity';

@Injectable()
export class ProductTechniqueRepository extends DatabaseRepositoryAbstract<ProductTechniqueEntity, ProductTechniqueDocument> {
  constructor(@InjectModel(ProductTechniqueEntity.name) private readonly productTechniqueModel: Model<ProductTechniqueEntity>) {
    super(productTechniqueModel);
  }
}
