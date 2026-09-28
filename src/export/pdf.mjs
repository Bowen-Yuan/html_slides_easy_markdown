/**
 * PDF export.
 *
 * Strategy: load the built, offline HTML in Chromium, switch to the theme's
 * print layout (which reproduces the 1024x768 logical page exactly), then print
 * one slide per PDF page with `preferCSSPageSize` honouring `@page`.
 */

import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import { exportCss } from "../render/html.mjs";

async function preparePage(page) {
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await page
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete === true), null, {
      timeout: 15000,
    })
    .catch(() => {});
  await page
    .waitForFunction(
      () => window.Reveal && typeof window.Reveal.isReady === "function" && window.Reveal.isReady(),
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  await page.waitForTimeout(120);
}

/** Cheap structural page count (works for Chromium PDFs). */
async function countPdfPages(filePath) {
  const buffer = await readFile(filePath);
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

/**
 * @param {{ htmlPath: string, outPath: string, width?: number, height?: number, slideCount?: number }} options
 * @returns {Promise<{ outPath: string, pages: number|null }>}
 */
export async function exportPdf({ htmlPath, outPath, width = 1024, height = 768, slideCount = 0 }) {
  await stat(htmlPath);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });

    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await preparePage(page);

    await page.emulateMedia({ media: "screen" });
    await page.addStyleTag({ content: exportCss({ width, height }) });
    await page.waitForTimeout(150);

    await page.pdf({
      path: outPath,
      width: `${width}px`,
      height: `${height}px`,
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  let pages = null;
  try {
    pages = await countPdfPages(outPath);
  } catch {
    pages = null;
  }

  return { outPath, pages };
}
