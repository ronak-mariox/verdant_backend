import { createApp } from './app';
import { env } from './lib/env';
import { connectDb } from './lib/db';
import { ensureDefaultAdmin } from './lib/seedAdmin';

async function main() {
  await connectDb();
  await ensureDefaultAdmin();
  const app = createApp();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Verdant backend listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
