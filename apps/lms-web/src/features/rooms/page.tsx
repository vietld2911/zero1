import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Badge, Button, Checkbox, DataTable, Dialog, Field, Input, PageHeader, toast, type Column } from '@zero1/ui';
import { BranchSelect, errorMessage, useApi, useBranches, useDefaultBranch } from '@zero1/web-core';
import { lmsKeys } from '../labels';

type Room = Schemas['Room'];

export default function RoomsPage() {
  const api = useApi();
  const { data: branches = [] } = useBranches();
  const [branchId, setBranchId] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const { data, isFetching } = useQuery({
    queryKey: [...lmsKeys.rooms, branchId, { showInactive }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/rooms', { params: { query: { branchId: branchId || undefined, includeInactive: showInactive } } }))).data,
  });
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  const columns: Column<Room>[] = [
    {
      key: 'name',
      header: 'Phòng',
      cell: (r) => (
        <span className="font-medium">
          {r.name} {!r.isActive && <Badge>Ngừng dùng</Badge>}
        </span>
      ),
    },
    { key: 'branch', header: 'Chi nhánh', cell: (r) => branchName.get(r.branchId) ?? '—' },
    { key: 'capacity', header: 'Sức chứa', align: 'right', cell: (r) => <span className="tabular-nums">{r.capacity}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Sửa</span>,
      align: 'right',
      cell: (r) => (
        <Button variant="ghost" size="icon" aria-label={`Sửa ${r.name}`} onClick={() => setEditing(r)}>
          <Pencil />
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Phòng học"
        description="Phòng theo chi nhánh — dùng để cảnh báo trùng phòng khi xếp lịch."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Thêm phòng
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <BranchSelect value={branchId} onChange={setBranchId} allLabel="Mọi chi nhánh" />
        <Checkbox label="Hiện phòng ngừng dùng" checked={showInactive} onCheckedChange={setShowInactive} />
      </div>
      <DataTable columns={columns} rows={data} rowKey={(r) => r.id} loading={isFetching} empty="Chưa có phòng học" />
      {editing && <RoomDialog room={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RoomDialog({ room, onClose }: { room: Room | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const defaultBranch = useDefaultBranch();
  const [branchId, setBranchId] = useState(room?.branchId ?? '');
  const [name, setName] = useState(room?.name ?? '');
  const [capacity, setCapacity] = useState(room?.capacity ?? 12);
  const [isActive, setIsActive] = useState(room?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (room) await unwrap(api.PATCH('/api/v1/lms/rooms/{id}', { params: { path: { id: room.id } }, body: { name: name.trim(), capacity, isActive } }));
      else await unwrap(api.POST('/api/v1/lms/rooms', { body: { branchId: branchId || defaultBranch, name: name.trim(), capacity } }));
    },
    onSuccess: () => {
      toast.success('Đã lưu phòng');
      void qc.invalidateQueries({ queryKey: lmsKeys.rooms });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? errorMessage(err) : 'Không lưu được'),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={room ? `Sửa phòng ${room.name}` : 'Thêm phòng học'}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {!room && (
          <Field label="Chi nhánh">
            <BranchSelect value={branchId || defaultBranch} onChange={setBranchId} className="w-full" />
          </Field>
        )}
        <Field label="Tên phòng" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="P101" />
        </Field>
        <Field label="Sức chứa">
          <Input type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
        {room && <Checkbox label="Đang sử dụng" checked={isActive} onCheckedChange={setIsActive} />}
      </div>
    </Dialog>
  );
}
