/**
 * Compiler: markdown text -> document AST.
 *
 * Order matters:
 *   front matter -> markdown tokens -> slides -> directives -> blocks
 *   -> asset resolution -> image metadata -> layout candidates -> lint
 *
 * This module never touches the DOM. The overflow probe (Chromium) and the
 * exporters consume the AST produced here.
 */

import path from "node:path";

import { parseFrontmatter } from "../parser/frontmatter.mjs";
import { createEngine, normalizeSeparators, splitSlideTokens } from "../parser/markdown.mjs";
import { extractDirectives } from "../parser/directives.mjs";
import { buildSlide, isSlideEmpty } from "./slide-ast.mjs";
import { candidatesForSlide, layoutErrors, layoutWarnings } from "./layouts.mjs";
import { readImageMeta } from "../render/image-layout.mjs";
import {
  checkAssetExistence,
  contentWarnings,
  resolveRemoteAssets,
} from "../lint/assets.mjs";

/** Recompute `layoutCandidates` for every slide (after mermaid hydration). */
export function recomputeLayoutCandidates(doc) {
  for (const slide of doc.slides) {
    slide.layoutCandidates = candidatesForSlide(slide);
  }
}

/**
 * @param {string} raw markdown source
 * @param {{ sourcePath?: string, baseDir?: string, md?: object, assetsDir?: string, cacheDir?: string }} [options]
 * @returns {Promise<object>} document AST
 */
export async function compile(raw, options = {}) {
  const sourcePath = options.sourcePath ? path.resolve(options.sourcePath) : null;
  const baseDir = options.baseDir || (sourcePath ? path.dirname(sourcePath) : process.cwd());
  const md = options.md || createEngine();

  const { meta, content, warnings: frontmatterWarnings } = parseFrontmatter(raw);
  const normalized = normalizeSeparators(content);
  const tokens = md.parse(normalized, {});
  const groups = splitSlideTokens(tokens);

  const slides = [];
  for (const group of groups) {
    const {
      directives,
      tokens: cleaned,
      warnings: directiveWarnings,
    } = extractDirectives(group);

    const slide = buildSlide({
      index: slides.length,
      tokens: cleaned,
      md,
      directives,
      warnings: directiveWarnings,
    });

    if (isSlideEmpty(slide)) continue;
    slides.push(slide);
  }

  slides.forEach((slide, index) => {
    slide.index = index;
    slide.number = index + 1;
  });

  const doc = {
    meta: { ...meta, sourcePath, baseDir },
    slides,
    warnings: [...frontmatterWarnings],
    errors: [],
  };

  doc.errors.push(...(await checkAssetExistence(doc, { baseDir })));

  if (options.assetsDir && options.cacheDir) {
    const remote = await resolveRemoteAssets(doc, {
      assetsDir: options.assetsDir,
      cacheDir: options.cacheDir,
    });
    doc.errors.push(...remote.errors);
    doc.warnings.push(...remote.warnings);
  }

  for (const slide of doc.slides) {
    for (const image of slide.images) {
      if (image.mermaid || image.remote || !image.exists || !image.absPath) continue;
      try {
        const meta2 = await readImageMeta(image.absPath);
        image.width = meta2.width;
        image.height = meta2.height;
        image.ratio = meta2.ratio;
        image.orientation = meta2.orientation;
        if (meta2.unknown) {
          slide.warnings.push(
            `Slide ${slide.number}: could not determine intrinsic size of "${image.src}"; assuming square.`,
          );
        }
      } catch (error) {
        image.ratio = 1;
        image.orientation = "square";
        slide.warnings.push(
          `Slide ${slide.number}: failed to read image metadata for "${image.src}": ${error.message}.`,
        );
      }
    }
  }

  for (const slide of doc.slides) {
    slide.layoutCandidates = candidatesForSlide(slide);
    doc.errors.push(...layoutErrors(slide));
    doc.warnings.push(...layoutWarnings(slide));
    doc.warnings.push(...slide.warnings);
  }

  doc.warnings.push(...contentWarnings(doc));
  doc.warnings = [...new Set(doc.warnings)];

  return doc;
}
