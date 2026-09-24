import * as fs from 'node:fs';
import * as path from 'node:path';

const packageJsonPath = path.resolve('package.json');
const manifestPath = path.resolve('public/manifest.json');
const distManifestPath = path.resolve('dist/manifest.json');

if (!fs.existsSync(packageJsonPath)) {
  console.error('package.json not found');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (manifest.version !== version) {
    manifest.version = version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Synced public/manifest.json version to ${version}`);
  }
}

if (fs.existsSync(distManifestPath)) {
  const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf-8'));
  if (distManifest.version !== version) {
    distManifest.version = version;
    fs.writeFileSync(distManifestPath, JSON.stringify(distManifest, null, 2) + '\n');
    console.log(`Synced dist/manifest.json version to ${version}`);
  }
}
