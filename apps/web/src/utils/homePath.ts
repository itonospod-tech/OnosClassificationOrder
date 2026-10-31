import { PATHS } from '@/constants/paths';

/** Trang mặc định sau đăng nhập: sub-designer vào thẳng `/my-tasks`, các role khác vào dashboard. */
export const homePathForRole = (roleName?: string): string => (roleName === 'Designer' ? PATHS.MY_TASKS : PATHS.HOME);
