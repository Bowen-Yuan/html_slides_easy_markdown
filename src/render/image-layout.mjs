/**
 * Image metadata + media geometry.
 *
 * The user writes `![alt](assets/foo.svg)`. They never write sizes.
 * We read the intrinsic dimensions and let the layout engine decide.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** ratio < 0.80 => portrait, 0.80..1.25 => square, > 1.25 => landscape */
export function orientationOf(ratio) {
  if (ratio < 0.8) return "portrait";
  if (ratio <= 1.25) return "square";
  return "landscape";
}

function withRatio(width, height) {
  const ratio = width / height;
  return { width, height, ratio, orientation: orientationOf(ratio) };
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  if (!match) return null;
  return match[2] !== undefined ? match[2] : match[3];
}

function parseLength(raw) {
  if (raw === null || raw === undefined) return null;
  const match = String(raw).trim().match(/^([\d.]+)\s*(px|pt|mm|cm|in|em|ex|%)?$/i);
  if (!match) return null;
  if (match[2] === "%") return null; // a percentage is not an intrinsic size
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Read width/height from an SVG's attributes, falling back to its viewBox. */
export function parseSvgSize(svgText) {
  const svgTag = svgText.match(/<svg\b[^>]*>/i);
  if (!svgTag) return null;
  const tag = svgTag[0];

  const width = parseLength(attr(tag, "width"));
  const height = parseLength(attr(tag, "height"));
  if (width && height) return { width, height };

  const viewBox = attr(tag, "viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }

  if (width && !height) return { width, height: width };
  if (height && !width) return { width: height, height };
  return null;
}

/**
 * @returns {Promise<{width:number|null,height:number|null,ratio:number,orientation:string,unknown?:boolean}>}
 */
export async function readImageMeta(absPath) {
  const ext = path.extname(absPath).toLowerCase();

  if (ext === ".svg") {
    try {
      const text = await readFile(absPath, "utf8");
      const size = parseSvgSize(text);
      if (size) return withRatio(size.width, size.height);
    } catch {
      // fall through to sharp
    }
  }

  const meta = await sharp(absPath, { density: 96 }).metadata();
  if (!meta.width || !meta.height) {
    return { width: null, height: null, ratio: 1, orientation: "square", unknown: true };
  }
  return withRatio(meta.width, meta.height);
}

/**
 * Inline grid style for a split/bottom layout with an explicit image width.
 * @returns {string} e.g. `style="grid-template-columns:minmax(0,1fr) 40%"`
 */
export function splitColumnsStyle(layout, imageWidth) {
  if (!imageWidth) return "";
  if (layout === "image-left") {
    return ` style="grid-template-columns:${imageWidth}% minmax(0,1fr)"`;
  }
  if (layout === "image-right") {
    return ` style="grid-template-columns:minmax(0,1fr) ${imageWidth}%"`;
  }
  return "";
}
