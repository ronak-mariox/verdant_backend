import mongoose from 'mongoose';
import { env } from './env';

mongoose.set('strictQuery', true);

export async function connectDb(): Promise<void> {
  let uri = env.mongoUri;

  if (uri === 'memory') {
    // Dev/CI-only convenience: downloads and runs a real local `mongod` binary in a
    // temp directory — no system-wide MongoDB install required. Data does NOT
    // persist across restarts. Set a real MONGODB_URI in .env to use a persistent
    // database (a local `mongod`, or a MongoDB Atlas connection string).
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mem = await MongoMemoryServer.create({ binary: { version: '4.4.29' } });
    uri = mem.getUri();
    // eslint-disable-next-line no-console
    console.log(`[db] Using an ephemeral in-memory MongoDB instance (dev only): ${uri}`);
  }

  await mongoose.connect(uri);
  // eslint-disable-next-line no-console
  console.log(`Connected to MongoDB: ${redactCredentials(uri)}`);
}

/** Never log a connection string's credentials verbatim — masks the `user:pass@` portion. */
function redactCredentials(uri: string): string {
  return uri.replace(/\/\/([^:/@]+):([^@/]+)@/, '//$1:****@');
}

export { mongoose };
