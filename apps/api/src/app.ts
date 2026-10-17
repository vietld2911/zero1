import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { apiReference } from '@scalar/express-api-reference';
import type { Env } from './platform/env.js';
import type { Logger } from './platform/logger.js';
import { requestId } from './platform/http/request-id.js';
import { createErrorHandler, notFoundHandler } from './platform/http/error-handler.js';
import { createRouteRegistrar, type Guards, type RouteRegistrar } from './platform/http/route.js';
import { registerHealthRoute, type HealthChecks } from './platform/http/health.js';
import { buildOpenApiDocument, createOpenApiRegistry } from './platform/openapi/registry.js';

export type { RouteRegistrar };

export interface AppDeps {
  env: Pick<Env, 'CORS_ORIGINS'> & Partial<Pick<Env, 'TRUST_PROXY'>>;
  logger: Logger;
  version: string;
  healthChecks: HealthChecks;
  guards?: Guards;
  /** Mỗi context đăng ký route của mình qua đây. */
  registerRoutes?: (route: RouteRegistrar) => void;
  /** Thư mục file tải lên (lưu trên đĩa) phục vụ tại /files. */
  uploadDir?: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  if (deps.env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (_req, res) => String(res.getHeader('x-request-id')),
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      // Một dòng mỗi request; 4xx là phản hồi bình thường (chưa đăng nhập, sai dữ liệu) nên không coi là lỗi server.
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
      customSuccessMessage: (req, res, ms) => `${req.method} ${req.url} → ${res.statusCode} (${Math.round(ms)}ms)`,
      customErrorMessage: (req, res) => `${req.method} ${req.url} → ${res.statusCode}`,
      serializers: { req: (req: { id: unknown }) => ({ id: req.id }), res: () => undefined },
    }),
  );

  const registry = createOpenApiRegistry();
  const api = express.Router();
  const route = createRouteRegistrar(api, registry, deps.guards);
  registerHealthRoute(route, deps.healthChecks, deps.version);
  deps.registerRoutes?.(route);
  const openApiDocument = buildOpenApiDocument(registry);

  // Trang tài liệu tải script từ CDN nên đặt trước helmet (CSP chặt cho phần còn lại).
  app.get('/api/v1/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use('/docs', apiReference({ url: '/api/v1/openapi.json', pageTitle: 'Zero1 API' }));

  if (deps.uploadDir) {
    // Đường dẫn file có phần ngẫu nhiên 128 bit — công khai để thẻ <img>/link tải dùng được (không gửi được token).
    app.use(
      '/files',
      express.static(deps.uploadDir, {
        immutable: true,
        maxAge: '365d',
        index: false,
        setHeaders: (res) => {
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
        },
      }),
    );
  }

  app.use(helmet());
  app.use(cors({ origin: deps.env.CORS_ORIGINS, credentials: true, exposedHeaders: ['x-request-id'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));

  app.locals.openApiDocument = openApiDocument;
  return app;
}
