#!/usr/bin/env node
/**
 * Visual regression test.
 *
 *   1. build examples/demo.md
 *   2. screenshot every slide (print geometry, exactly 1024x768) into
 *      tests/visual/current/
 *   3. pixel-diff against tests/visual/baseline/
 *
 * First run (or --update) writes the baseline. Later runs fail when more than
 * 0.5% of pixels changed, so a stray margin edit cannot silently drift the
 * whole deck.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";
import sharp from "sharp";
import { exportCss } from "../../src/render/html.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = path.join(ROOT, "tests", "visual", "baseline");
const CURRENT = path.join(ROOT, "tests", "visual", "current");
const DIST = path.join(ROOT, "dist");

const UPDATE = process.argv.includes("--update");
const THRESHOLD = 0.005;
const PIXEL_DELTA = 24;

function build() {
  execFileSync(
    process.execPath,
    [path.join(ROOT, "bin", "slides.mjs"), "build", path.join("examples", "demo.md")],
    { stdio: "inherit", cwd: ROOT },
  );
}

async function capture() {
  await mkdir(CURRENT, { recursive: true });
  const shots = [];
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 768 },
      deviceScaleFactor: 1,
    });

    await page.goto(pathToFileURL(path.join(DIST, "index.html")).href, { waitUntil: "load" });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
    await page
      .waitForFunction(() => Array.from(document.images).every((img) => img.complete === true), null, {
        timeout: 15000,
      })
      .catch(() => {});

    await page.emulateMedia({ media: "screen" });
    await page.addStyleTag({ content: exportCss({ width: 1024, height: 768 }) });
    await page.waitForTimeout(180);

    const total = await page.evaluate(
      () => document.querySelectorAll(".reveal .slides > section").length,
    );

    for (let index = 1; index <= total; index += 1) {
      const handle = await page.$(`.reveal .slides > section:nth-of-type(${index})`);
      if (!handle) continue;
      const layout = (await handle.getAttribute("data-layout")) || "unknown";
      const data = await handle.screenshot({ type: "png" });
      const name = `${String(index).padStart(2, "0")}-${layout}.png`;
      await writeFile(path.join(CURRENT, name), data);
      shots.push({ name, data });
    }
  } finally {
    await browser.close();
  }

  return shots;
}

async function diff(currentBuffer, baselineBuffer) {
  const current = await sharp(currentBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const baseline = await sharp(baselineBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (current.info.width !== baseline.info.width || current.info.height !== baseline.info.height) {
    return { ratio: 1, mismatch: true };
  }

  const { width, height } = current.info;
  const total = width * height;
  const mask = Buffer.alloc(width * height * 4, 0);
  let changed = 0;

  for (let i = 0; i < current.data.length; i += 4) {
    const delta =
      Math.abs(current.data[i] - baseline.data[i]) +
      Math.abs(current.data[i + 1] - baseline.data[i + 1]) +
      Math.abs(current.data[i + 2] - baseline.data[i + 2]);

    if (delta > PIXEL_DELTA) {
      changed += 1;
      mask[i] = 255;
      mask[i + 1] = 0;
      mask[i + 2] = 0;
      mask[i + 3] = 170;
    }
  }

  return { ratio: changed / total, mask, width, height };
}

async function main() {
  build();
  const shots = await capture();
  await mkdir(BASELINE, { recursive: true });

  const existing = (await readdir(BASELINE)).filter((file) => file.endsWith(".png"));

  if (UPDATE || existing.length === 0) {
    for (const shot of shots) {
      await writeFile(path.join(BASELINE, shot.name), shot.data);
    }
    console.log(
      `\nBaseline ${UPDATE ? "updated" : "created"}: ${shots.length} screenshots in tests/visual/baseline/`,
    );
    return;
  }

  let failures = 0;

  for (const shot of shots) {
    const baselinePath = path.join(BASELINE, shot.name);

    if (!existsSync(baselinePath)) {
      failures += 1;
      console.log(`NEW    ${shot.name}  (no baseline; run with --update to accept)`);
      continue;
    }

    const baselineBuffer = await readFile(baselinePath);
    const result = await diff(shot.data, baselineBuffer);

    if (result.mismatch) {
      failures += 1;
      console.log(`SIZE   ${shot.name}  (dimensions changed)`);
      continue;
    }

    if (result.ratio > THRESHOLD) {
      failures += 1;
      console.log(`DIFF   ${shot.name}  ${(result.ratio * 100).toFixed(2)}% of pixels differ`);
      const maskPath = path.join(CURRENT, shot.name.replace(/\.png$/, ".diff.png"));
      await sharp(result.mask, {
        raw: { width: result.width, height: result.height, channels: 4 },
      })
        .png()
        .toFile(maskPath);
    } else {
      console.log(`OK     ${shot.name}`);
    }
  }

  console.log("");
  if (failures === 0) {
    console.log(`Visual regression passed: ${shots.length} slides match the baseline.`);
  } else {
    console.log(`Visual regression failed: ${failures}/${shots.length} slides changed.`);
    console.log("See tests/visual/current/ (and *.diff.png). Use --update to accept changes.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
