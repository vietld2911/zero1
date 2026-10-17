import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Badge, Button, Card, Dialog, Field, PageHeader, Segmented, Spinner, Textarea, toast } from '@zero1/ui';
import { formatDateTime, formatMoney, toastError, useApi } from '@zero1/web-core';
import { APPROVAL_STATUS, crmKeys } from '../labels';

type Approval = Schemas['DiscountApproval'];
type Filter = 'PENDING' | 'APPROVED' | 'REJECTED';

export default function ApprovalsPage() {
  const api = useApi();
  const [status, setStatus] = useState<Filter>('PENDING');
  const [reviewing, setReviewing] = useState<{ a: Approval; decision: 'approve' | 'reject' } | null>(null);
  const { data, isPending } = useQuery({
    queryKey: [...crmKeys.approvals, status],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/approvals', { params: { query: { status } } }))).data,
  });

  return (
    <>
      <PageHeader
        title="Duyệt giảm giá"
        description="Học bổng vượt mức và giảm thêm. CM duyệt trong hạn mức của chi nhánh, vượt hạn mức chuyển AM. Người xin không tự duyệt."
      />
      <Segmented
        aria-label="Trạng thái"
        className="mb-4"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'PENDING', label: 'Chờ duyệt', count: status === 'PENDING' ? data?.length : undefined },
          { value: 'APPROVED', label: 'Đã duyệt' },
          { value: 'REJECTED', label: 'Từ chối' },
        ]}
      />
      {isPending ? (
        <Spinner label="Đang tải…" />
      ) : !data?.length ? (
        <Card className="p-6 text-sm text-muted-foreground">{status === 'PENDING' ? 'Không có yêu cầu nào chờ duyệt.' : 'Không có yêu cầu.'}</Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/enrollments/${a.enrollmentId}`} className="font-medium hover:underline">
                    {a.studentName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {a.enrollmentCode} · {a.packageName}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={APPROVAL_STATUS[a.status].tone}>{APPROVAL_STATUS[a.status].label}</Badge>
                  <Badge tone={a.approverRole === 'AM' ? 'danger' : 'info'}>{a.approverRole} duyệt</Badge>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Giá gói</div>
                  <div className="tabular-nums">{formatMoney(a.listPrice)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Giảm thêm</div>
                  <div className="tabular-nums">{a.extraDiscount ? formatMoney(a.extraDiscount) : '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Học bổng thêm</div>
                  <div className="tabular-nums">{a.extraScholarshipMonths ? `${a.extraScholarshipMonths} tháng` : '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Tổng giá trị</div>
                  <div className="font-semibold tabular-nums">{formatMoney(a.value)}</div>
                </div>
              </div>
              {a.reason && <p className="mt-2 text-sm">Lý do: {a.reason}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {a.requestedByName ?? '—'} xin lúc {formatDateTime(a.createdAt)}
                {a.reviewedByName && ` · ${a.reviewedByName} xử lý lúc ${formatDateTime(a.reviewedAt)}${a.reviewNote ? `: ${a.reviewNote}` : ''}`}
              </p>
              {a.status === 'PENDING' &&
                (a.canReview ? (
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setReviewing({ a, decision: 'reject' })}>
                      <X /> Từ chối
                    </Button>
                    <Button onClick={() => setReviewing({ a, decision: 'approve' })}>
                      <Check /> Duyệt
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-right text-xs text-muted-foreground">Cần {a.approverRole} khác duyệt</p>
                ))}
            </Card>
          ))}
        </div>
      )}
      {reviewing && <ReviewDialog {...reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
}

function ReviewDialog({ a, decision, onClose }: { a: Approval; decision: 'approve' | 'reject'; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const run = useMutation({
    mutationFn: async () => {
      const opts = { params: { path: { id: a.id } }, body: { note: note.trim() || null } };
      if (decision === 'approve') await unwrap(api.POST('/api/v1/crm/approvals/{id}/approve', opts));
      else await unwrap(api.POST('/api/v1/crm/approvals/{id}/reject', opts));
    },
    onSuccess: () => {
      toast.success(decision === 'approve' ? 'Đã duyệt — học phí được tính lại' : 'Đã từ chối');
      void qc.invalidateQueries({ queryKey: crmKeys.approvals });
      void qc.invalidateQueries({ queryKey: crmKeys.enrollments });
      onClose();
    },
    onError: toastError,
  });
  const reject = decision === 'reject';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={reject ? 'Từ chối ưu đãi' : 'Duyệt ưu đãi'}
      description={`${a.studentName} · ${formatMoney(a.value)}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant={reject ? 'danger' : 'primary'} onClick={() => run.mutate()} disabled={(reject && note.trim().length < 3) || run.isPending}>
            {reject ? 'Từ chối' : 'Duyệt'}
          </Button>
        </>
      }
    >
      <Field label="Ghi chú" required={reject} hint={reject ? 'Sale sẽ thấy lý do' : undefined}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}
