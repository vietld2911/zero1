import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

export { OpenAPIRegistry };

export function createOpenApiRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Access token từ POST /api/v1/core/auth/login, hoặc API key (zk_live_...) cho hệ thống ngoài.',
  });
  return registry;
}

export function buildOpenApiDocument(registry: OpenAPIRegistry) {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Zero1 API',
      version: '1.0.0',
      description:
        'API của Zero1 gồm 3 phần: **core** (đăng nhập, tổ chức, chấm công), **crm** (tuyển sinh, học viên, tài chính), **lms** (lớp học, điểm danh, bài tập).\n\n' +
        'Quy ước chung: xem docs/api-conventions.md. Lỗi trả về theo RFC 7807 (`application/problem+json`) với `code` cố định.',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'system', description: 'Tình trạng hệ thống' },
      { name: 'core', description: 'Đăng nhập, người dùng, chi nhánh, chấm công' },
      { name: 'crm', description: 'Tuyển sinh, học viên, học phí, báo cáo kinh doanh' },
      { name: 'lms', description: 'Chương trình học, lớp, buổi, điểm danh, bài tập' },
    ],
  });
}
