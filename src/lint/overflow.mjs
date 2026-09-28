/**
 * Overflow linter + automatic layout selection.
 *
 * We do not estimate overflow from character counts. Every candidate layout is
 * rendered in real Chromium and measured:
 *
 *     scrollHeight <= clientHeight && scrollWidth <= clientWidth
 *
 * The first candidate that fits wins. If none fits, the build fails loudly.
 * Font size is never reduced.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import { renderProbeDocument } from "../render/html.mjs";

const DEFAULT_TIMEOUT = 30000;

/** Runs inside the browser. Must stay self-contained. */
function measureAll() {
  const sections = Array.from(document.querySelectorAll("section[data-probe]"));

  const overflowOf = (el, axis) => {
    if (!el) return 0;
    return axis === "y"
      ? Math.max(0, el.scrollHeight - el.clientHeight)
      : Math.max(0, el.scrollWidth - el.clientWidth);
  };

  return sections.map((section) => {
    const parts = { code: 0, heading: 0, image: 0, list: 0, quote: 0 };

    for (const el of section.querySelectorAll("pre code")) {
      parts.code = Math.max(parts.code, overflowOf(el, "y"));
    }
    for (const el of section.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      // Horizontal only: a heading's line box may overshoot vertically by a
      // few sub-pixels, which is not a layout failure.
      parts.heading = Math.max(parts.heading, overflowOf(el, "x"));
    }
    for (const el of section.querySelectorAll("img")) {
      parts.image = Math.max(parts.image, overflowOf(el, "y"), overflowOf(el, "x"));
    }
    for (const el of section.querySelectorAll("ul, ol")) {
      parts.list = Math.max(parts.list, overflowOf(el, "y"));
    }
    for (const el of section.querySelectorAll("blockquote")) {
      parts.quote = Math.max(parts.quote, overflowOf(el, "y"));
    }

    return {
      key: section.getAttribute("data-probe"),
      layout: section.getAttribute("data-layout"),
      overflowX: overflowOf(section, "x"),
      overflowY: overflowOf(section, "y"),
      scrollHeight: section.scrollHeight,
      clientHeight: section.clientHeight,
      scrollWidth: section.scrollWidth,
      clientWidth: section.clientWidth,
      parts,
    };
  });
}

async function waitForLayout(page) {
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await page
    .waitForFunction(
      () => Array.from(document.images).every((img) => img.complete === true),
      null,
      { timeout: 10000 },
    )
    .catch(() => {
      /* a broken image must not hang the build; it is reported elsewhere */
    });
  await page.waitForTimeout(60);
}

/**
 * Render every candidate for every slide and measure it.
 *
 * @param {object} doc
 * @param {{ candidatesBySlide?: Map<number,string[]>, probeDir: string }} options
 * @returns {Promise<{ resolutions: Array<object>, probePath: string }>}
 */
export async function probeLayouts(doc, options) {
  const probeDir = options.probeDir;
  const map = options.candidatesBySlide || new Map(doc.slides.map((s) => [s.index, s.layoutCandidates]));

  const html = renderProbeDocument(doc, { candidatesBySlide: map });
  const probePath = path.join(probeDir, ".probe.html");
  await writeFile(probePath, html, "utf8");

  const browser = await chromium.launch();
  let measured = [];

  try {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 768 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(DEFAULT_TIMEOUT);

    await page.goto(pathToFileURL(probePath).href, { waitUntil: "load" });
    await waitForLayout(page);
    measured = await page.evaluate(measureAll);
  } finally {
    await browser.close();
  }

  const byKey = new Map(measured.map((item) => [item.key, item]));

  const resolutions = doc.slides.map((slide) => {
    const candidates = map.get(slide.index) || slide.layoutCandidates;
    const checks = candidates.map((layout) => {
      const hit = byKey.get(`${slide.index}:${layout}`);
      return {
        layout,
        measured: Boolean(hit),
        overflowX: hit ? hit.overflowX : 0,
        overflowY: hit ? hit.overflowY : 0,
        parts: hit ? hit.parts : null,
        scrollHeight: hit ? hit.scrollHeight : 0,
        clientHeight: hit ? hit.clientHeight : 0,
      };
    });

    const chosen = checks.find((check) => check.measured && check.overflowY === 0 && check.overflowX === 0);

    return {
      slide,
      candidates,
      checks,
      chosen: chosen ? chosen.layout : null,
      ok: Boolean(chosen),
      explicit: Boolean(slide.directives.layout && slide.directives.layout !== "auto"),
    };
  });

  return { resolutions, probePath };
}

