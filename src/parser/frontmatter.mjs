/**
 * Front matter parsing (YAML between the first pair of `---` lines).
 *
 * The front matter is the only place global presentation settings live.
 * It never contains layout coordinates or font sizes.
 */

import matter from "gray-matter";

/** Logical slide sizes supported by the theme. */
export const ASPECTS = {
  "4:3": { width: 1024, height: 768 },
  "16:9": { width: 1280, height: 720 },
};

export const DEFAULT_META = {
  title: "Untitled",
  author: "",
  theme: "gse",
  aspect: "4:3",
  slideNumber: true,
  remoteAssets: false,
};

function normalizeSlideNumber(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "false" || v === "off" || v === "none") return false;
    if (v === "true" || v === "on") return true;
    // reveal.js accepts "c/t", "h/v", "h.v"; any string means "show numbers"
    return v.length > 0;
  }
  if (typeof value === "number") return value !== 0;
  return true;
}

/**
 * YAML 1.1 parses an unquoted `4:3` as a sexagesimal integer (243). Authors
 * naturally write `aspect: 4:3`, so quote ratio-looking scalars before parsing.
 */
function quoteRatioScalars(raw) {
  return raw.replace(
    /^([ \t]*(?:aspect|ratio)[ \t]*:[ \t]*)(\d+[ \t]*:[ \t]*\d+)[ \t]*$/gm,
    (_match, prefix, value) => `${prefix}"${value.replace(/[ \t]+/g, "")}"`,
  );
}

/**
 * @param {string} raw full markdown file contents
 * @returns {{ meta: object, content: string, warnings: string[] }}
 */
export function parseFrontmatter(raw) {
  const warnings = [];
  const parsed = matter(quoteRatioScalars(raw));
  const incoming = parsed.data && typeof parsed.data === "object" ? parsed.data : {};

  const meta = { ...DEFAULT_META };

  for (const key of Object.keys(DEFAULT_META)) {
    if (incoming[key] !== undefined && incoming[key] !== null) {
      meta[key] = incoming[key];
    }
  }

  for (const key of Object.keys(incoming)) {
    if (!(key in DEFAULT_META)) {
      warnings.push(`Unknown front matter key ignored: "${key}".`);
    }
  }

  meta.title = String(meta.title ?? "").trim() || "Untitled";
  meta.author = String(meta.author ?? "").trim();
  meta.theme = String(meta.theme ?? "gse").trim() || "gse";
  meta.slideNumber = normalizeSlideNumber(meta.slideNumber);
  meta.remoteAssets = meta.remoteAssets === true || meta.remoteAssets === "true";

  const aspect = String(meta.aspect ?? "4:3").trim();
  if (!ASPECTS[aspect]) {
    warnings.push(
      `Unsupported aspect "${aspect}". Falling back to 4:3. Supported: ${Object.keys(ASPECTS).join(", ")}.`,
    );
    meta.aspect = "4:3";
  }

  if (meta.theme !== "gse") {
    warnings.push(`Unknown theme "${meta.theme}". The only V1 theme is "gse".`);
    meta.theme = "gse";
  }

  return { meta, content: parsed.content, warnings };
}
