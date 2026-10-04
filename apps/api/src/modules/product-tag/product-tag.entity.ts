import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { assertSameType, DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';
import type { ProductTag } from 'shared';

@DatabaseEntity({ collection: 'productTags' })
export class ProductTagEntity extends DatabaseEntityAbstract {
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

assertSameType<ProductTag, ProductTagEntity>();
assertSameType<ProductTagEntity, ProductTag>();

export const ProductTagSchema = SchemaFactory.createForClass(ProductTagEntity);
export type ProductTagDocument = HydratedDocument<ProductTagEntity>;