/**
 * Assign `slide.resolvedLayout` and collect hard errors.
 * @returns {string[]} error messages
 */
export function applyResolutions(resolutions) {
  const errors = [];

  for (const resolution of resolutions) {
    const { slide, checks, chosen } = resolution;

    if (chosen) {
      slide.resolvedLayout = chosen;
      slide.layoutCandidates = resolution.candidates;
      continue;
    }

    const best = checks
      .filter((check) => check.measured)
      .sort((a, b) => a.overflowY + a.overflowX - (b.overflowY + b.overflowX))[0];

    slide.resolvedLayout = slide.layoutCandidates[0];
    errors.push(describeFailure(slide, best, resolution));
  }

  return errors;
}

function describeFailure(slide, best, resolution) {
  const tried = resolution.candidates.filter((c) => c !== resolution.chosen);

  if (!best || !best.measured) {
    return `Slide ${slide.number}: layout "${tried[0]}" could not be measured.`;
  }

  const lines = [];

  if (best.overflowY > 0) {
    lines.push(`Slide ${slide.number} overflowed vertically by ${best.overflowY}px.`);
  }
  if (best.overflowX > 0) {
    lines.push(`Slide ${slide.number} overflowed horizontally by ${best.overflowX}px.`);
  }
  if (lines.length === 0) {
    lines.push(`Slide ${slide.number}: no layout candidate could be validated.`);
  }

  lines.push("");
  lines.push("Possible fixes:");
  lines.push("- split this slide");
  if (slide.metrics.topBulletCount > 4) lines.push("- reduce bullet count");
  if (slide.metrics.codeBlockCount > 0) lines.push("- shorten the code block");
  if (slide.metrics.imageCount === 0) lines.push("- use a two-slide structure");
  if (slide.metrics.imageCount === 1) lines.push("- use layout: image-right or layout: image-bottom");
  if (resolution.explicit) {
    lines.push(
      `- the explicit <!-- layout: ${slide.directives.layout} --> cannot fit; remove it to allow automatic selection`,
    );
  }
  lines.push("");
  lines.push("Typography is fixed: font size is never reduced automatically.");

  return lines.join("\n");
}

/** Human-readable report for `slides lint` (spec section 33). */
export function formatLintReport(doc, resolutions) {
  const blocks = [];

  for (const resolution of resolutions) {
    if (resolution.ok) continue;

    const { slide, checks } = resolution;
    const best = checks
      .filter((check) => check.measured)
      .sort((a, b) => a.overflowY + a.overflowX - (b.overflowY + b.overflowX))[0];

    const line = [`Slide ${slide.number}`, "------------"];
    if (best && best.overflowY > 0) line.push(`Vertical overflow: ${best.overflowY}px`);
    if (best && best.overflowX > 0) line.push(`Horizontal overflow: ${best.overflowX}px`);
    if (best && best.parts && best.parts.code > 0) line.push(`Code block overflow: ${best.parts.code}px`);
    if (best && best.parts && best.parts.image > 0) line.push(`Image overflow: ${best.parts.image}px`);

    const causes = [];
    if (slide.metrics.topBulletCount) causes.push(`${slide.metrics.topBulletCount} top-level bullets`);
    if (slide.metrics.nestedListCount) causes.push(`${slide.metrics.nestedListCount} nested lists`);
    if (slide.metrics.codeBlockCount) causes.push(`${slide.metrics.codeBlockCount} code blocks`);
    if (slide.metrics.paragraphChars) causes.push(`${slide.metrics.paragraphChars} characters of paragraph text`);

    if (causes.length) {
      line.push("", "Likely causes:");
      for (const cause of causes) line.push(`- ${cause}`);
    }

    line.push("", "Suggestion:", "split into two slides.");
    line.push("", `Candidates tried: ${resolution.candidates.join(" -> ")}`);

    blocks.push(line.join("\n"));
  }

  return blocks.join("\n\n");
}
