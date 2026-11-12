import { buildApp } from './app';
import { config } from './config';
import { db } from './db';

async function main() {
  const app = await buildApp();
  const close = async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  await app.listen({ port: config.port, host: config.host });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
