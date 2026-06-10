// The root package.json is `"type": "module"` (for Vite), but the backend is
// compiled to CommonJS. Drop a nested package.json into the build output so Node
// treats dist/server/**/*.js as CommonJS regardless of the root setting.
import { writeFileSync } from 'node:fs';

writeFileSync('dist/server/package.json', JSON.stringify({ type: 'commonjs' }) + '\n');
console.log('[build] wrote dist/server/package.json ({"type":"commonjs"})');
