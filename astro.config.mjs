import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://baliwesttransport.com';

// Priority/changefreq rules mirror CLAUDE.md's sitemap policy:
// Home > hub/service pages > about, with the ID locale one tier below its EN counterpart.
function classify(pathname) {
  const isID = pathname.startsWith('/id/');
  const path = isID ? pathname.replace(/^\/id/, '') || '/' : pathname;

  if (path === '/') return { changefreq: 'weekly', priority: isID ? 0.9 : 1.0 };
  if (path === '/about/') return { changefreq: 'monthly', priority: 0.7 };
  if (/^\/blog\/?$/.test(path)) return { changefreq: 'weekly', priority: isID ? 0.7 : 0.8 };
  if (/^\/blog\/[^/]+\/$/.test(path)) return { changefreq: 'monthly', priority: isID ? 0.6 : 0.7 };
  if (/^\/(transfers|tours|airport-transfer)\/?$/.test(path)) return { changefreq: 'weekly', priority: isID ? 0.8 : 0.9 };
  if (/^\/(transfers|airport-transfer)\/[^/]+\/$/.test(path)) return { changefreq: 'weekly', priority: isID ? 0.8 : 0.9 };

  return { changefreq: 'monthly', priority: isID ? 0.6 : 0.7 };
}

// Writes dist/sitemap.xml directly (same URL/filename that's already submitted in
// Search Console) generated from the pages Astro actually built, instead of a
// hand-maintained public/sitemap.xml that silently drifts out of sync.
function sitemapIntegration() {
  return {
    name: 'bwt-sitemap',
    hooks: {
      'astro:build:done': async ({ dir, pages }) => {
        const lastmod = new Date().toISOString().slice(0, 10);
        const urls = pages
          .map((p) => '/' + p.pathname)
          .filter((pathname) => !pathname.includes('404') && !pathname.startsWith('/admin/'))
          .sort();

        const body = urls
          .map((pathname) => {
            const { changefreq, priority } = classify(pathname);
            return `  <url>\n    <loc>${SITE}${pathname}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
          })
          .join('\n');

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
        writeFileSync(fileURLToPath(new URL('sitemap.xml', dir)), xml);
      }
    }
  };
}

export default defineConfig({
  site: SITE,
  trailingSlash: 'always',
  // Pages stay static; only /api/media/* (the owner's media uploader) runs as functions.
  adapter: vercel({ maxDuration: 60 }),
  integrations: [tailwind(), sitemapIntegration()],
  vite: {
    // jsquash loads its WASM via import.meta.url, which Vite's dep pre-bundling breaks in dev
    optimizeDeps: { exclude: ['@jsquash/webp'] },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'id'],
    routing: {
      prefixDefaultLocale: false
    }
  }
});
