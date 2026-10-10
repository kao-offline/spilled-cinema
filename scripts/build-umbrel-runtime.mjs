import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = resolve(process.argv[2] || 'infra/umbrel/artifacts/server');
await mkdir(destination, { recursive: true });
await build({
  entryPoints: ['apps/server/src/standalone.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@node-rs/argon2', 'node-datachannel', 'ws', 'localtunnel', 'sharp'],
  banner: { js: "import { createRequire as createBundleRequire } from 'node:module'; const require = createBundleRequire(import.meta.url);" },
  outfile: resolve(destination, 'standalone.mjs'),
});
await copyFile('infra/umbrel/Dockerfile.server', resolve(destination, 'Dockerfile'));
await copyFile('infra/umbrel/runtime-package.json', resolve(destination, 'package.json'));
await copyFile('infra/umbrel/runtime-package-lock.json', resolve(destination, 'package-lock.json'));
console.log(`Runtime build context: ${destination}`);
