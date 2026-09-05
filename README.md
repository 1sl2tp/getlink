# BHX Product Getter — GitHub Ready

Upload this folder to `1sl2tp/getlink` on `main`.

## Pages
GitHub → Settings → Pages → Source: **GitHub Actions**.

## Run scraper
GitHub → Actions → **Scrape BHX category** → **Run workflow** → enter a BHX category URL.

The action runs Python + Playwright/Chromium and commits `data/products.json` and `data/products.csv` back to `main`. The Pages UI reads the latest JSON.

## Important
GitHub Pages itself is static. The scraper is a GitHub Actions job, not a permanently running Python API. This version intentionally does not attempt CAPTCHA/anti-bot bypassing or IP rotation.

## Next upgrade
The scraper records BHX same-site JSON response URLs so the next version can parse the actual Next.js/API payload directly and reduce product-page requests.
