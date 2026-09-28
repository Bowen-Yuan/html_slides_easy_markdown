/**
 * PPTX export.
 *
 * The goal is visual parity with the HTML, not editable PowerPoint text.
 * Each slide becomes one 2x logical resolution PNG (2048x1536 for 4:3) placed
 * full-bleed on a 4:3 PowerPoint slide.
 */

import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import PptxGenJS from "pptxgenjs";
import { exportCss } from "../render/html.mjs";

const SCALE = 2;

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

/**
 * @param {{ htmlPath: string, outPath: string, width?: number, height?: number, shotDir?: string }} options
 * @returns {Promise<{ outPath: string, slides: number, shots: string[] }>}
 */
export async function exportPptx({
  htmlPath,
  outPath,
  width = 1024,
  height = 768,
  shotDir,
}) {
  await stat(htmlPath);

  const shotsDir = shotDir || path.join(path.dirname(outPath), ".pptx-shots");
  await mkdir(shotsDir, { recursive: true });

  const shots = [];
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: SCALE,
    });

    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await preparePage(page);

    // Use the exact same export geometry as the PDF so both match the HTML.
    await page.emulateMedia({ media: "screen" });
    await page.addStyleTag({ content: exportCss({ width, height }) });
    await page.waitForTimeout(180);

    const total = await page.evaluate(
      () => document.querySelectorAll(".reveal .slides > section").length,
    );

    for (let index = 0; index < total; index += 1) {
      const handle = await page.$(`.reveal .slides > section:nth-of-type(${index + 1})`);
      if (!handle) continue;

      const buffer = await handle.screenshot({ type: "png" });
      const file = path.join(shotsDir, `slide-${String(index + 1).padStart(3, "0")}.png`);
      await writeFile(file, buffer);
      shots.push(file);
    }
  } finally {
    await browser.close();
  }

  const aspect = width / height;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "GSE", width: 10, height: 10 / aspect });
  pptx.layout = "GSE";

  for (const file of shots) {
    const slide = pptx.addSlide();
    slide.addImage({ path: file, x: 0, y: 0, w: "100%", h: "100%" });
  }

  await pptx.writeFile({ fileName: outPath });

  if (!shotDir) {
    await rm(shotsDir, { recursive: true, force: true }).catch(() => {});
  }

  return { outPath, slides: shots.length, shots };
}
