import { and, asc, eq, inArray } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { canAccessBranch, type Principal } from '../../../../platform/auth/principal.js';
import type { BranchDirectory } from '../../../core/contract/index.js';
import type { CrmDb, CrmExecutor } from '../../db/types.js';
import { catalogLevels, packageBranchPrices, packages } from '../../db/schema.js';

type PackageRow = typeof packages.$inferSelect;

export interface PackageInput {
  code: string;
  name: string;
  subjectId: string;
  months: number;
  sessionsCount: number;
  sessionsPerWeek: number;
  basePrice: number;
  defaultScholarshipMonths: number;
  description?: string | null;
}

/** Danh sách môn CRM đang thấy = các môn có trong bản sao cấp độ từ LMS. */
async function subjectNames(db: CrmExecutor, subjectIds?: string[]) {
  const rows = await db
    .selectDistinct({ id: catalogLevels.subjectId, name: catalogLevels.subjectName, code: catalogLevels.subjectCode })
    .from(catalogLevels)
    .where(subjectIds?.length ? inArray(catalogLevels.subjectId, subjectIds) : undefined);
  return new Map(rows.map((r) => [r.id, r]));
}

export function createPackagesService(db: CrmDb, branchesDir: BranchDirectory) {
  async function toDtos(actor: Principal, rows: PackageRow[], branchId?: string) {
    if (!rows.length) return [];
    const [prices, subjects] = await Promise.all([
      db.select().from(packageBranchPrices).where(inArray(packageBranchPrices.packageId, rows.map((r) => r.id))),
      subjectNames(db, [...new Set(rows.map((r) => r.subjectId))]),
    ]);
    return rows.map((p) => {
      // Chỉ hiện giá của chi nhánh người gọi quản lý (ADMIN thấy hết).
      const own = prices.filter((x) => x.packageId === p.id && canAccessBranch(actor, x.branchId));
      const branchPrice = branchId ? own.find((x) => x.branchId === branchId)?.price : undefined;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        subjectId: p.subjectId,
        subjectName: subjects.get(p.subjectId)?.name ?? null,
        months: p.months,
        sessionsCount: p.sessionsCount,
        sessionsPerWeek: p.sessionsPerWeek,
        basePrice: p.basePrice,
        defaultScholarshipMonths: p.defaultScholarshipMonths,
        description: p.description,
        isActive: p.isActive,
        branchPrices: own.map((x) => ({ branchId: x.branchId, price: x.price })),
        /** Giá áp dụng ở `branchId` được hỏi (giá chi nhánh ?? giá gốc); null nếu không hỏi chi nhánh. */
        effectivePrice: branchId ? (branchPrice ?? p.basePrice) : null,
      };
    });
  }

  async function assertSubject(subjectId: string, exec: CrmExecutor) {
    const [row] = await exec.select({ id: catalogLevels.subjectId }).from(catalogLevels).where(eq(catalogLevels.subjectId, subjectId)).limit(1);
    if (!row) throw Errors.validation([{ path: 'body.subjectId', message: 'Môn học không tồn tại (hoặc chưa đồng bộ từ LMS)' }]);
  }

  async function assertCodeFree(code: string, exceptId: string | null, exec: CrmExecutor) {
    const [taken] = await exec.select({ id: packages.id }).from(packages).where(eq(packages.code, code));
    if (taken && taken.id !== exceptId) throw Errors.conflict('PACKAGE_CODE_TAKEN', 'Mã gói đã tồn tại');
  }

  async function getRow(id: string, exec: CrmExecutor = db) {
    const [row] = await exec.select().from(packages).where(eq(packages.id, id));
    if (!row) throw Errors.notFound('gói học phí');
    return row;
  }

  function assertScholarshipFits(months: number, defaultScholarshipMonths: number) {
    if (defaultScholarshipMonths > months) {
      throw Errors.validation([{ path: 'body.defaultScholarshipMonths', message: 'Học bổng mặc định không vượt quá số tháng của gói' }]);
    }
  }

  return {
    async subjects() {
      return [...(await subjectNames(db)).values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    },

    async list(actor: Principal, q: { includeInactive: boolean; subjectId?: string; branchId?: string }) {
      if (q.branchId && !canAccessBranch(actor, q.branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chi nhánh ngoài phạm vi');
      const rows = await db
        .select()
        .from(packages)
        .where(and(q.includeInactive ? undefined : eq(packages.isActive, true), q.subjectId ? eq(packages.subjectId, q.subjectId) : undefined))
        .orderBy(asc(packages.subjectId), asc(packages.months), asc(packages.code));
      return toDtos(actor, rows, q.branchId);
    },

    async get(actor: Principal, id: string, branchId?: string) {
      return (await toDtos(actor, [await getRow(id)], branchId))[0]!;
    },

    async create(actor: Principal, input: PackageInput) {
      assertScholarshipFits(input.months, input.defaultScholarshipMonths);
      const id = newId();
      await db.transaction(async (tx) => {
        await assertCodeFree(input.code, null, tx);
        await assertSubject(input.subjectId, tx);
        await tx.insert(packages).values({ id, ...input, description: input.description ?? null });
      });
      return this.get(actor, id);
    },

    async update(actor: Principal, id: string, patch: Partial<PackageInput> & { isActive?: boolean }) {
      await db.transaction(async (tx) => {
        const current = await getRow(id, tx);
        if (patch.code && patch.code !== current.code) await assertCodeFree(patch.code, id, tx);
        if (patch.subjectId && patch.subjectId !== current.subjectId) await assertSubject(patch.subjectId, tx);
        assertScholarshipFits(patch.months ?? current.months, patch.defaultScholarshipMonths ?? current.defaultScholarshipMonths);
        await tx.update(packages).set(patch).where(eq(packages.id, id));
      });
      return this.get(actor, id);
    },

    /** Đặt / bỏ giá riêng của một chi nhánh (`price = null` → quay về giá gốc). */
    async setBranchPrice(actor: Principal, packageId: string, branchId: string, price: number | null) {
      if (!canAccessBranch(actor, branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chỉ đặt giá cho chi nhánh mình quản lý');
      const [branch] = await branchesDir.getMany([branchId]);
      if (!branch) throw Errors.validation([{ path: 'body.branchId', message: 'Chi nhánh không tồn tại' }]);
      await getRow(packageId);
      if (price === null) {
        await db.delete(packageBranchPrices).where(and(eq(packageBranchPrices.packageId, packageId), eq(packageBranchPrices.branchId, branchId)));
      } else {
        const row = { price, updatedBy: actor.userId, updatedAt: new Date() };
        await db.insert(packageBranchPrices).values({ packageId, branchId, ...row }).onDuplicateKeyUpdate({ set: row });
      }
      return this.get(actor, packageId, branchId);
    },

    /** Dùng cho tính giá: gói + giá áp dụng tại chi nhánh. */
    async resolve(packageId: string, branchId: string) {
      const pkg = await getRow(packageId);
      const [bp] = await db
        .select()
        .from(packageBranchPrices)
        .where(and(eq(packageBranchPrices.packageId, packageId), eq(packageBranchPrices.branchId, branchId)));
      return { pkg, listPrice: bp?.price ?? pkg.basePrice, priceSource: bp ? ('BRANCH' as const) : ('BASE' as const) };
    },
  };
}

export type PackagesService = ReturnType<typeof createPackagesService>;
