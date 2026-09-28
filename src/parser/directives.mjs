/**
 * Layout directives.
 *
 * Markdown stays semantic. The only escape hatch is a small, closed set of
 * HTML comments. There is deliberately no way to express pixels, font sizes,
 * margins or colours.
 *
 *   <!-- layout: image-right -->
 *   <!-- image-width: 40% -->
 */

/** Every layout the renderer understands. */
export const LAYOUTS = [
  "auto",
  "text",
  "figure",
  "image-right",
  "image-left",
  "image-bottom",
  "gallery",
  "middle",
  "title",
];

/** The only image widths a user may request. */
export const ALLOWED_IMAGE_WIDTHS = [30, 35, 40, 45, 50, 60, 70, 80, 90];

const COMMENT_RE = /<!--([\s\S]*?)-->/g;
const KV_RE = /^\s*([A-Za-z][\w-]*)\s*:\s*([\s\S]*?)\s*$/;

const KEY_ALIASES = new Map([
  ["layout", "layout"],
  ["image-width", "imageWidth"],
  ["imagewidth", "imageWidth"],
  ["image_width", "imageWidth"],
]);

function normalizeKey(raw) {
  return KEY_ALIASES.get(String(raw).trim().toLowerCase()) || null;
}

/**
 * Validate a single directive. Returns `{ key, value }` or `{ warning }`.
 */
export function parseDirective(name, rawValue) {
  const key = normalizeKey(name);
  if (!key) {
    return { warning: `Unknown directive "<!-- ${name}: ... -->" ignored. Allowed: layout, image-width.` };
  }

  const value = String(rawValue ?? "").trim();

  if (key === "layout") {
    const layout = value.toLowerCase();
    if (!LAYOUTS.includes(layout)) {
      return {
        warning: `Unknown layout "${value}". Allowed: ${LAYOUTS.join(", ")}.`,
      };
    }
    return { key, value: layout };
  }

  if (key === "imageWidth") {
    const match = value.match(/^(\d{1,3})\s*%?$/);
    const percent = match ? Number(match[1]) : NaN;
    if (!ALLOWED_IMAGE_WIDTHS.includes(percent)) {
      return {
        warning:
          `Unsupported image width "${value}". ` +
          `Allowed: ${ALLOWED_IMAGE_WIDTHS.map((w) => `${w}%`).join(", ")}. ` +
          `Free-form pixel sizing is intentionally not supported.`,
      };
    }
    return { key, value: percent };
  }

  return { warning: `Directive "<!-- ${name}: ... -->" ignored.` };
}

/**
 * Pull directives out of a slide's token group and strip them from the stream.
 * @param {Array<object>} tokens one slide's tokens
 * @returns {{ directives: object, tokens: Array<object>, warnings: string[] }}
 */
export function extractDirectives(tokens) {
  const directives = {};
  const warnings = [];
  const cleaned = [];

  for (const token of tokens) {
    const isHtml = token.type === "html_block" || token.type === "html_inline";
    if (!isHtml || !token.content.includes("<!--")) {
      cleaned.push(token);
      continue;
    }

    const comments = [...token.content.matchAll(COMMENT_RE)];
    if (comments.length === 0) {
      cleaned.push(token);
      continue;
    }

    let leftover = token.content;

    for (const comment of comments) {
      const kv = comment[1].match(KV_RE);
      const looksLikeDirective = kv && KEY_ALIASES.has(kv[1].trim().toLowerCase());

      if (!looksLikeDirective) continue;

      const result = parseDirective(kv[1], kv[2]);
      if (result.warning) {
        warnings.push(result.warning);
      } else {
        directives[result.key] = result.value;
      }

      leftover = leftover.replace(comment[0], "");
    }

    if (leftover.trim() !== "") {
      cleaned.push({ ...token, content: leftover });
    }
  }

  return { directives, tokens: cleaned, warnings };
}
