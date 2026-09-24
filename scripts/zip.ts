import * as fs from 'node:fs';
import * as path from 'node:path';
import { ZipArchive } from 'archiver';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const distDir = path.resolve('dist');

// Ensure public/manifest.json matches package.json version
const manifestPath = path.resolve('public/manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (manifest.version !== packageJson.version) {
    manifest.version = packageJson.version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Synced public/manifest.json version to ${packageJson.version}`);
  }
}

// Ensure dist/manifest.json matches package.json version if dist exists
const distManifestPath = path.resolve('dist/manifest.json');
if (fs.existsSync(distManifestPath)) {
  const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf-8'));
  if (distManifest.version !== packageJson.version) {
    distManifest.version = packageJson.version;
    fs.writeFileSync(distManifestPath, JSON.stringify(distManifest, null, 2) + '\n');
    console.log(`Synced dist/manifest.json version to ${packageJson.version}`);
  }
}

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
