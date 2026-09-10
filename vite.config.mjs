import { createLogger, defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ROOT, 'dist');

// Application scripts intentionally remain classic scripts because they share
// browser globals. copyClassicAssets() packages them unchanged for web/APK.
// Hide only Vite's module-conversion warning; all other warnings still surface.
const logger = createLogger();
const defaultWarn = logger.warn.bind(logger);
logger.warn = (message, options) => {
  if (String(message).includes('can\'t be bundled without type="module" attribute')) return;
  defaultWarn(message, options);
};

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);

    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyIfMissing(src, dest) {
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }
}

function ensureImageFallbacks(imagesDest) {
  copyIfMissing(
    path.join(imagesDest, 'default-product.png'),
    path.join(imagesDest, 'placeholder.png')
  );
  copyIfMissing(
    path.join(imagesDest, 'home.png'),
    path.join(imagesDest, 'banner.jpg')
  );
}

function copyClassicAssets() {
  return {
    name: 'copy-classic-assets',
    closeBundle() {
      const excludeDirs = new Set(['node_modules', '.git', '.vite', 'dist', 'android']);

      function walk(dir, rel = '') {
        for (const item of fs.readdirSync(dir)) {
          if (excludeDirs.has(item)) continue;
          const abs = path.join(dir, item);
          const relPath = rel ? `${rel}/${item}` : item;

          if (fs.statSync(abs).isDirectory()) {
            walk(abs, relPath);
          } else if (item.endsWith('.js')) {
            const dest = path.join(DIST, relPath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(abs, dest);
          }
        }
      }

      walk(ROOT);

      const imagesDir = path.join(ROOT, 'images');
      const rootImages = path.join(DIST, 'images');
      const assetImages = path.join(DIST, 'assets', 'images');
      copyDir(imagesDir, rootImages);
      copyDir(imagesDir, assetImages);
      ensureImageFallbacks(rootImages);
      ensureImageFallbacks(assetImages);
      for (const legacyName of ['home.png', 'default-store.png', 'default-product.png']) {
        fs.rmSync(path.join(rootImages, legacyName), { force: true });
        fs.rmSync(path.join(assetImages, legacyName), { force: true });
      }
    }
  };
}

export default defineConfig({
  root: ROOT,
  customLogger: logger,
  build: {
    outDir: DIST,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(ROOT, 'index.html'),
        products: path.resolve(ROOT, 'products.html'),
        cart: path.resolve(ROOT, 'cart.html'),
        discount: path.resolve(ROOT, 'discount.html'),
        'kot-management': path.resolve(ROOT, 'kot-management.html'),
        'order-history': path.resolve(ROOT, 'order-history.html'),
        thankyou: path.resolve(ROOT, 'thankyou.html'),
        'access-denied': path.resolve(ROOT, 'access-denied.html')
      }
    }
  },
  plugins: [copyClassicAssets()],
  server: {
    port: 5173,
    open: '/index.html'
  }
});
