import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import type { ZodObject, ZodType, z } from 'zod';
import type { OpenAPIRegistry } from '../openapi/registry.js';
import { ProblemSchema } from './schemas.js';
import { Errors, type FieldError } from './errors.js';
import type { ParentPrincipal, Principal } from '../auth/principal.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Gắn bởi guards.authenticate. */
    principal?: Principal;
    /** Gắn bởi guards.authenticateParent. */
    parent?: ParentPrincipal;
  }
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

type Access =
  | { public: true }
  /** Mọi người đã đăng nhập (ví dụ: xem hồ sơ của mình). */
  | { authenticated: true }
  /** Permission theo docs/roles-permissions.md, ví dụ `crm.leads.read`. */
  | { permission: string }
  /** Chỉ tài khoản phụ huynh (API phụ huynh). */
  | { parent: true };

interface ResponseSpec {
  description: string;
  schema?: ZodType;
  /** Response là file (vd: application/vnd.openxmlformats-officedocument.wordprocessingml.document). */
  fileType?: string;
}

type Infer<T> = T extends ZodType ? z.output<T> : undefined;

export interface RouteSpec<
  P extends ZodObject | undefined,
  Q extends ZodObject | undefined,
  B extends ZodType | undefined,
> {
  method: Method;
  /** Đường dẫn kiểu Express, tính từ /api/v1. Ví dụ `/crm/leads/:id`. */
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  access: Access;
  request?: { params?: P; query?: Q; body?: B };
  /** Mã thành công đầu tiên được dùng làm status mặc định. */
  responses: Record<number, ResponseSpec>;
  /** Mã lỗi nghiệp vụ endpoint có thể trả (ghi vào tài liệu). */
  errorCodes?: string[];
  /** Middleware chạy trước xác thực (ví dụ giới hạn tần suất). */
  middlewares?: RequestHandler[];
  /**
   * Nhận file multipart (chạy SAU xác thực, nên người lạ không đẩy được file lên).
   * `request.body` khi đó mô tả các trường text đi kèm.
   */
  upload?: { handler: RequestHandler; field: string; description: string };
  handler: (ctx: {
    params: Infer<P>;
    query: Infer<Q>;
    body: Infer<B>;
    /** Người gọi đã xác thực. Truy cập ở route công khai sẽ ném 401. */
    principal: Principal;
    /** Phụ huynh đã xác thực (route `access: { parent: true }`). */
    parent: ParentPrincipal;
    req: Request;
    res: Response;
  }) => Promise<unknown> | unknown;
}

export interface Guards {
  authenticate: RequestHandler;
  authorize: (permission: string) => RequestHandler;
  /** Xác thực token phụ huynh (khác token nhân sự). */
  authenticateParent?: RequestHandler;
}

const API_PREFIX = '/api/v1';

/**
 * Khai báo route một lần: vừa gắn vào Express, vừa sinh tài liệu OpenAPI,
 * nên tài liệu không thể lệch khỏi code (docs/api-conventions.md §8).
 */
