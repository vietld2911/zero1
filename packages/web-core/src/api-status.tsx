import { useQuery } from '@tanstack/react-query';
import { cn } from '@zero1/ui';
import { useApi } from './api';

/** Trạng thái máy chủ ở chân sidebar — gọi GET /api/v1/health qua client sinh từ OpenAPI. */
export function ApiStatus() {
  const api = useApi();
  const { data, isPending, isError } = useQuery({
    queryKey: ['system', 'health'],
    // /health trả 503 kèm body khi DB lỗi — vẫn đọc body thay vì coi là lỗi mạng.
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/health');
      if (data) return data.data;
      if (error && 'data' in error) return error.data;
      throw new Error('Máy chủ không phản hồi');
    },
    refetchInterval: 60_000,
  });

  const healthy = data?.status === 'ok';
  const label = isPending
    ? 'Đang kiểm tra máy chủ…'
    : isError || !data
      ? 'Không kết nối được máy chủ'
      : healthy
        ? `Máy chủ hoạt động · v${data.version}`
        : 'Máy chủ gặp sự cố';

  return (
    <div className="flex items-center gap-2 text-navy-300" role="status">
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          isPending ? 'bg-navy-400' : healthy ? 'bg-lime-brand' : 'bg-danger',
        )}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </div>
  );
}
