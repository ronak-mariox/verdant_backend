import { connectDb, mongoose } from '../src/lib/db';
import { ensureDefaultAdmin } from '../src/lib/seedAdmin';

async function main() {
  await connectDb();
  await ensureDefaultAdmin();
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
