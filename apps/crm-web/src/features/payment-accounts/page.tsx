import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { unwrap, type ApiData } from '@zero1/api-client';
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Spinner, toast } from '@zero1/ui';
import { toastError, useApi, useBranches, type Branch } from '@zero1/web-core';
import { crmKeys } from '../labels';

type Accounts = ApiData<'/api/v1/crm/payment-accounts'>;
type Account = Accounts['accounts'][number];

export default function PaymentAccountsPage() {
  const api = useApi();
  const { data: branches = [] } = useBranches();
  const [editing, setEditing] = useState<Branch | null>(null);
  const { data, isPending } = useQuery({
    queryKey: crmKeys.paymentAccounts,
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/payment-accounts'))).data,
  });

  return (
    <>
      <PageHeader title="Tài khoản nhận tiền" description="Mỗi chi nhánh một tài khoản — nguồn duy nhất để tạo mã VietQR khi thu học phí." />
      {isPending ? (
        <Spinner label="Đang tải…" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {branches.map((b) => {
            const acc = data?.accounts.find((a) => a.branchId === b.id);
            return (
              <Card key={b.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{b.name}</div>
                  <Button variant="ghost" size="icon" aria-label={`Sửa tài khoản ${b.name}`} onClick={() => setEditing(b)}>
                    <Pencil />
                  </Button>
                </div>
                {acc ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-muted-foreground">Ngân hàng</dt>
                    <dd>{acc.bankName}</dd>
                    <dt className="text-muted-foreground">Số TK</dt>
                    <dd className="font-mono">{acc.accountNo}</dd>
                    <dt className="text-muted-foreground">Chủ TK</dt>
                    <dd>{acc.accountName}</dd>
                  </dl>
                ) : (
                  <Badge tone="warning" className="self-start">
                    Chưa có — không tạo được mã QR
                  </Badge>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {editing && data && <AccountDialog branch={editing} account={data.accounts.find((a) => a.branchId === editing.id) ?? null} banks={data.banks} onClose={() => setEditing(null)} />}
    </>
  );
}

function AccountDialog({ branch, account, banks, onClose }: { branch: Branch; account: Account | null; banks: Accounts['banks']; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [bankBin, setBankBin] = useState(account?.bankBin ?? '');
  const [accountNo, setAccountNo] = useState(account?.accountNo ?? '');
  const [accountName, setAccountName] = useState(account?.accountName ?? '');
  const save = useMutation({
    mutationFn: async (remove: boolean) =>
      unwrap(
        api.PATCH('/api/v1/crm/payment-accounts/{branchId}', {
          params: { path: { branchId: branch.id } },
          body: { account: remove ? null : { bankBin, accountNo: accountNo.trim(), accountName: accountName.trim() } },
        }),
      ),
    onSuccess: () => {
      toast.success('Đã lưu tài khoản');
      void qc.invalidateQueries({ queryKey: crmKeys.paymentAccounts });
      onClose();
    },
    onError: toastError,
  });
  const valid = bankBin && /^\d{6,20}$/.test(accountNo.trim()) && accountName.trim().length >= 3;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Tài khoản nhận tiền — ${branch.name}`}
      footer={
        <>
          {account && (
            <Button variant="ghost" className="text-danger sm:mr-auto" onClick={() => save.mutate(true)} disabled={save.isPending}>
              Gỡ tài khoản
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate(false)} disabled={!valid || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Ngân hàng" required>
          <Select value={bankBin} onChange={(e) => setBankBin(e.target.value)}>
            <option value="">— Chọn ngân hàng —</option>
            {banks.map((b) => (
              <option key={b.bin} value={b.bin}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Số tài khoản" required>
          <Input inputMode="numeric" className="font-mono" value={accountNo} onChange={(e) => setAccountNo(e.target.value.replace(/\s/g, ''))} />
        </Field>
        <Field label="Tên chủ tài khoản" required hint="Tự chuyển thành chữ in hoa không dấu như trên app ngân hàng">
          <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </Field>
        <Alert tone="info">Kiểm tra kỹ số tài khoản — phụ huynh chuyển tiền theo mã QR tạo từ thông tin này.</Alert>
      </div>
    </Dialog>
  );
}
