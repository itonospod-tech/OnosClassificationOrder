import { agentApi } from './agentApi';
import { auth } from './auth';
import { cache } from './cache';
import { ceoDashboard } from './ceo';
import { collection } from './collection';
import { customRoles } from './custom-roles';
import { customer } from './customer';
import { customerAssignment } from './customerAssignment';
import { customerNotification } from './customerNotification';
import {
  customerApiAccess,
  customerAuth,
  customerCatalog,
  customerDesign,
  customerNotificationPortal,
  customerOrder,
} from './customerPortal';
import { departments } from './departments';
import { designer } from './designer';
import { designerAssignment } from './designerAssignment';
import { factory } from './factory';
import { fulfillment } from './fulfillment';
import { impersonate } from './impersonate';
import { inventory } from './inventory';
import { machineType } from './machineType';
import { notifications } from './notifications';
import { order } from './order';
import { productCategory } from './productCategory';
import { productConfig } from './productConfig';
import { promotion } from './promotion';
import { publicCatalog } from './publicCatalog';
import { publicTrack } from './publicTrack';
import { reports } from './reports';
import { roles } from './roles';
import { upload } from './upload';
import { users } from './users';
import { vnpShipping } from './vnpShipping';
import { workshopConfig } from './workshopConfig';
import { zaloChat } from './zaloChat';
import { zaloGroup } from './zaloGroup';

export const RepositoryRemote = {
  agentApi,
  ceoDashboard,
  auth,
  roles,
  upload,
  users,
  cache,
  departments,
  notifications,
  customRoles,
  factory,
  zaloChat,
  zaloGroup,
  impersonate,
  machineType,
  collection,
  productCategory,
  productConfig,
  order,
  workshopConfig,
  designer,
  designerAssignment,
  customer,
  customerAssignment,
  customerAuth,
  customerOrder,
  customerCatalog,
  customerDesign,
  customerApiAccess,
  publicCatalog,
  publicTrack,
  customerNotification,
  customerNotificationPortal,
  fulfillment,
  inventory,
  reports,
  promotion,
  vnpShipping,
};
