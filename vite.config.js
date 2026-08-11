import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';

const LEVEL_IDS = new Set(['level5', 'level8', 'level9', 'level10', 'level13', 'level15', 'level16']);

export default defineConfig({
  plugins: [{
    name: 'playable-level-selection',
    configureServer(server) {
      server.middlewares.use('/__playable-level', (request, response, next) => {
        if (request.method !== 'POST') return next();
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
          body += chunk;
          if (body.length > 64) request.destroy();
        });
        request.on('end', async () => {
          const levelId = body.trim();
          if (!LEVEL_IDS.has(levelId)) {
            response.statusCode = 400;
            response.end('Unknown level');
            return;
          }
          await writeFile(path.resolve('artifacts', 'selected-level.txt'), `${levelId}\n`, 'utf8');
          response.statusCode = 204;
          response.end();
        });
      });
    }
  }]
});
