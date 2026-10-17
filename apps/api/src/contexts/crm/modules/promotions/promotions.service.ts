import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { canAccessBranch, type Principal } from '../../../../platform/auth/principal.js';
import { toApiInstant } from '../../../../platform/time.js';
import type { BranchDirectory } from '../../../core/contract/index.js';
import type { CrmDb, CrmExecutor } from '../../db/types.js';
import { packages, promotionItems, promotionPrograms, promotionStockMoves } from '../../db/schema.js';

type ProgramRow = typeof promotionPrograms.$inferSelect;

export interface ProgramInput {
  code: string;
  name: string;
  description?: string | null;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: number;
  maxDiscount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  branchIds?: string[] | null;
  packageIds?: string[] | null;
}

export type IneligibleReason = 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'BRANCH_NOT_INCLUDED' | 'PACKAGE_NOT_INCLUDED';

const reasonText: Record<IneligibleReason, string> = {
  INACTIVE: 'Chương trình đã ngừng',
  NOT_STARTED: 'Chương trình chưa bắt đầu',
  EXPIRED: 'Chương trình đã hết hạn',
  BRANCH_NOT_INCLUDED: 'Chương trình không áp dụng cho chi nhánh này',
  PACKAGE_NOT_INCLUDED: 'Chương trình không áp dụng cho gói này',
};

/** Chương trình có áp dụng được cho (chi nhánh, gói, ngày) không. Ngày theo giờ Việt Nam, YYYY-MM-DD. */
export function ineligibility(p: ProgramRow, ctx: { branchId: string; packageId: string; date: string }): IneligibleReason | null {
  if (!p.isActive) return 'INACTIVE';
  if (p.startDate && ctx.date < p.startDate) return 'NOT_STARTED';
  if (p.endDate && ctx.date > p.endDate) return 'EXPIRED';
  if (p.branchIds && !p.branchIds.includes(ctx.branchId)) return 'BRANCH_NOT_INCLUDED';
  if (p.packageIds && !p.packageIds.includes(ctx.packageId)) return 'PACKAGE_NOT_INCLUDED';
  return null;
}

export function promotionNotApplicable(reason: IneligibleReason) {
  return new AppError(422, 'PROMOTION_NOT_APPLICABLE', 'Không áp dụng được khuyến mại', reasonText[reason]);
}

function programDto(p: ProgramRow) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    discountType: p.discountType,
    discountValue: p.discountValue,
    maxDiscount: p.maxDiscount,
    startDate: p.startDate,
    endDate: p.endDate,
    branchIds: p.branchIds ?? null,
    packageIds: p.packageIds ?? null,
    isActive: p.isActive,
  };
}

const stockOf = sql<number>`COALESCE(SUM(${promotionStockMoves.quantity}), 0)`.mapWith(Number);

