import { and, eq, inArray, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { can, canAccessBranch, type Principal } from '../../../../platform/auth/principal.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { CrmDb } from '../../db/types.js';
import { branchPaymentAccounts, payments } from '../../db/schema.js';
import type { EnrollmentsService } from './enrollments.service.js';

type Method = 'CASH' | 'TRANSFER' | 'CARD';

/**
 * Ngân hàng phổ biến (mã BIN theo NAPAS) — giao diện chọn từ danh sách này.
 * VietQR cần BIN, không cần tên ngân hàng.
 */
export const BANKS = [
  { bin: '970436', name: 'Vietcombank' },
  { bin: '970415', name: 'VietinBank' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970405', name: 'Agribank' },
  { bin: '970422', name: 'MB Bank' },
  { bin: '970407', name: 'Techcombank' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970437', name: 'HDBank' },
  { bin: '970441', name: 'VIB' },
  { bin: '970443', name: 'SHB' },
  { bin: '970448', name: 'OCB' },
  { bin: '970426', name: 'MSB' },
] as const;

const PAYMENT_CONFIRM = 'crm.payments.confirm';

/** Nội dung chuyển khoản: mã đăng ký + mã học viên — không dấu, ≤ 50 ký tự (giới hạn của ngân hàng). */
function transferContent(enrollmentCode: string, studentCode: string) {
  return `${enrollmentCode} ${studentCode}`.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 50);
}

export function createPaymentsService(db: CrmDb, core: CoreContract, enrollmentsService: EnrollmentsService) {
  const branchesDir = core.branches;
  async function getPayment(actor: Principal, id: string) {
    const [p] = await db.select().from(payments).where(eq(payments.id, id));
    if (!p) throw Errors.notFound('khoản thu');
    await enrollmentsService.getVisible(actor, p.enrollmentId); // kiểm tra phạm vi
    return p;
  }

  return {
    /**
     * Ghi nhận khoản thu. Người có quyền xác nhận (CS / CM) → xác nhận luôn; người khác → chờ xác nhận.
     * Tổng (đã xác nhận + đang chờ) không vượt số phải thu hiện tại.
     */
    async record(
      actor: Principal,
      enrollmentId: string,
      input: { amount: number; method: Method; reference?: string | null; note?: string | null; paidAt?: Date },
      idempotencyKey: string,
    ) {
      /** Khoản thu đã tạo bằng key này (gửi lại / gửi song song) → trả lại nó. */
      const replay = async () => {
        const [dup] = await db.select().from(payments).where(eq(payments.idempotencyKey, idempotencyKey));
        if (dup && dup.enrollmentId !== enrollmentId) throw Errors.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã dùng cho thao tác khác');
        return dup?.id;
      };
      const prior = await replay();
      if (prior) return prior;
      const confirmNow = can(actor, PAYMENT_CONFIRM);
      const id = newId();
      const enrollment = await db.transaction(async (tx) => {
        const e = await enrollmentsService.getVisible(actor, enrollmentId, tx, true);
        if (e.status === 'CANCELLED') throw Errors.conflict('ENROLLMENT_CANCELLED', 'Đăng ký đã huỷ');
        const [open] = await tx
          .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)`.mapWith(Number) })
          .from(payments)
          .where(and(eq(payments.enrollmentId, enrollmentId), inArray(payments.status, ['PENDING', 'CONFIRMED'])));
        const remaining = e.amountDue - (open?.total ?? 0);
        if (input.amount > remaining) {
          throw new AppError(422, 'PAYMENT_EXCEEDS_DUE', 'Số tiền vượt quá số còn phải thu', `Còn ${remaining.toLocaleString('vi-VN')}đ (gồm khoản đang chờ xác nhận)`);
        }
        const now = new Date();
        await tx.insert(payments).values({
          id,
          enrollmentId,
          branchId: e.branchId,
          amount: input.amount,
          method: input.method,
          status: confirmNow ? 'CONFIRMED' : 'PENDING',
          reference: input.reference ?? null,
          note: input.note ?? null,
          paidAt: input.paidAt ?? now,
          recordedBy: actor.userId,
          confirmedBy: confirmNow ? actor.userId : null,
          confirmedAt: confirmNow ? now : null,
          idempotencyKey,
        });
        if (confirmNow) {
          await enrollmentsService.emitPaymentConfirmed(tx, { id, enrollmentId, amount: input.amount, method: input.method, branchId: e.branchId }, actor.userId);
          await enrollmentsService.afterPaymentChange(tx, enrollmentId, actor.userId);
        }
        return e;
      }).catch(async (err: unknown) => {
        // Request cùng key chạy song song: request kia đã ghi trước (trùng unique key, hoặc vượt số phải thu
        // vì khoản kia đã được tính) → trả kết quả của request kia.
        if (await replay()) return null;
        throw err;
      });
      if (!enrollment) return (await replay())!;
      if (!confirmNow) {
        await core.notifications.sendToRoles(
          { branchId: enrollment.branchId, roles: ['CS', 'CM'] },
          {
            type: 'crm.payment.pending',
            app: 'crm',
            title: 'Khoản thu chờ xác nhận',
            body: `${enrollment.code} · ${input.amount.toLocaleString('vi-VN')}đ`,
            link: `/enrollments/${enrollmentId}`,
          },
        );
      }
      return id;
    },

    async confirm(actor: Principal, paymentId: string) {
      const p = await getPayment(actor, paymentId);
      await db.transaction(async (tx) => {
        const [res] = await tx
          .update(payments)
          .set({ status: 'CONFIRMED', confirmedBy: actor.userId, confirmedAt: new Date() })
          .where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING')));
        if (res.affectedRows !== 1) throw Errors.conflict('PAYMENT_NOT_PENDING', 'Khoản thu không ở trạng thái chờ xác nhận');
        await enrollmentsService.emitPaymentConfirmed(tx, p, actor.userId);
        await enrollmentsService.afterPaymentChange(tx, p.enrollmentId, actor.userId);
      });
    },

    /** Huỷ khoản thu (ghi nhầm / chưa nhận được tiền). Khoản đã xác nhận chỉ người có quyền xác nhận được huỷ. */
    async cancel(actor: Principal, paymentId: string, reason: string) {
      const p = await getPayment(actor, paymentId);
      if (p.status === 'CANCELLED') return;
      if (p.status === 'CONFIRMED' && !can(actor, PAYMENT_CONFIRM)) throw Errors.forbidden('Chỉ CS / CM huỷ được khoản thu đã xác nhận');
      if (p.status === 'PENDING' && p.recordedBy !== actor.userId && !can(actor, PAYMENT_CONFIRM)) throw Errors.forbidden('Chỉ người ghi nhận hoặc CS / CM được huỷ');
      await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({ status: 'CANCELLED', note: `${p.note ? `${p.note} · ` : ''}Huỷ: ${reason}`.slice(0, 500) })
          .where(eq(payments.id, paymentId));
        await enrollmentsService.afterPaymentChange(tx, p.enrollmentId, actor.userId);
      });
    },

    /** Mã VietQR cho số tiền còn phải thu (hoặc số tiền chỉ định) — tài khoản lấy theo chi nhánh của đăng ký. */
    async qr(actor: Principal, enrollmentId: string, amount?: number) {
      const e = await enrollmentsService.getVisible(actor, enrollmentId);
      const [dto] = await enrollmentsService.toDtos([e]);
      const [account] = await db.select().from(branchPaymentAccounts).where(eq(branchPaymentAccounts.branchId, e.branchId));
      if (!account) throw new AppError(422, 'PAYMENT_ACCOUNT_MISSING', 'Chi nhánh chưa cấu hình tài khoản nhận tiền', 'Vào Cài đặt → Tài khoản nhận tiền');
      const value = amount ?? Math.max(0, e.amountDue - e.amountPaid);
      const content = transferContent(e.code, dto!.studentCode);
      const params = new URLSearchParams({ amount: String(value), addInfo: content, accountName: account.accountName });
      return {
        imageUrl: `https://img.vietqr.io/image/${account.bankBin}-${account.accountNo}-compact2.png?${params}`,
        bankBin: account.bankBin,
        bankName: account.bankName,
        accountNo: account.accountNo,
        accountName: account.accountName,
        amount: value,
        content,
      };
    },

    async listAccounts(actor: Principal) {
      const rows = await db.select().from(branchPaymentAccounts);
      return rows.filter((r) => canAccessBranch(actor, r.branchId)).map(({ updatedBy: _u, updatedAt: _t, ...a }) => a);
    },

    async setAccount(actor: Principal, branchId: string, input: { bankBin: string; accountNo: string; accountName: string } | null) {
      if (!canAccessBranch(actor, branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chi nhánh ngoài phạm vi');
      const [branch] = await branchesDir.getMany([branchId]);
      if (!branch) throw Errors.validation([{ path: 'branchId', message: 'Chi nhánh không tồn tại' }]);
      if (!input) {
        await db.delete(branchPaymentAccounts).where(eq(branchPaymentAccounts.branchId, branchId));
        return;
      }
      const bank = BANKS.find((b) => b.bin === input.bankBin);
      if (!bank) throw Errors.validation([{ path: 'body.bankBin', message: 'Ngân hàng không có trong danh sách' }]);
      const row = {
        bankBin: bank.bin,
        bankName: bank.name,
        accountNo: input.accountNo,
        // Tên chủ tài khoản trên VietQR: in hoa không dấu
        accountName: input.accountName
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/đ/gi, 'D')
          .toUpperCase(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      await db.insert(branchPaymentAccounts).values({ branchId, ...row }).onDuplicateKeyUpdate({ set: row });
    },
  };
}

export type PaymentsService = ReturnType<typeof createPaymentsService>;
