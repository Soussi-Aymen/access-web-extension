import * as fs from 'node:fs';
import * as path from 'node:path';
import { ZipArchive } from 'archiver';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const distDir = path.resolve('dist');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist directory does not exist. Run build first.');
  process.exit(1);
}

const outName = `${packageJson.name}-v${packageJson.version}.zip`;
const output = fs.createWriteStream(outName);
const archive = new ZipArchive({
  zlib: { level: 9 }
});

output.on('close', () => {
  console.log(`Created ${outName} (${archive.pointer()} total bytes)`);
});

archive.on('error', (err: unknown) => {
  throw err;
});

archive.pipe(output);
archive.directory(distDir, false);
archive.finalize();
