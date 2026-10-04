import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { BaseEntityZod, PageQueryZod, PageResZod, ResZod } from '@shared/types';
import { z } from 'zod';

import { BooleanFlagZod } from '../constants/common-zod';

/**
 * Product tag (flat marketing label — e.g. "Christmas", "Bestsellers").
 * Differs from ProductCategory (structural, multi-level) and Collection (catalog set):
 * a product carries MANY tags (`ProductConfig.productTagIds`). Same module pattern as `collection.dto.ts`.
 */
export const ProductTagZod = BaseEntityZod.extend({
  name: z.string().min(1).max(120),
  shortName: z.string().min(1).max(30),
  /** Badge/cover image (URL). */
  image: z.string().max(1000).optional(),
  description: z.string().max(2000).optional(),
  /** Display order (ascending). */
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type ProductTag = z.infer<typeof ProductTagZod>;

//
export const GetProductTagsZod = PageQueryZod.extend({
  /** Three-state flag: `false` means "only inactive", not "filter off" — see `BooleanFlagZod`. */
  isActive: BooleanFlagZod,
});
export class GetProductTagsDto extends createZodDto(extendApi(GetProductTagsZod)) {}

export const GetProductTagsResZod = PageResZod.extend({ data: ProductTagZod.array() });
export class GetProductTagsResDto extends createZodDto(extendApi(GetProductTagsResZod)) {}

//
export const CreateProductTagZod = z.object({
  name: ProductTagZod.shape.name,
  shortName: ProductTagZod.shape.shortName,
  image: ProductTagZod.shape.image,
  description: ProductTagZod.shape.description,
  sortOrder: ProductTagZod.shape.sortOrder.optional(),
  isActive: ProductTagZod.shape.isActive.optional(),
});
export class CreateProductTagDto extends createZodDto(extendApi(CreateProductTagZod)) {}

export const CreateProductTagResZod = ResZod.extend({ data: ProductTagZod });
export class CreateProductTagResDto extends createZodDto(extendApi(CreateProductTagResZod)) {}

//
export const UpdateProductTagZod = z.object({
  name: ProductTagZod.shape.name.optional(),
  shortName: ProductTagZod.shape.shortName.optional(),
  image: ProductTagZod.shape.image,
  description: ProductTagZod.shape.description,
  sortOrder: ProductTagZod.shape.sortOrder.optional(),
  isActive: ProductTagZod.shape.isActive.optional(),
});
export class UpdateProductTagDto extends createZodDto(extendApi(UpdateProductTagZod)) {}

export const UpdateProductTagResZod = ResZod.extend({ data: ProductTagZod });
export class UpdateProductTagResDto extends createZodDto(extendApi(UpdateProductTagResZod)) {}
