import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { ifMatchVersion } from '../../../../platform/http/headers.js';
import { IdParams, item, list } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { metaOf } from '../auth/auth.routes.js';
import type { UsersService } from './users.service.js';
import {
  CreatedUserSchema,
  CreateUserBody,
  OrgMemberSchema,
  OrgTreeQuery,
  PasswordResetResultSchema,
  UpdateUserBody,
  UserListQuery,
  UserSchema,
} from './users.schemas.js';

export function registerUserRoutes(route: RouteRegistrar, users: UsersService) {
  route({
    method: 'get',
    path: '/core/users',
    tags: ['core'],
    summary: 'Danh sách nhân sự',
    description: 'Lọc theo phạm vi dữ liệu của người gọi (chi nhánh / đội).',
    access: { permission: 'core.users.read' },
    request: { query: UserListQuery },
    responses: { 200: { description: 'Danh sách', schema: list(UserSchema) } },
    handler: ({ principal, query }) => users.list(principal, query),
  });

  route({
    method: 'get',
    path: '/core/users/:id',
    tags: ['core'],
    summary: 'Chi tiết nhân sự',
    access: { permission: 'core.users.read' },
    request: { params: IdParams },
    responses: { 200: { description: 'Nhân sự', schema: item(UserSchema) } },
    errorCodes: ['NOT_FOUND'],
    handler: async ({ principal, params }) => ({ data: await users.get(principal, params.id) }),
  });

  route({
    method: 'post',
    path: '/core/users',
    tags: ['core'],
    summary: 'Tạo tài khoản nhân sự',
    description:
      'Chỉ tạo được vai trò thấp hơn mình (ADMIN tạo mọi vai trò), trong chi nhánh mình quản lý. ' +
      'Tài khoản mới luôn phải đổi mật khẩu ở lần đăng nhập đầu. Có SMTP → gửi email thông tin đăng nhập.',
    access: { permission: 'core.users.manage' },
    request: { body: CreateUserBody },
    responses: { 201: { description: 'Đã tạo', schema: item(CreatedUserSchema) } },
    errorCodes: ['EMAIL_TAKEN', 'ROLE_NOT_ALLOWED', 'BRANCH_OUT_OF_SCOPE', 'MANAGER_INVALID'],
    handler: async ({ principal, body, req }) => ({ data: await users.create(principal, body, metaOf(req).ip) }),
  });

  route({
    method: 'patch',
    path: '/core/users/:id',
    tags: ['core'],
    summary: 'Sửa nhân sự (vai trò, chi nhánh, quản lý, khoá / mở khoá)',
    description: 'Gửi `If-Match: <version>` để tránh ghi đè thay đổi của người khác. Khoá tài khoản → đăng xuất mọi thiết bị.',
    access: { permission: 'core.users.manage' },
    request: { params: IdParams, body: UpdateUserBody },
    responses: { 200: { description: 'Sau khi sửa', schema: item(UserSchema) } },
    errorCodes: ['VERSION_CONFLICT', 'EMAIL_TAKEN', 'ROLE_NOT_ALLOWED', 'BRANCH_OUT_OF_SCOPE', 'MANAGER_INVALID', 'CANNOT_MANAGE_SELF'],
    handler: async ({ principal, params, body, req }) => ({
      data: await users.update(principal, params.id, body, ifMatchVersion(req), metaOf(req).ip),
    }),
  });

  route({
    method: 'post',
    path: '/core/users/:id/reset-password',
    tags: ['core'],
    summary: 'Cấp mật khẩu tạm mới',
    description: 'Trả mật khẩu tạm một lần, buộc đổi ở lần đăng nhập sau, đăng xuất mọi thiết bị.',
    access: { permission: 'core.users.manage' },
    request: { params: IdParams },
    responses: { 200: { description: 'Mật khẩu tạm', schema: item(PasswordResetResultSchema) } },
    errorCodes: ['ROLE_NOT_ALLOWED', 'CANNOT_MANAGE_SELF'],
    handler: async ({ principal, params, req }) => ({ data: await users.resetPassword(principal, params.id, metaOf(req).ip) }),
  });

  route({
    method: 'get',
    path: '/core/org-tree',
    tags: ['core'],
    summary: 'Cây quản lý',
    description: 'Danh sách phẳng kèm `managerId`; người có quản lý nằm ngoài phạm vi xem được hiển thị như gốc.',
    access: { permission: 'core.users.read' },
    request: { query: OrgTreeQuery },
    responses: { 200: { description: 'Thành viên', schema: item(z.array(OrgMemberSchema)) } },
    handler: async ({ principal, query }) => ({ data: await users.orgTree(principal, query) }),
  });
}
