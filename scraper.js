import puppeteer from 'puppeteer';
import fs from 'fs-extra';
import path from 'path';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const visited = new Set();
const baseUrl = 'https://google.com';
const outputDir = './site';
const delay = ms => new Promise(res => setTimeout(res, ms));

async function downloadResource(url, folderPath) {
  const filename = path.basename(new URL(url).pathname);
  const filePath = path.join(folderPath, filename);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}`);

    const buffer = await res.buffer();
    await fs.outputFile(filePath, buffer);
    console.log(`✅ Downloaded: ${url}`);
  } catch (err) {
    console.warn(`❌ Error downloading ${url}: ${err.message}`);
  }
}

async function extractAndDownloadAssets(html, pageUrl) {
  const $ = cheerio.load(html);
  const assets = [];

  const selectors = [
    'link[href]',
    'script[src]',
    'img[src]',
    'video source[src]',
    'source[src]',
  ];

  selectors.forEach(sel => {
    $(sel).each((_, el) => {
      const attr = el.attribs.src || el.attribs.href;
      if (!attr) return;

      let url = attr.startsWith('http') ? attr : new URL(attr, pageUrl).href;
      assets.push(url);
    });
  });

  const assetFolder = path.join(outputDir, new URL(pageUrl).pathname);
  await Promise.all(assets.map(url => downloadResource(url, assetFolder)));
}

async function scrapePage(page, url) {
  if (visited.has(url)) return;
  visited.add(url);

  try {
    console.log(`🌐 Visiting: ${url}`);
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    if (!response || !response.ok()) throw new Error(`Page failed with status: ${response?.status()}`);

    await delay(2000); // allow dynamic content to load
    const html = await page.content();

    const filePath = path.join(outputDir, new URL(url).pathname, 'index.html');
    await fs.outputFile(filePath, html);
    console.log(`💾 Saved HTML: ${filePath}`);

    await extractAndDownloadAssets(html, url);

    // Recursively find internal links
    const $ = cheerio.load(html);
    const links = $('a[href]')
      .map((_, el) => el.attribs.href)
      .get()
      .filter(href => href.startsWith('/en') && !href.includes('#'));

    for (const link of links) {
      const nextUrl = new URL(link, baseUrl).href;
      await scrapePage(page, nextUrl);
    }
  } catch (err) {
    console.error(`❌ Failed to scrape ${url}: ${err.message}`);
  }
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  page.on('error', err => console.error('💥 Page crashed:', err));
  page.on('pageerror', err => console.error('📛 Page error:', err));

  await scrapePage(page, `${baseUrl}/en`);

  await browser.close();
})();
