import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Badge, Button, Checkbox, Dialog, Spinner, toast } from '@zero1/ui';
import { errorMessage, formatDate, useApi } from '@zero1/web-core';
import { lmsKeys, teachingKeys } from '../labels';

type ClassDetail = Schemas['ClassDetail'];

/** Xếp học viên đang chờ (cùng môn, cùng chi nhánh) vào lớp. Học viên đúng cấp độ của lớp lên đầu. */
export function PlaceDialog({ cls, onClose }: { cls: ClassDetail; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const { data, isPending } = useQuery({
    queryKey: [...lmsKeys.placement, cls.branchId],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/placement', { params: { query: { branchId: cls.branchId } } }))).data,
  });
  const candidates = (data ?? [])
    .filter((w) => w.subjectId === cls.subjectId)
    .sort((a, b) => Number(b.startLevelId === cls.levelId) - Number(a.startLevelId === cls.levelId) || a.waitingSince.localeCompare(b.waitingSince));
  const seats = cls.capacity - cls.learners.filter((l) => l.status === 'ACTIVE').length;

  const place = useMutation({
    mutationFn: async () => {
      const failed: string[] = [];
      let ok = 0;
      for (const w of candidates.filter((c) => selected.has(c.enrollmentId))) {
        try {
          await unwrap(api.POST('/api/v1/lms/classes/{id}/learners', { params: { path: { id: cls.id } }, body: { learnerId: w.learnerId, enrollmentId: w.enrollmentId } }));
          ok++;
        } catch (err) {
          failed.push(`${w.fullName}: ${err instanceof ApiError ? errorMessage(err) : 'lỗi'}`);
        }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      teachingKeys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      if (ok) toast.success(`Đã xếp ${ok} học viên vào ${cls.code}`);
      setErrors(failed);
      setSelected(new Set());
      if (!failed.length) onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Xếp học viên vào ${cls.code}`}
      description={`Còn ${Math.max(0, seats)} chỗ. Danh sách học viên đã đóng tiền môn ${cls.subjectName ?? ''}, chưa có lớp.`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button onClick={() => place.mutate()} disabled={!selected.size || selected.size > seats || place.isPending}>
            Xếp {selected.size || ''} học viên
          </Button>
        </>
      }
    >
      {errors.length > 0 && (
        <Alert tone="danger" className="mb-3" title="Một số học viên chưa xếp được">
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      {selected.size > seats && <Alert tone="warning" className="mb-3">Chọn nhiều hơn số chỗ còn lại ({seats}).</Alert>}
      {isPending ? (
        <Spinner label="Đang tải…" />
      ) : !candidates.length ? (
        <p className="text-sm text-muted-foreground">Không có học viên nào đang chờ xếp lớp môn này. Học viên có lớp rồi muốn chuyển lớp: mở hồ sơ học viên → “Chuyển lớp”.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {candidates.map((w) => (
            <li key={w.enrollmentId} className="flex items-center gap-3 px-3 py-2.5">
              <Checkbox
                aria-label={`Chọn ${w.fullName}`}
                checked={selected.has(w.enrollmentId)}
                onCheckedChange={(v) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (v) next.add(w.enrollmentId);
                    else next.delete(w.enrollmentId);
                    return next;
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{w.fullName}</div>
                <div className="text-xs text-muted-foreground">
                  {w.learnerCode} · {w.enrollmentCode} · chờ từ {formatDate(w.waitingSince)}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={w.startLevelId === cls.levelId ? 'success' : 'warning'}>{w.startLevelName}</Badge>
                <span className="text-xs text-muted-foreground">{w.sessionsRemaining} buổi</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
