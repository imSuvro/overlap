import { startOverlapServer } from './server.js';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);

const server = await startOverlapServer({ port });
console.log(`Overlap dev server listening on ${server.httpUrl}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => {
      process.exit(0);
    });
  });
}
