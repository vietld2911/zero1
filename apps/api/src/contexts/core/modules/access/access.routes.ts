import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { metaOf } from '../auth/auth.routes.js';
import type { AccessService } from './access.service.js';
import { TEAMS } from './catalog.js';

const RoleSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    rank: z.number().int(),
    team: z.enum(TEAMS).openapi({ description: 'Quản lý / Kinh doanh / Vận hành / Học thuật' }),
    multiBranch: z.boolean().openapi({ description: 'Nhân sự ngoài cơ sở (gán nhiều chi nhánh). false = đúng một chi nhánh' }),
    managerRoles: z.array(z.string()).openapi({ description: 'Vai trò được làm quản lý trực tiếp' }),
    assignable: z.boolean().openapi({ description: 'Người gọi có gán được vai trò này cho người khác không' }),
    permissions: z.array(z.string()),
  })
  .openapi('Role');

const PermissionSchema = z
  .object({ code: z.string(), app: z.enum(['core', 'crm', 'lms']), description: z.string() })
  .openapi('Permission');

export function registerAccessRoutes(route: RouteRegistrar, access: AccessService) {
  route({
    method: 'get',
    path: '/core/roles',
    tags: ['core'],
    summary: 'Danh sách vai trò và quyền',
    access: { authenticated: true },
    responses: { 200: { description: 'Vai trò', schema: item(z.array(RoleSchema)) } },
    handler: async ({ principal }) => ({ data: await access.listRoles(principal) }),
  });

  route({
    method: 'get',
    path: '/core/permissions',
    tags: ['core'],
    summary: 'Danh mục quyền',
    access: { permission: 'core.roles.manage' },
    responses: { 200: { description: 'Quyền', schema: item(z.array(PermissionSchema)) } },
    handler: async () => ({ data: await access.listPermissions() }),
  });

  route({
    method: 'patch',
    path: '/core/roles/:code',
    tags: ['core'],
    summary: 'Đặt lại danh sách quyền của một vai trò',
    description: 'Thay toàn bộ quyền của vai trò bằng danh sách gửi lên. Có hiệu lực ngay với request tiếp theo.',
    access: { permission: 'core.roles.manage' },
    request: {
      params: z.object({ code: z.string().max(20) }),
      body: z.object({ permissions: z.array(z.string()).max(200) }),
    },
    responses: { 204: { description: 'Đã cập nhật' } },
    errorCodes: ['ADMIN_LOCKOUT'],
    async handler({ principal, params, body, req }) {
      await access.setRolePermissions(principal, params.code, body.permissions, metaOf(req).ip);
    },
  });
}
