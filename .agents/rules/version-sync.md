# Version Synchronization Rule

## Always Sync Versions Before Commit and Zip
1. Whenever the extension version is bumped or changes are prepared for commit or zipping, ensure all of the following are in sync:
   - `package.json` (`version`)
   - `public/manifest.json` (`version`)
   - `dist/manifest.json` (`version`)
2. Before packaging or unzipping, always run `pnpm sync:version` (or `pnpm build`) to guarantee that `dist/manifest.json` and `public/manifest.json` match `package.json` version.
3. The popup UI displays the version dynamically via `chrome.runtime.getManifest().version`, ensuring the UI and Chrome extension loader always reflect the actual version.
