import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { assertSameType, DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';
import type { ProductTechnique } from 'shared';

@DatabaseEntity({ collection: 'productTechniques' })
export class ProductTechniqueEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, uppercase: true, unique: true, index: true })
  shortName: string;

  /** Badge/cover image (URL). */
  @Prop({ trim: true })
  image?: string;

  @Prop({ trim: true })
  description?: string;

  /** Display order (ascending). */
  @Prop({ required: true, default: 0 })
  sortOrder: number;

  @Prop({ required: true, default: true })
  isActive: boolean;
}

assertSameType<ProductTechnique, ProductTechniqueEntity>();
assertSameType<ProductTechniqueEntity, ProductTechnique>();

export const ProductTechniqueSchema = SchemaFactory.createForClass(ProductTechniqueEntity);
export type ProductTechniqueDocument = HydratedDocument<ProductTechniqueEntity>;
