import { preview } from 'vite';

const port = Number(process.env.PORT || 5173);
const server = await preview({
  clearScreen: false,
  preview: {
    host: '0.0.0.0',
    port,
    strictPort: true
  }
});

server.printUrls();

let shuttingDown = false;

server.httpServer?.once('close', () => {
  if (shuttingDown) return;
  console.error('[remote-editor] HTTP server closed unexpectedly.');
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    shuttingDown = true;
    await server.close();
    process.exit(0);
  });
}

process.on('uncaughtException', (error) => {
  console.error('[remote-editor] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('[remote-editor] Unhandled rejection:', error);
  process.exit(1);
});
