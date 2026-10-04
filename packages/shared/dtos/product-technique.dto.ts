import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { BaseEntityZod, PageQueryZod, PageResZod, ResZod } from '@shared/types';
import { z } from 'zod';

import { BooleanFlagZod } from '../constants/common-zod';

/**
 * Product technique (flat marketing label — e.g. "Christmas", "Bestsellers").
 * Differs from ProductCategory (structural, multi-level) and Collection (catalog set):
 * a product carries MANY tags (`ProductConfig.productTechniqueIds`). Same module pattern as `collection.dto.ts`.
 */
export const ProductTechniqueZod = BaseEntityZod.extend({
  name: z.string().min(1).max(120),
  shortName: z.string().min(1).max(30),
  /** Badge/cover image (URL). */
  image: z.string().max(1000).optional(),
  description: z.string().max(2000).optional(),
  /** Display order (ascending). */
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type ProductTechnique = z.infer<typeof ProductTechniqueZod>;

//
export const GetProductTechniquesZod = PageQueryZod.extend({
  /** Three-state flag: `false` means "only inactive", not "filter off" — see `BooleanFlagZod`. */
  isActive: BooleanFlagZod,
});
export class GetProductTechniquesDto extends createZodDto(extendApi(GetProductTechniquesZod)) {}

export const GetProductTechniquesResZod = PageResZod.extend({ data: ProductTechniqueZod.array() });
export class GetProductTechniquesResDto extends createZodDto(extendApi(GetProductTechniquesResZod)) {}

//
export const CreateProductTechniqueZod = z.object({
  name: ProductTechniqueZod.shape.name,
  shortName: ProductTechniqueZod.shape.shortName,
  image: ProductTechniqueZod.shape.image,
  description: ProductTechniqueZod.shape.description,
  sortOrder: ProductTechniqueZod.shape.sortOrder.optional(),
  isActive: ProductTechniqueZod.shape.isActive.optional(),
});
export class CreateProductTechniqueDto extends createZodDto(extendApi(CreateProductTechniqueZod)) {}

export const CreateProductTechniqueResZod = ResZod.extend({ data: ProductTechniqueZod });
export class CreateProductTechniqueResDto extends createZodDto(extendApi(CreateProductTechniqueResZod)) {}

//
export const UpdateProductTechniqueZod = z.object({
  name: ProductTechniqueZod.shape.name.optional(),
  shortName: ProductTechniqueZod.shape.shortName.optional(),
  image: ProductTechniqueZod.shape.image,
  description: ProductTechniqueZod.shape.description,
  sortOrder: ProductTechniqueZod.shape.sortOrder.optional(),
  isActive: ProductTechniqueZod.shape.isActive.optional(),
});
export class UpdateProductTechniqueDto extends createZodDto(extendApi(UpdateProductTechniqueZod)) {}

export const UpdateProductTechniqueResZod = ResZod.extend({ data: ProductTechniqueZod });
export class UpdateProductTechniqueResDto extends createZodDto(extendApi(UpdateProductTechniqueResZod)) {}
