import { AppError, Errors } from '../../../../platform/http/errors.js';
import { canAccessBranch, type Principal } from '../../../../platform/auth/principal.js';
import { vnDate } from '../../../../platform/time.js';
import type { SettingsReader } from '../../../core/contract/index.js';
import { CM_APPROVAL_LIMIT, SCHOLARSHIP_SESSIONS_PER_MONTH } from '../../settings.js';
import type { PackagesService } from '../packages/packages.service.js';
import type { PromotionsService } from '../promotions/promotions.service.js';
import { computeQuote, PricingError, type QuoteInput } from './pricing.core.js';

export interface QuoteRequest {
  packageId: string;
  branchId: string;
  promotionId?: string | null;
  scholarshipMonths?: number;
  extraDiscount?: number;
  /** Ngày áp dụng (YYYY-MM-DD, giờ VN); mặc định hôm nay. */
  date?: string;
  /** Phần cần duyệt đã được duyệt (chỉ dùng nội bộ khi chốt đăng ký). */
  approved?: boolean;
}

/** Gom dữ liệu thật trong DB rồi gọi lõi tính giá — không tin số liệu client gửi. */
export function createPricingService(deps: { packages: PackagesService; promotions: PromotionsService; settings: SettingsReader }) {
  return {
    async quote(actor: Principal, req: QuoteRequest) {
      if (!canAccessBranch(actor, req.branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chi nhánh ngoài phạm vi');
      const date = req.date ?? vnDate();
      const { pkg, listPrice, priceSource } = await deps.packages.resolve(req.packageId, req.branchId);
      if (!pkg.isActive) throw new AppError(422, 'PACKAGE_INACTIVE', 'Gói học phí đã ngừng bán');

      const program = req.promotionId ? await deps.promotions.resolveProgram(req.promotionId, { branchId: req.branchId, packageId: pkg.id, date }) : null;
      const [cmApprovalLimit, sessionsPerMonth] = await Promise.all([
        deps.settings.get(CM_APPROVAL_LIMIT, req.branchId),
        deps.settings.get(SCHOLARSHIP_SESSIONS_PER_MONTH),
      ]);

      const input: QuoteInput = {
        listPrice,
        packageMonths: pkg.months,
        packageSessions: pkg.sessionsCount,
        defaultScholarshipMonths: pkg.defaultScholarshipMonths,
        promotion: program
          ? { id: program.id, code: program.code, name: program.name, discountType: program.discountType, discountValue: program.discountValue, maxDiscount: program.maxDiscount }
          : null,
        extraDiscount: req.extraDiscount ?? 0,
        scholarshipMonths: req.scholarshipMonths ?? pkg.defaultScholarshipMonths,
        approved: req.approved ?? false,
        sessionsPerMonth,
        cmApprovalLimit,
      };
      try {
        return {
          date,
          package: { id: pkg.id, code: pkg.code, name: pkg.name, subjectId: pkg.subjectId },
          priceSource,
          ...computeQuote(input),
          /** Đầu vào đã dùng — lưu vào đăng ký để tính lại khi duyệt mà không đọc giá hiện tại. */
          input,
        };
      } catch (err) {
        if (err instanceof PricingError) {
          throw err.code === 'EXTRA_DISCOUNT_TOO_LARGE'
            ? new AppError(422, err.code, 'Giảm thêm vượt quá số tiền còn lại', err.message)
            : Errors.validation([{ path: 'body', message: err.message }]);
        }
        throw err;
      }
    },
  };
}

export type PricingService = ReturnType<typeof createPricingService>;