export function createPromotionsService(db: CrmDb, branchesDir: BranchDirectory) {
  function validateProgram(v: Partial<ProgramInput>, current?: ProgramRow) {
    const type = v.discountType ?? current?.discountType;
    const value = v.discountValue ?? current?.discountValue;
    const max = v.maxDiscount !== undefined ? v.maxDiscount : current?.maxDiscount;
    const start = v.startDate !== undefined ? v.startDate : current?.startDate;
    const end = v.endDate !== undefined ? v.endDate : current?.endDate;
    const errors = [];
    if (type === 'PERCENT' && value !== undefined && (value < 1 || value > 100)) errors.push({ path: 'body.discountValue', message: 'Phần trăm từ 1 đến 100' });
    if (type === 'AMOUNT' && value !== undefined && value < 1) errors.push({ path: 'body.discountValue', message: 'Số tiền giảm phải lớn hơn 0' });
    if (type === 'AMOUNT' && max != null) errors.push({ path: 'body.maxDiscount', message: 'Mức trần chỉ dùng cho giảm theo %' });
    if (start && end && start > end) errors.push({ path: 'body.endDate', message: 'Ngày kết thúc phải sau ngày bắt đầu' });
    if (errors.length) throw Errors.validation(errors);
  }

  async function validateRefs(v: Partial<ProgramInput>, exec: CrmExecutor) {
    if (v.branchIds?.length) {
      const found = await branchesDir.getMany(v.branchIds);
      if (found.length !== new Set(v.branchIds).size) throw Errors.validation([{ path: 'body.branchIds', message: 'Có chi nhánh không tồn tại' }]);
    }
    if (v.packageIds?.length) {
      const found = await exec.select({ id: packages.id }).from(packages).where(inArray(packages.id, v.packageIds));
      if (found.length !== new Set(v.packageIds).size) throw Errors.validation([{ path: 'body.packageIds', message: 'Có gói không tồn tại' }]);
    }
  }

  async function assertCodeFree(code: string, exceptId: string | null, exec: CrmExecutor) {
    const [taken] = await exec.select({ id: promotionPrograms.id }).from(promotionPrograms).where(eq(promotionPrograms.code, code));
    if (taken && taken.id !== exceptId) throw Errors.conflict('PROMOTION_CODE_TAKEN', 'Mã chương trình đã tồn tại');
  }

  async function getProgramRow(id: string, exec: CrmExecutor = db) {
    const [row] = await exec.select().from(promotionPrograms).where(eq(promotionPrograms.id, id));
    if (!row) throw Errors.notFound('chương trình khuyến mại');
    return row;
  }

  async function stockByBranch(itemIds: string[]) {
    if (!itemIds.length) return [];
    return db
      .select({ itemId: promotionStockMoves.itemId, branchId: promotionStockMoves.branchId, quantity: stockOf })
      .from(promotionStockMoves)
      .where(inArray(promotionStockMoves.itemId, itemIds))
      .groupBy(promotionStockMoves.itemId, promotionStockMoves.branchId);
  }

  return {
    // ─────────── Chương trình khuyến mại

    async listPrograms(q: { includeInactive: boolean; eligibleFor?: { branchId: string; packageId: string; date: string } }) {
      const rows = await db
        .select()
        .from(promotionPrograms)
        .where(q.includeInactive && !q.eligibleFor ? undefined : eq(promotionPrograms.isActive, true))
        .orderBy(desc(promotionPrograms.createdAt));
      return rows.filter((p) => !q.eligibleFor || !ineligibility(p, q.eligibleFor)).map(programDto);
    },

    async createProgram(input: ProgramInput) {
      validateProgram(input);
      const id = newId();
      await db.transaction(async (tx) => {
        await assertCodeFree(input.code, null, tx);
        await validateRefs(input, tx);
        await tx.insert(promotionPrograms).values({
          id,
          ...input,
          description: input.description ?? null,
          maxDiscount: input.maxDiscount ?? null,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          branchIds: input.branchIds?.length ? input.branchIds : null,
          packageIds: input.packageIds?.length ? input.packageIds : null,
        });
      });
      return programDto(await getProgramRow(id));
    },

    async updateProgram(id: string, patch: Partial<ProgramInput> & { isActive?: boolean }) {
      await db.transaction(async (tx) => {
        const current = await getProgramRow(id, tx);
        validateProgram(patch, current);
        if (patch.code && patch.code !== current.code) await assertCodeFree(patch.code, id, tx);
        await validateRefs(patch, tx);
        await tx
          .update(promotionPrograms)
          .set({
            ...patch,
            ...(patch.branchIds !== undefined ? { branchIds: patch.branchIds?.length ? patch.branchIds : null } : {}),
            ...(patch.packageIds !== undefined ? { packageIds: patch.packageIds?.length ? patch.packageIds : null } : {}),
          })
          .where(eq(promotionPrograms.id, id));
      });
      return programDto(await getProgramRow(id));
    },

    /** Dùng cho tính giá: chương trình + lý do không áp dụng được (nếu có). */
    async resolveProgram(id: string, ctx: { branchId: string; packageId: string; date: string }) {
      const row = await getProgramRow(id);
      const reason = ineligibility(row, ctx);
      if (reason) throw promotionNotApplicable(reason);
      return row;
    },

    // ─────────── Quà tặng & kho

    async listItems(actor: Principal, includeInactive: boolean) {
      const rows = await db
        .select()
        .from(promotionItems)
        .where(includeInactive ? undefined : eq(promotionItems.isActive, true))
        .orderBy(asc(promotionItems.name));
      const stock = await stockByBranch(rows.map((r) => r.id));
      return rows.map(({ createdAt: _c, updatedAt: _u, ...item }) => {
        const byBranch = stock.filter((s) => s.itemId === item.id && canAccessBranch(actor, s.branchId)).map(({ itemId: _i, ...s }) => s);
        return {
          ...item,
          stock: byBranch,
          totalStock: byBranch.reduce((sum, s) => sum + s.quantity, 0),
          lowStockBranches: byBranch.filter((s) => s.quantity <= item.minStock).map((s) => s.branchId),
        };
      });
    },

    async createItem(input: { code: string; name: string; unit: string; minStock: number; description?: string | null }) {
      const [taken] = await db.select({ id: promotionItems.id }).from(promotionItems).where(eq(promotionItems.code, input.code));
      if (taken) throw Errors.conflict('ITEM_CODE_TAKEN', 'Mã quà tặng đã tồn tại');
      const id = newId();
      await db.insert(promotionItems).values({ id, ...input, description: input.description ?? null });
      return id;
    },

    async updateItem(id: string, patch: Partial<{ code: string; name: string; unit: string; minStock: number; description: string | null; isActive: boolean }>) {
      const [current] = await db.select().from(promotionItems).where(eq(promotionItems.id, id));
      if (!current) throw Errors.notFound('quà tặng');
      if (patch.code && patch.code !== current.code) {
        const [taken] = await db.select({ id: promotionItems.id }).from(promotionItems).where(eq(promotionItems.code, patch.code));
        if (taken) throw Errors.conflict('ITEM_CODE_TAKEN', 'Mã quà tặng đã tồn tại');
      }
      await db.update(promotionItems).set(patch).where(eq(promotionItems.id, id));
    },

    /**
     * Nhập / xuất / điều chỉnh kho tại một chi nhánh. Không cho tồn âm.
     * Khoá dòng quà tặng để hai thao tác đồng thời không cùng vượt tồn.
     */
    async moveStock(
      actor: Principal,
      itemId: string,
      input: { branchId: string; kind: 'IN' | 'OUT' | 'ADJUST'; quantity: number; note?: string | null },
    ) {
      if (!canAccessBranch(actor, input.branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chỉ quản lý kho của chi nhánh mình');
      const [branch] = await branchesDir.getMany([input.branchId]);
      if (!branch) throw Errors.validation([{ path: 'body.branchId', message: 'Chi nhánh không tồn tại' }]);
      if (input.kind !== 'ADJUST' && input.quantity <= 0) throw Errors.validation([{ path: 'body.quantity', message: 'Số lượng phải lớn hơn 0' }]);
      if (input.kind === 'ADJUST' && input.quantity === 0) throw Errors.validation([{ path: 'body.quantity', message: 'Điều chỉnh phải khác 0' }]);
      const delta = input.kind === 'OUT' ? -input.quantity : input.quantity;

      return db.transaction(async (tx) => {
        const [item] = await tx.select().from(promotionItems).where(eq(promotionItems.id, itemId)).for('update');
        if (!item) throw Errors.notFound('quà tặng');
        const [current] = await tx
          .select({ quantity: stockOf })
          .from(promotionStockMoves)
          .where(and(eq(promotionStockMoves.itemId, itemId), eq(promotionStockMoves.branchId, input.branchId)));
        const after = (current?.quantity ?? 0) + delta;
        if (after < 0) throw Errors.conflict('INSUFFICIENT_STOCK', 'Không đủ hàng trong kho', `Còn ${current?.quantity ?? 0} ${item.unit}`);
        await tx.insert(promotionStockMoves).values({
          id: newId(),
          itemId,
          branchId: input.branchId,
          quantity: delta,
          kind: input.kind,
          note: input.note ?? null,
          createdBy: actor.userId,
          createdAt: new Date(),
        });
        return { branchId: input.branchId, quantity: after };
      });
    },

    /** Xuất (tặng) / nhập lại (trả) kho khi giao quà cho đăng ký — gọi trong transaction của nghiệp vụ. */
    async giftMove(tx: CrmExecutor, input: { itemId: string; branchId: string; delta: number; kind: 'GIFT' | 'RETURN'; refId: string; actorId: string }) {
      const [item] = await tx.select().from(promotionItems).where(eq(promotionItems.id, input.itemId)).for('update');
      if (!item) throw Errors.notFound('quà tặng');
      const [current] = await tx
        .select({ quantity: stockOf })
        .from(promotionStockMoves)
        .where(and(eq(promotionStockMoves.itemId, input.itemId), eq(promotionStockMoves.branchId, input.branchId)));
      if ((current?.quantity ?? 0) + input.delta < 0) {
        throw Errors.conflict('INSUFFICIENT_STOCK', `Không đủ "${item.name}" trong kho`, `Còn ${current?.quantity ?? 0} ${item.unit}`);
      }
      await tx.insert(promotionStockMoves).values({
        id: newId(),
        itemId: input.itemId,
        branchId: input.branchId,
        quantity: input.delta,
        kind: input.kind,
        refId: input.refId,
        createdBy: input.actorId,
        createdAt: new Date(),
      });
    },

    async getItems(ids: string[]) {
      if (!ids.length) return [];
      return db.select().from(promotionItems).where(inArray(promotionItems.id, ids));
    },

    async listMoves(actor: Principal, itemId: string, branchId?: string) {
      if (branchId && !canAccessBranch(actor, branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chi nhánh ngoài phạm vi');
      const branchFilter =
        actor.scope.kind === 'ALL' ? undefined : actor.branchIds.length ? inArray(promotionStockMoves.branchId, actor.branchIds) : sql`1 = 0`;
      const rows = await db
        .select()
        .from(promotionStockMoves)
        .where(and(eq(promotionStockMoves.itemId, itemId), branchId ? eq(promotionStockMoves.branchId, branchId) : branchFilter))
        .orderBy(desc(promotionStockMoves.createdAt))
        .limit(200);
      return rows.map((m) => ({ ...m, createdAt: toApiInstant(m.createdAt) }));
    },
  };
}

export type PromotionsService = ReturnType<typeof createPromotionsService>;
