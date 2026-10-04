import type { CreateProductTagDto, UpdateProductTagDto } from 'shared';

import { callApi } from '../apis';
import { CONFIG } from '../constants';

const getProductTags = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/product-tags${query}`, 'get');
};

const createProductTag = (data: CreateProductTagDto) => {
  return callApi(`/${CONFIG.API_VERSION}/product-tags`, 'post', data);
};

const updateProductTag = (id: string, data: UpdateProductTagDto) => {
  return callApi(`/${CONFIG.API_VERSION}/product-tags/${id}`, 'patch', data);
};

export const productTag = {
  getProductTags,
  createProductTag,
  updateProductTag,
};
