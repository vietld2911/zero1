import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, FileDown, MoreHorizontal, PackageCheck, QrCode, Undo2, Wallet, XCircle } from 'lucide-react';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import {
  Alert,
  BackLink,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Dialog,
  DropdownMenu,
  Field,
  Input,
  MoneyInput,
  PageHeader,
  Progress,
  Select,
  Spinner,
  Stat,
  Textarea,
  toast,
  type Column,
} from '@zero1/ui';
import { errorMessage, formatDate, formatDateTime, formatMoney, fromVnInput, toastError, toVnInput, useApi, useDownload, usePermission } from '@zero1/web-core';
import { APPROVAL_STATUS, crmKeys, ENROLLMENT_STATUS, GIFT_STATUS, PAYMENT_METHODS, PAYMENT_STATE, PAYMENT_STATUS } from '../labels';

type Enrollment = Schemas['EnrollmentDetail'];
type Payment = Schemas['Payment'];

export default function EnrollmentDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const download = useDownload();
  const canCreate = usePermission('crm.enrollments.create');
  const canConfirm = usePermission('crm.payments.confirm');
  const canCancel = usePermission('crm.students.status');
  const canGifts = usePermission('crm.students.write');
  const [dialog, setDialog] = useState<'pay' | 'qr' | 'cancel' | null>(null);
  const [cancelPayment, setCancelPayment] = useState<Payment | null>(null);

  const { data: e, error } = useQuery({
    queryKey: crmKeys.enrollment(id),
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/enrollments/{id}', { params: { path: { id } } }))).data,
  });
  const invalidate = () => {
    for (const key of [crmKeys.enrollments, crmKeys.students, crmKeys.reports, crmKeys.renewals]) void qc.invalidateQueries({ queryKey: key });
  };
  const confirm = useMutation({
    mutationFn: async (paymentId: string) => unwrap(api.POST('/api/v1/crm/payments/{id}/confirm', { params: { path: { id: paymentId } } })),
    onSuccess: () => (toast.success('Đã xác nhận khoản thu'), invalidate()),
    onError: toastError,
  });
  const gift = useMutation({
    mutationFn: async ({ giftId, status }: { giftId: string; status: 'DELIVERED' | 'RETURNED' }) =>
      unwrap(api.POST('/api/v1/crm/enrollment-gifts/{id}/status', { params: { path: { id: giftId } }, body: { status } })),
    onSuccess: () => (toast.success('Đã cập nhật quà tặng'), invalidate()),
    onError: toastError,
  });

  if (error) return <Alert tone="danger">Không tìm thấy đăng ký hoặc bạn không có quyền xem.</Alert>;
  if (!e) return <Spinner label="Đang tải…" />;

  const open = e.status !== 'CANCELLED';
  const pending = e.payments.filter((p) => p.status === 'PENDING').reduce((n, p) => n + p.amount, 0);
  const paidPct = e.amountDue ? (e.amountPaid / e.amountDue) * 100 : 100;

  const paymentColumns: Column<Payment>[] = [
    {
      key: 'amount',
      header: 'Số tiền',
      cell: (p) => (
        <div>
          <div className={`font-medium tabular-nums ${p.status === 'CANCELLED' ? 'line-through opacity-60' : ''}`}>{formatMoney(p.amount)}</div>
          <div className="text-xs text-muted-foreground">
            {PAYMENT_METHODS[p.method]}
            {p.reference && ` · ${p.reference}`}
          </div>
        </div>
      ),
    },
    { key: 'status', header: 'Trạng thái', cell: (p) => <Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge> },
    {
      key: 'who',
      header: 'Ghi / xác nhận',
      className: 'hidden md:table-cell',
      cell: (p) => (
        <div className="text-xs">
          <div>
            {formatDateTime(p.paidAt)} · {p.recordedByName ?? '—'}
          </div>
          {p.confirmedByName && <div className="text-muted-foreground">Xác nhận: {p.confirmedByName}</div>}
          {p.note && <div className="text-muted-foreground italic">{p.note}</div>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Thao tác</span>,
      align: 'right',
      cell: (p) =>
        p.status === 'CANCELLED' ? null : (
          <div className="flex justify-end gap-1">
            {p.status === 'PENDING' && canConfirm && (
              <Button size="sm" onClick={() => confirm.mutate(p.id)} disabled={confirm.isPending}>
                <CheckCircle2 /> Xác nhận
              </Button>
            )}
            {canCreate && (
              <DropdownMenu
                trigger={
                  <Button variant="ghost" size="icon" aria-label="Thao tác khoản thu">
                    <MoreHorizontal />
                  </Button>
                }
                actions={[{ label: 'Huỷ khoản thu', icon: XCircle, tone: 'danger', onSelect: () => setCancelPayment(p) }]}
              />
            )}
          </div>
        ),
    },
  ];

  return (
    <>
      <BackLink to="/enrollments" label="Đăng ký & thu tiền" />
      <PageHeader
        title={`${e.code} — ${e.studentName}`}
        description={`${e.packageName} · ${e.type === 'RENEWAL' ? 'Tái phí' : 'Đăng ký mới'} · Sale ${e.saleName ?? '—'}`}
        actions={
          <>
            <Button variant="outline" onClick={() => download(`/api/v1/crm/enrollments/${e.id}/form.docx`, `phieu-dang-ky-${e.code}.docx`).catch(toastError)}>
              <FileDown /> Phiếu đăng ký
            </Button>
            {open && e.balance > 0 && (
              <Button variant="outline" onClick={() => setDialog('qr')}>
                <QrCode /> Mã QR
              </Button>
            )}
            {open && canCreate && (
              <Button onClick={() => setDialog('pay')}>
                <Wallet /> Ghi khoản thu
              </Button>
            )}
            {open && canCancel && (
              <DropdownMenu
                trigger={
                  <Button variant="outline" size="icon" aria-label="Thao tác khác">
                    <MoreHorizontal />
                  </Button>
                }
                actions={[{ label: 'Huỷ đăng ký', icon: Ban, tone: 'danger', onSelect: () => setDialog('cancel') }]}
              />
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={ENROLLMENT_STATUS[e.status].tone}>{ENROLLMENT_STATUS[e.status].label}</Badge>
        <Badge tone={PAYMENT_STATE[e.paymentState].tone}>{PAYMENT_STATE[e.paymentState].label}</Badge>
        {e.approvalStatus !== 'NONE' && <Badge tone={APPROVAL_STATUS[e.approvalStatus].tone}>{APPROVAL_STATUS[e.approvalStatus].label}</Badge>}
        <Link to={`/students/${e.studentId}`} className="text-sm text-info hover:underline">
          Hồ sơ học viên {e.studentCode}
        </Link>
      </div>

      {e.status === 'CANCELLED' && e.cancelReason && (
        <Alert tone="danger" className="mb-4" title="Đăng ký đã huỷ">
          {e.cancelReason}
        </Alert>
      )}
      {e.status === 'AWAITING_PAYMENT' && (
        <Alert tone="info" className="mb-4">
          Chờ khoản thu đầu tiên được xác nhận để kích hoạt — sau đó học viên xuất hiện ở LMS “Chờ xếp lớp”.
        </Alert>
      )}
      {e.paymentState === 'OVERPAID' && (
        <Alert tone="warning" className="mb-4" title={`Thu dư ${formatMoney(-e.balance)}`}>
          Số phải thu giảm sau khi duyệt. Hoàn lại cho phụ huynh hoặc chuyển sang đăng ký sau.
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Phải thu" value={formatMoney(e.amountDue)} />
        <Stat
          label="Đã thu"
          value={formatMoney(e.amountPaid)}
          tone="success"
          hint={
            <>
              <Progress value={paidPct} tone="success" className="mt-1" label="Tỉ lệ đã thu" />
              {pending > 0 && <span className="mt-1 block">Chờ xác nhận {formatMoney(pending)}</span>}
            </>
          }
        />
        <Stat label="Còn lại" value={formatMoney(Math.max(0, e.balance))} tone={e.balance > 0 ? 'danger' : 'default'} />
        <Stat
          label="Buổi học"
          value={`${e.sessionsUsed}/${e.sessionsPurchased}`}
          hint={
            <>
              <Progress value={e.sessionsPurchased ? (e.sessionsUsed / e.sessionsPurchased) * 100 : 0} className="mt-1" label="Tiến độ buổi học" />
              <span className="mt-1 block">Còn {e.sessionsRemaining} buổi</span>
            </>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-2 font-semibold">Khoản thu</h2>
            <DataTable columns={paymentColumns} rows={e.payments} rowKey={(p) => p.id} empty="Chưa có khoản thu" />
          </section>
          {e.gifts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Quà tặng</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-border">
                  {e.gifts.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div>
                        <span className="font-medium">
                          {g.itemName} × {g.quantity} {g.unit}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">{g.deliveryCondition === 'ON_PAID' ? 'Giao khi đóng tiền' : 'Giao ngay'}</span>
                        {g.deliveredAt && <span className="ml-2 text-xs text-muted-foreground">· {formatDateTime(g.deliveredAt)}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={GIFT_STATUS[g.status].tone}>{GIFT_STATUS[g.status].label}</Badge>
                        {canGifts && g.status === 'PENDING' && (
                          <Button size="sm" variant="outline" onClick={() => gift.mutate({ giftId: g.id, status: 'DELIVERED' })} disabled={gift.isPending}>
                            <PackageCheck /> Đã giao
                          </Button>
                        )}
                        {canGifts && g.status === 'DELIVERED' && (
                          <Button size="sm" variant="ghost" onClick={() => gift.mutate({ giftId: g.id, status: 'RETURNED' })} disabled={gift.isPending}>
                            <Undo2 /> Thu hồi
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <PriceCard e={e} />
          <Card>
            <CardHeader>
              <CardTitle>Thời hạn</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Cấp độ bắt đầu</span>
                <span>{e.startLevelName}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Hiệu lực</span>
                <span>
                  {formatDate(e.startDate)} – {formatDate(e.endDate)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Kích hoạt</span>
                <span>{e.activatedAt ? formatDateTime(e.activatedAt) : '—'}</span>
              </div>
              {e.note && <p className="mt-2 border-t border-border pt-2">{e.note}</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      {dialog === 'pay' && <PaymentDialog e={e} pending={pending} onClose={() => setDialog(null)} onDone={invalidate} />}
      {dialog === 'qr' && <QrDialog e={e} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && (
        <ReasonDialog
          title="Huỷ đăng ký"
          description="Học viên bị rời lớp bên LMS, quà chưa giao bị huỷ. Khoản đã thu cần xử lý hoàn phí riêng."
          confirmLabel="Huỷ đăng ký"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await unwrap(api.POST('/api/v1/crm/enrollments/{id}/cancel', { params: { path: { id: e.id } }, body: { reason } }));
            toast.success('Đã huỷ đăng ký');
            invalidate();
          }}
        />
      )}
      {cancelPayment && (
        <ReasonDialog
          title={`Huỷ khoản thu ${formatMoney(cancelPayment.amount)}`}
          confirmLabel="Huỷ khoản thu"
          onClose={() => setCancelPayment(null)}
          onConfirm={async (reason) => {
            await unwrap(api.POST('/api/v1/crm/payments/{id}/cancel', { params: { path: { id: cancelPayment.id } }, body: { reason } }));
            toast.success('Đã huỷ khoản thu');
            invalidate();
          }}
        />
      )}
    </>
  );
}

function PriceRow({ label, value, tone }: { label: string; value: string; tone?: 'minus' | 'strong' | 'muted' }) {
  return (
    <div className={`flex justify-between gap-3 py-1 text-sm ${tone === 'strong' ? 'mt-1 border-t border-border pt-2 text-base font-semibold' : ''}`}>
      <span className={tone === 'strong' ? '' : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${tone === 'minus' ? 'text-success' : tone === 'muted' ? 'text-muted-foreground line-through' : ''}`}>{value}</span>
    </div>
  );
}

function PriceCard({ e }: { e: Enrollment }) {
  const approval = e.approval;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Học phí đã chốt</CardTitle>
      </CardHeader>
      <CardContent>
        <PriceRow label="Giá niêm yết" value={formatMoney(e.listPrice)} />
        {e.promotionDiscount > 0 && <PriceRow label={`Khuyến mại ${e.promotionCode ?? ''}`} value={`−${formatMoney(e.promotionDiscount)}`} tone="minus" />}
        {e.extraDiscountApplied > 0 && <PriceRow label="Giảm thêm (đã duyệt)" value={`−${formatMoney(e.extraDiscountApplied)}`} tone="minus" />}
        {e.extraDiscountRequested > 0 && e.extraDiscountApplied === 0 && (
          <PriceRow label={`Giảm thêm (${e.approvalStatus === 'REJECTED' ? 'bị từ chối' : 'chờ duyệt'})`} value={formatMoney(e.extraDiscountRequested)} tone="muted" />
        )}
        <PriceRow label="Phải thu" value={formatMoney(e.amountDue)} tone="strong" />
        <p className="mt-2 text-sm text-muted-foreground">
          Học bổng {e.scholarshipMonthsGranted} tháng
          {e.scholarshipMonthsRequested > e.scholarshipMonthsGranted && ` (xin ${e.scholarshipMonthsRequested})`} · {e.sessionsPurchased} buổi
        </p>
        {e.extraDiscountReason && <p className="mt-1 text-sm">Lý do giảm: {e.extraDiscountReason}</p>}
        {approval && (
          <Alert tone={approval.status === 'PENDING' ? 'warning' : approval.status === 'APPROVED' ? 'success' : 'danger'} className="mt-3" title={`${APPROVAL_STATUS[approval.status].label} · ${approval.approverRole} duyệt`}>
            Giá trị ưu đãi {formatMoney(approval.value)} · Người xin {approval.requestedByName ?? '—'}
            {approval.reviewedByName && (
              <span className="block">
                {approval.reviewedByName}: {approval.reviewNote ?? 'không ghi chú'}
              </span>
            )}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function PaymentDialog({ e, pending, onClose, onDone }: { e: Enrollment; pending: number; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const canConfirm = usePermission('crm.payments.confirm');
  const max = Math.max(0, e.balance - pending);
  const [amount, setAmount] = useState<number | null>(max || null);
  const [method, setMethod] = useState<keyof typeof PAYMENT_METHODS>('TRANSFER');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [paidAt, setPaidAt] = useState(() => toVnInput(new Date().toISOString()));
  const [maxPaidAt] = useState(() => toVnInput(new Date(Date.now() + 5 * 60_000).toISOString()));
  const [idemKey] = useState(() => crypto.randomUUID());
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        api.POST('/api/v1/crm/enrollments/{id}/payments', {
          params: { path: { id: e.id } },
          headers: { 'Idempotency-Key': idemKey },
          body: { amount: amount!, method, reference: reference.trim() || null, note: note.trim() || null, paidAt: paidAt ? fromVnInput(paidAt) : undefined },
        }),
      ),
    onSuccess: () => {
      toast.success(canConfirm ? 'Đã ghi và xác nhận khoản thu' : 'Đã ghi khoản thu — chờ CS / CM xác nhận');
      onDone();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? errorMessage(err) : 'Không ghi được khoản thu'),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Ghi khoản thu"
      description={`Còn phải thu ${formatMoney(Math.max(0, e.balance))}${pending ? `, trong đó ${formatMoney(pending)} đang chờ xác nhận` : ''}.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            onClick={() => {
              if (submitting.current) return;
              submitting.current = true;
              setError(null);
              save.mutate(undefined, { onSettled: () => (submitting.current = false) });
            }}
            disabled={!amount || save.isPending}
          >
            Ghi nhận
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
        <Field label="Số tiền" required className="sm:col-span-2" hint={max ? `Tối đa ${formatMoney(max)}` : 'Đã thu đủ'}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Hình thức">
          <Select value={method} onChange={(ev) => setMethod(ev.target.value as typeof method)}>
            {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Thời gian thu">
          <Input type="datetime-local" value={paidAt} max={maxPaidAt} onChange={(ev) => setPaidAt(ev.target.value)} />
        </Field>
        <Field label="Mã giao dịch / số biên lai" className="sm:col-span-2">
          <Input value={reference} onChange={(ev) => setReference(ev.target.value)} />
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} />
        </Field>
        {!canConfirm && <p className="text-sm text-muted-foreground sm:col-span-2">Khoản thu cần CS / CM xác nhận đã nhận tiền.</p>}
      </div>
    </Dialog>
  );
}

function QrDialog({ e, onClose }: { e: Enrollment; onClose: () => void }) {
  const api = useApi();
  const [amount, setAmount] = useState<number | null>(Math.max(0, e.balance));
  const { data, error, isFetching } = useQuery({
    queryKey: ['crm', 'payment-qr', e.id, amount],
    enabled: !!amount,
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/enrollments/{id}/payment-qr', { params: { path: { id: e.id }, query: { amount: amount ?? undefined } } }))).data,
    retry: false,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Chuyển khoản qua mã QR" description="Phụ huynh quét bằng app ngân hàng — số tiền và nội dung điền sẵn.">
      <div className="flex flex-col items-center gap-4">
        <Field label="Số tiền" className="w-full">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        {error ? (
          <Alert tone="warning" className="w-full">
            {errorMessage(error)}
          </Alert>
        ) : data ? (
          <>
            <img src={data.imageUrl} alt="Mã VietQR" className={`size-64 rounded-lg border border-border ${isFetching ? 'opacity-50' : ''}`} />
            <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Ngân hàng</dt>
              <dd>{data.bankName}</dd>
              <dt className="text-muted-foreground">Số tài khoản</dt>
              <dd className="font-mono">{data.accountNo}</dd>
              <dt className="text-muted-foreground">Chủ tài khoản</dt>
              <dd>{data.accountName}</dd>
              <dt className="text-muted-foreground">Số tiền</dt>
              <dd className="font-semibold">{formatMoney(data.amount)}</dd>
              <dt className="text-muted-foreground">Nội dung</dt>
              <dd className="font-mono">{data.content}</dd>
            </dl>
          </>
        ) : (
          <Spinner />
        )}
      </div>
    </Dialog>
  );
}

function ReasonDialog({
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const run = useMutation({ mutationFn: () => onConfirm(reason.trim()), onSuccess: onClose, onError: toastError });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 3 || run.isPending} onClick={() => run.mutate()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label="Lý do" required>
        <Textarea rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
      </Field>
    </Dialog>
  );
}
