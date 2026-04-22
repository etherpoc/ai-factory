import { serve } from '@hono/node-server';
import { app } from './app.js';

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
    process.stdout.write(`Server running on http://localhost:${info.port}\n`);
  });
}

export { app };
