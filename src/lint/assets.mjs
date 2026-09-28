/**
 * Asset resolution + content linting.
 *
 * Two different jobs:
 *   1. assets   - do the images exist? are remote images allowed?
 *   2. lint     - density warnings and the "no inline font-size" rule.
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export function isRemoteSource(src) {
  return /^https?:\/\//i.test(src) || src.startsWith("//");
}

function stripQuery(src) {
  return String(src).split(/[?#]/)[0];
}

/**
 * Resolve every local image to an absolute path and record whether it exists.
 * @returns {Promise<string[]>} error messages
 */
export async function checkAssetExistence(doc, { baseDir }) {
  const errors = [];

  for (const slide of doc.slides) {
    for (const image of slide.images) {
      if (image.mermaid) continue;

      if (!image.src) {
        errors.push(`Slide ${slide.number}: image block without a source.`);
        continue;
      }

      if (isRemoteSource(image.src)) {
        image.remote = true;
        continue;
      }

      const cleaned = decodeURIComponent(stripQuery(image.src));
      const absPath = path.resolve(baseDir, cleaned);
      image.absPath = absPath;

      try {
        await access(absPath);
        image.exists = true;
      } catch {
        image.exists = false;
        errors.push(
          `Slide ${slide.number}: image not found: "${image.src}" (looked in ${absPath}).`,
        );
      }
    }
  }

  return errors;
}

/**
 * Fetch remote images, hash them, cache them, and stage them for dist/assets.
 * @returns {Promise<{errors: string[], warnings: string[], files: Array<{from:string,to:string}>}>}
 */
export async function resolveRemoteAssets(doc, { assetsDir, cacheDir }) {
  const errors = [];
  const warnings = [];
  const files = [];

  for (const slide of doc.slides) {
    for (const image of slide.images) {
      if (!image.remote) continue;

      if (!doc.meta.remoteAssets) {
        errors.push(
          `Slide ${slide.number}: remote image "${image.src}" is not allowed. ` +
            `Set "remoteAssets: true" in the front matter, or download the file into assets/.`,
        );
        continue;
      }

      const hash = createHash("sha256").update(image.src).digest("hex").slice(0, 12);
      let ext = ".bin";
      try {
        ext = path.extname(new URL(image.src).pathname) || ".bin";
      } catch {
        ext = ".bin";
      }

      const cachedPath = path.join(cacheDir, `${hash}${ext}`);

      try {
        await mkdir(cacheDir, { recursive: true });
        let needsDownload = false;
        try {
          await access(cachedPath);
        } catch {
          needsDownload = true;
        }

        if (needsDownload) {
          const response = await fetch(image.src);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(cachedPath, buffer);
        }

        const outputName = `${hash}${ext}`;
        image.absPath = cachedPath;
        image.exists = true;
        image.outputSrc = outputName;
        files.push({ from: cachedPath, to: path.join(assetsDir, outputName) });
        warnings.push(`Slide ${slide.number}: remote image cached as ${outputName}.`);
      } catch (error) {
        errors.push(`Slide ${slide.number}: failed to fetch "${image.src}": ${error.message}.`);
      }
    }
  }

  return { errors, warnings, files };
}

const INLINE_FONT_SIZE_RES = [
  /style\s*=\s*["'][^"']*font-size\s*:/i,
  /<font\b[^>]*\bsize\s*=/i,
];

function hasInlineFontSize(blocks) {
  for (const block of blocks) {
    const candidates = [];
    if (typeof block.inline === "string") candidates.push(block.inline);
    if (typeof block.html === "string") candidates.push(block.html);
    if (block.items) {
      for (const item of block.items) {
        candidates.push(item.inline || "");
        if (item.children && hasInlineFontSize(item.children)) return true;
      }
    }
    if (block.blocks && hasInlineFontSize(block.blocks)) return true;

    for (const html of candidates) {
      if (INLINE_FONT_SIZE_RES.some((re) => re.test(html))) return true;
    }
  }
  return false;
}

function stripTags(html) {
  return String(html || "").replace(/<[^>]*>/g, "");
}

/**
 * Density is measured in CJK characters (spec section 34). Latin text is
 * weighted at half a character so an English title is not flagged at 25 chars.
 */
function visualLength(text) {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(char)) cjk += 1;
    else if (!/\s/.test(char)) other += 1;
  }
  return Math.round(cjk + other / 2);
}

/** Content density warnings (spec section 34) + inline typography warnings. */
export function contentWarnings(doc) {
  const warnings = [];

  for (const slide of doc.slides) {
    const titleLength = visualLength(stripTags(slide.title).trim());
    const subtitleLength = visualLength(stripTags(slide.subtitle).trim());
    const { topBulletCount, bulletCount, paragraphChars } = slide.metrics;

    if (titleLength > 24) {
      warnings.push(`Slide ${slide.number}: title is ${titleLength} characters (recommended <= 24).`);
    }
    if (subtitleLength > 32) {
      warnings.push(
        `Slide ${slide.number}: subtitle is ${subtitleLength} characters (recommended <= 32).`,
      );
    }
    if (topBulletCount > 6) {
      warnings.push(
        `Slide ${slide.number}: ${topBulletCount} top-level bullets (recommended <= 6).`,
      );
    }
    if (bulletCount > 10) {
      warnings.push(`Slide ${slide.number}: ${bulletCount} bullets in total (recommended <= 10).`);
    }
    if (paragraphChars > 350) {
      warnings.push(
        `Slide ${slide.number}: paragraph text is ${paragraphChars} characters (recommended <= 350).`,
      );
    }
    if (hasInlineFontSize(slide.blocks)) {
      warnings.push(
        `Slide ${slide.number}: Inline font-size is discouraged. Use semantic layout instead.`,
      );
    }
  }

  return warnings;
}
