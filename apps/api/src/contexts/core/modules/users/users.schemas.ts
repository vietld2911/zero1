import { z } from '../../../../platform/openapi/zod.js';
import { PaginationQuery } from '../../../../platform/http/schemas.js';
import { PasswordSchema } from '../auth/password.js';
import { BranchRefSchema } from '../auth/auth.schemas.js';
import { TEAMS } from '../access/catalog.js';

const ulid = z.string().length(26);
const phone = z
  .string()
  .trim()
  .regex(/^[0-9+ ]{8,20}$/, 'Số điện thoại không hợp lệ');

const TeamSchema = z.enum(TEAMS).openapi({ description: 'Team theo vai trò: Quản lý / Kinh doanh / Vận hành / Học thuật' });

export const UserSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    fullName: z.string(),
    phone: z.string().nullable(),
    role: z.string(),
    roleName: z.string(),
    team: TeamSchema,
    status: z.enum(['ACTIVE', 'LOCKED']),
    manager: z.object({ id: z.string(), fullName: z.string(), role: z.string() }).nullable(),
    branches: z.array(BranchRefSchema),
    mustChangePassword: z.boolean(),
    lastLoginAt: z.string().nullable(),
    createdAt: z.string(),
    version: z.number().int().openapi({ description: 'Gửi lại trong header If-Match khi sửa' }),
  })
  .openapi('User');

export const UserListQuery = PaginationQuery.extend({
  q: z.string().trim().optional().openapi({ description: 'Tìm theo tên, email, số điện thoại' }),
  role: z.string().optional().openapi({ description: 'Một hoặc nhiều vai trò, cách nhau dấu phẩy' }),
  status: z.enum(['ACTIVE', 'LOCKED']).optional(),
  branchId: ulid.optional(),
  managerId: ulid.optional(),
});

export const CreateUserBody = z.object({
  email: z.email('Email không hợp lệ'),
  fullName: z.string().trim().min(2).max(150),
  phone: phone.nullable().optional(),
  role: z.string().openapi({ example: 'SALE' }),
  branchIds: z.array(ulid).max(50).default([]).openapi({ description: 'Chi nhánh đầu tiên là chi nhánh chính' }),
  managerId: ulid.nullable().optional(),
  password: PasswordSchema.optional().openapi({ description: 'Bỏ trống → hệ thống sinh mật khẩu tạm và trả về một lần' }),
});

export const UpdateUserBody = z
  .object({
    email: z.email('Email không hợp lệ').optional(),
    fullName: z.string().trim().min(2).max(150).optional(),
    phone: phone.nullable().optional(),
    role: z.string().optional(),
    branchIds: z.array(ulid).max(50).optional(),
    managerId: ulid.nullable().optional(),
    status: z.enum(['ACTIVE', 'LOCKED']).optional().openapi({ description: 'LOCKED → đăng xuất mọi thiết bị' }),
  })
  .strict();

export const CreatedUserSchema = z
  .object({
    user: UserSchema,
    temporaryPassword: z.string().nullable().openapi({ description: 'Chỉ có khi hệ thống tự sinh — hiển thị một lần' }),
  })
  .openapi('CreatedUser');

export const PasswordResetResultSchema = z
  .object({ temporaryPassword: z.string() })
  .openapi('TemporaryPassword');

/** Cây quản lý dạng phẳng — client dựng cây theo managerId. */
export const OrgMemberSchema = z
  .object({
    id: z.string(),
    fullName: z.string(),
    role: z.string(),
    roleName: z.string(),
    team: TeamSchema,
    status: z.enum(['ACTIVE', 'LOCKED']),
    managerId: z.string().nullable(),
  })
  .openapi('OrgMember');

export const OrgTreeQuery = z.object({
  branchId: ulid.optional(),
  includeLocked: z.stringbool().default(false).openapi({ type: 'boolean' }),
});
