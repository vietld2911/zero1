import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/** Toàn bộ API import `z` từ đây để `.openapi()` luôn khả dụng. */
export { z };
