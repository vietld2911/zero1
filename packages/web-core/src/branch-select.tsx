import { Select } from '@zero1/ui';
import { useMe } from './auth/auth-context';
import { useBranches } from './queries';

/** Chi nhánh mặc định: chi nhánh chính của người dùng, không có thì chi nhánh đầu tiên thấy được. */
export function useDefaultBranch() {
  const me = useMe();
  const { data: branches = [] } = useBranches();
  return me.branches.find((b) => b.isPrimary)?.id ?? me.branches[0]?.id ?? branches[0]?.id ?? '';
}

/**
 * Chọn chi nhánh để lọc. Ẩn khi người dùng chỉ thấy một chi nhánh.
 * `allLabel` → thêm lựa chọn "tất cả" (giá trị '').
 */
export function BranchSelect({
  value,
  onChange,
  allLabel,
  className = 'w-48',
}: {
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
  className?: string;
}) {
  const { data: branches = [] } = useBranches();
  if (branches.length <= 1) return null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className} aria-label="Chi nhánh">
      {allLabel && <option value="">{allLabel}</option>}
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </Select>
  );
}
