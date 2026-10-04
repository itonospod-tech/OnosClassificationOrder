import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DatabaseRepositoryAbstract } from 'core';
import { Model } from 'mongoose';

import type { ProductTagDocument } from './product-tag.entity';
import { ProductTagEntity } from './product-tag.entity';

@Injectable()
export class ProductTagRepository extends DatabaseRepositoryAbstract<ProductTagEntity, ProductTagDocument> {
  constructor(@InjectModel(ProductTagEntity.name) private readonly productTagModel: Model<ProductTagEntity>) {
    super(productTagModel);
  }
}
