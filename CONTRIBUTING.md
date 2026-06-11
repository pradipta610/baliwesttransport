# Developer Rules — Preventing GSC Indexing Issues

## 1. Trailing Slash — Always

Every internal `href` must end with `/`. No exceptions for page URLs.

```html
<!-- correct -->
<a href="/transfers/">Transfers</a>
<a href="/about/">About</a>
<a href="/id/transfers/gilimanuk-to-ubud/">Transfer</a>

<!-- wrong -->
<a href="/transfers">Transfers</a>
<a href="/about">About</a>
```

Asset paths (`.svg`, `.png`, `.jpg`, `.ico`, `.xml`) do not need a trailing slash.

Before committing, run this to catch any violations:

```
grep -rn 'href="/' src/ | grep -v 'href="//' | grep -Ev 'href="/[^"]*/"' | grep -Ev '\.(svg|png|jpg|jpeg|webp|ico|xml|txt|pdf|js|css)'
```

The output should be empty.

---

## 2. New Page Checklist

Every new page requires all four of these before the PR is merged:

### a) Create both EN and ID versions
```
src/pages/[page].astro
src/pages/id/[page].astro
```

### b) Add 301 redirect in `vercel.json`
Add entries for both the EN and ID no-slash → trailing-slash redirect.

```json
{ "source": "/[page]",     "destination": "/[page]/",     "permanent": true },
{ "source": "/id/[page]",  "destination": "/id/[page]/",  "permanent": true }
```

For nested routes (e.g. `/transfers/route-name`), add the redirect for the full path.

### c) Add to `public/sitemap.xml`
Add both EN and ID URLs with trailing slashes. Use today's date for `<lastmod>`.

```xml
<url>
  <loc>https://baliwesttransport.com/[page]/</loc>
  <lastmod>YYYY-MM-DD</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.9</priority>
</url>
<url>
  <loc>https://baliwesttransport.com/id/[page]/</loc>
  <lastmod>YYYY-MM-DD</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.8</priority>
</url>
```

### d) Internal links on the new page must use trailing slashes
Check every `href` in the new file before committing.

---

## 3. Canonical URL

The layout (`src/layouts/Layout.astro`) automatically generates the canonical tag with a trailing slash from `Astro.url.pathname`. Do not override or hardcode canonical URLs in individual pages.

---

## 4. sitemap.xml — Manual File

`public/sitemap.xml` is maintained manually. The `@astrojs/sitemap` integration is **not** used.

Update `public/sitemap.xml` every time a page is added, removed, or significantly updated. Never leave a live page out of the sitemap.

Priority guide:

| Page type | EN priority | ID priority |
|---|---|---|
| Home | 1.0 | 0.9 |
| Hub / category | 0.9 | 0.8 |
| Transfer route / service | 0.9 | 0.8 |
| About / static | 0.7 | 0.7 |

---

## 5. vercel.json — Redirects

`vercel.json` contains all 301 redirects. The www → apex redirect is already configured and should not be removed.

When adding redirects, always use `"permanent": true` for URL consolidation. Use `"permanent": false` only for temporary redirects (e.g. A/B tests).

---

## 6. robots.txt

`public/robots.txt` must not disallow any page routes, including `/id/` pages. The sitemap entry must stay as:

```
Sitemap: https://baliwesttransport.com/sitemap.xml
```

Do not modify this file unless explicitly required.

---

## 7. Quick Pre-Deploy Checklist

- [ ] All `href` internal links end with `/`
- [ ] New pages have a redirect entry in `vercel.json`
- [ ] New pages are in `public/sitemap.xml` with correct priority and today's date
- [ ] Both EN and ID versions exist for every page
- [ ] `npm run build` passes with zero errors
