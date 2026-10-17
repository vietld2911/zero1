import { useCallback } from 'react';
import { ApiError } from '@zero1/api-client';
import { apiBaseUrl } from '../api';
import { useSession } from '../auth/auth-context';

/** Tải file cần đăng nhập (docx, xlsx…) và lưu về máy với tên gợi ý của server. */
export function useDownload() {
  const session = useSession();
  return useCallback(
    async (path: string, fallbackName: string) => {
      const token = await session.getAccessToken();
      const res = await fetch(`${apiBaseUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw new ApiError({ ...problem, status: res.status });
      }
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="?([^";]+)"?/i.exec(disposition);
      const name = match ? decodeURIComponent(match[1]!) : fallbackName;
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    [session],
  );
}
