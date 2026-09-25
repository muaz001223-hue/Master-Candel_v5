// Build artifact from the preserved frontend catalog; never market evidence.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const { transformWithOxc } = await import(require.resolve('vite'));
const source = fs.readFileSync(path.join(root, 'frontend/src/lib/markets.ts'), 'utf8');
const output = await transformWithOxc(source, 'markets.ts');
const catalog = await import('data:text/javascript;base64,' + Buffer.from(output.code).toString('base64'));
fs.writeFileSync(path.join(root, 'backend/demo_catalog.json'), JSON.stringify(catalog.MARKET_BY_ID, null, 2) + '\n');
console.log(`Exported ${catalog.markets.length} simulated catalog entries.`);