import { z } from '../../../../platform/openapi/zod.js';
import { PasswordSchema } from './password.js';

export const BranchRefSchema = z
  .object({ id: z.string(), code: z.string(), name: z.string(), isPrimary: z.boolean() })
  .openapi('BranchRef');

export const MeSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    fullName: z.string(),
    phone: z.string().nullable(),
    role: z.string().openapi({ example: 'CM' }),
    roleName: z.string(),
    apps: z.array(z.enum(['crm', 'lms'])).openapi({ description: 'App người dùng được vào' }),
    permissions: z.array(z.string()),
    branches: z.array(BranchRefSchema),
    scope: z.enum(['ALL', 'BRANCHES', 'TEAM', 'OWN', 'TEACHING']).openapi({ description: 'Phạm vi dữ liệu' }),
    mustChangePassword: z.boolean().openapi({ description: 'true → phải đổi mật khẩu trước khi dùng các chức năng khác' }),
  })
  .openapi('Me');

export const SessionSchema = z
  .object({
    accessToken: z.string(),
    expiresIn: z.number().int().openapi({ description: 'Số giây access token còn hiệu lực' }),
    refreshToken: z
      .string()
      .optional()
      .openapi({ description: 'Chỉ trả khi gửi header `X-Client: mobile`. Web nhận qua cookie httpOnly.' }),
    user: MeSchema,
  })
  .openapi('Session');

export const LoginBody = z.object({
  email: z.email('Email không hợp lệ').openapi({ example: 'admin@zero1.local' }),
  password: z.string().min(1, 'Nhập mật khẩu'),
});

export const RefreshBody = z.object({
  refreshToken: z.string().optional().openapi({ description: 'Chỉ dành cho mobile; web dùng cookie.' }),
});

export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: PasswordSchema,
});

export const UpdateProfileBody = z
  .object({
    fullName: z.string().trim().min(2).max(150).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+ ]{8,20}$/, 'Số điện thoại không hợp lệ')
      .nullable()
      .optional(),
  })
  .strict();

export const ForgotPasswordBody = z.object({
  email: z.email('Email không hợp lệ'),
  app: z.enum(['crm', 'lms']).default('crm').openapi({ description: 'App để tạo link trong email' }),
});

export const ResetPasswordBody = z.object({
  token: z.string().min(20),
  newPassword: PasswordSchema,
});
