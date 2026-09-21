import { copyFile } from 'node:fs/promises';
import { URL } from 'node:url';

// GitHub Pages has no configurable SPA rewrite. Its custom 404 document can
// boot the same client bundle, after which BrowserRouter handles the URL.
await copyFile(
  new URL('../dist/index.html', import.meta.url),
  new URL('../dist/404.html', import.meta.url),
);
