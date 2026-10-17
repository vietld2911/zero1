export type AppKey = 'crm' | 'lms';

export interface AppMeta {
  key: AppKey;
  /** Tên ngắn: "CRM" / "LMS". */
  name: string;
  tagline: string;
  /** Một câu giới thiệu ở màn đăng nhập. */
  pitch: string;
}

export const APP_URLS: Record<AppKey, string> = {
  crm: import.meta.env.VITE_CRM_URL ?? 'http://localhost:5173',
  lms: import.meta.env.VITE_LMS_URL ?? 'http://localhost:5174',
};

export const otherApp = (key: AppKey): AppKey => (key === 'crm' ? 'lms' : 'crm');
