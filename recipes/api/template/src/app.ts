import { Hono } from 'hono';
import { health } from './routes/health.js';

const app = new Hono();

app.route('/health', health);

app.onError((err, c) => {
  return c.json({ error: err.message }, 500);
});

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

export { app };