export function createRouteRegistrar(router: Router, registry: OpenAPIRegistry, guards?: Guards) {
  return function route<
    P extends ZodObject | undefined = undefined,
    Q extends ZodObject | undefined = undefined,
    B extends ZodType | undefined = undefined,
  >(spec: RouteSpec<P, Q, B>) {
    const isPublic = 'public' in spec.access;
    if (!isPublic && !guards) {
      // Chặn ngay lúc khởi động: không endpoint nào vô tình bị mở công khai.
      throw new Error(`Route ${spec.method.toUpperCase()} ${spec.path} cần xác thực nhưng chưa cấu hình guards`);
    }

    document(registry, spec, isPublic);

    const successStatus = Number(Object.keys(spec.responses).find((s) => Number(s) < 400) ?? 200);
    const middlewares: RequestHandler[] = [...(spec.middlewares ?? [])];
    if ('parent' in spec.access) {
      if (!guards?.authenticateParent) throw new Error(`Route ${spec.method.toUpperCase()} ${spec.path} cần guards.authenticateParent`);
      middlewares.push(guards.authenticateParent);
    } else if (!isPublic && guards) {
      middlewares.push(guards.authenticate);
      if ('permission' in spec.access) middlewares.push(guards.authorize(spec.access.permission));
    }
    if (spec.upload) middlewares.push(spec.upload.handler);

    middlewares.push(async (req: Request, res: Response, _next: NextFunction) => {
      const params = parse(spec.request?.params, req.params, 'params');
      const query = parse(spec.request?.query, req.query, 'query');
      const body = parse(spec.request?.body, req.body, 'body');
      const ctx = {
        params,
        query,
        body,
        req,
        res,
        get principal(): Principal {
          if (!req.principal) throw Errors.unauthenticated();
          return req.principal;
        },
        get parent(): ParentPrincipal {
          if (!req.parent) throw Errors.unauthenticated();
          return req.parent;
        },
      };
      const result = await spec.handler(ctx as never);
      if (res.headersSent) return;
      if (result === undefined) {
        res.status(successStatus === 200 ? 204 : successStatus).end();
      } else {
        res.status(successStatus).json(result);
      }
    });

    router[spec.method](spec.path, ...middlewares);
  };
}

function parse(schema: ZodType | undefined, value: unknown, location: string) {
  if (!schema) return undefined;
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const errors: FieldError[] = result.error.issues.map((i) => ({
    path: [location, ...i.path.map(String)].join('.'),
    message: i.message,
  }));
  throw Errors.validation(errors);
}

const problemResponse = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: ProblemSchema } },
});

function document(
  registry: OpenAPIRegistry,
  spec: RouteSpec<ZodObject | undefined, ZodObject | undefined, ZodType | undefined>,
  isPublic: boolean,
) {
  const responses: Record<string, unknown> = {};
  for (const [status, r] of Object.entries(spec.responses)) {
    responses[status] = r.fileType
      ? { description: r.description, content: { [r.fileType]: { schema: { type: 'string', format: 'binary' } } } }
      : r.schema
        ? { description: r.description, content: { 'application/json': { schema: r.schema } } }
        : { description: r.description };
  }
  if (spec.request && (spec.request.params || spec.request.query || spec.request.body)) {
    responses['400'] ??= problemResponse('Dữ liệu không hợp lệ (`VALIDATION_ERROR`)');
  }
  if (!isPublic) {
    responses['401'] ??= problemResponse('Chưa đăng nhập hoặc token hết hạn');
    responses['403'] ??= problemResponse('Không có quyền');
  }
  responses['500'] ??= problemResponse('Lỗi hệ thống');

  const access =
    'permission' in spec.access
      ? `**Quyền:** \`${spec.access.permission}\``
      : 'authenticated' in spec.access
        ? '**Cần đăng nhập** (nhân sự hoặc API key)'
        : 'parent' in spec.access
          ? '**Tài khoản phụ huynh** (token từ `/parent/auth/*`)'
          : '**Công khai**';
  const errorCodes = spec.errorCodes?.length ? `\n\n**Mã lỗi nghiệp vụ:** ${spec.errorCodes.map((c) => `\`${c}\``).join(', ')}` : '';

  registry.registerPath({
    method: spec.method,
    path: API_PREFIX + spec.path.replace(/:(\w+)/g, '{$1}'),
    tags: spec.tags,
    summary: spec.summary,
    description: [spec.description, access].filter(Boolean).join('\n\n') + errorCodes,
    security: isPublic ? [] : [{ bearerAuth: [] }],
    request: {
      params: spec.request?.params,
      query: spec.request?.query,
      body: spec.upload
        ? {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  allOf: [
                    ...(spec.request?.body ? [spec.request.body] : []),
                    {
                      type: 'object',
                      required: [spec.upload.field],
                      properties: { [spec.upload.field]: { type: 'string', format: 'binary', description: spec.upload.description } },
                    },
                  ],
                } as never,
              },
            },
          }
        : spec.request?.body
          ? { content: { 'application/json': { schema: spec.request.body } }, required: true }
          : undefined,
    },
    responses: responses as never,
  });
}

export type RouteRegistrar = ReturnType<typeof createRouteRegistrar>;
