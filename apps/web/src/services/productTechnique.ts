import type { CreateProductTechniqueDto, UpdateProductTechniqueDto } from 'shared';

import { callApi } from '../apis';
import { CONFIG } from '../constants';

const getProductTechniques = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/product-techniques${query}`, 'get');
};

const createProductTechnique = (data: CreateProductTechniqueDto) => {
  return callApi(`/${CONFIG.API_VERSION}/product-techniques`, 'post', data);
};

const updateProductTechnique = (id: string, data: UpdateProductTechniqueDto) => {
  return callApi(`/${CONFIG.API_VERSION}/product-techniques/${id}`, 'patch', data);
};

export const productTechnique = {
  getProductTechniques,
  createProductTechnique,
  updateProductTechnique,
};
