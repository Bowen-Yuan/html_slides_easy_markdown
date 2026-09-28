/**
 * Semantic slide AST.
 *
 * Markdown tokens -> blocks -> slides. This layer knows nothing about CSS,
 * pixels or the DOM. The layout engine and the renderer only ever read this.
 *
 * Block shapes:
 *   { type: "paragraph",  inline }                     inline = HTML
 *   { type: "heading",    level, inline }
 *   { type: "list",       ordered, items: [item] }
 *                        item = { inline, children: [list...] }
 *   { type: "blockquote", blocks: [block...] }
 *   { type: "code",       lang, code, html }
 *   { type: "mermaid",    code }
 *   { type: "math",       tex, html }
 *   { type: "image",      src, alt, title }
 *   { type: "table",      html }
 *   { type: "html",       html }
 */

import katex from "katex";
import { highlightCode } from "../parser/markdown.mjs";

const TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "list",
  "blockquote",
  "code",
  "table",
  "heading",
  "html",
]);

function renderInline(token, md) {
  if (!token || !token.children) return "";
  return md.renderer.renderInline(token.children, md.options, {});
}

function findClose(tokens, start, base) {
  let depth = 0;
  for (let i = start; i < tokens.length; i += 1) {
    const type = tokens[i].type;
    if (type === `${base}_open`) depth += 1;
    else if (type === `${base}_close`) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

function isImageOnly(inlineToken) {
  if (!inlineToken || !inlineToken.children) return false;
  const meaningful = inlineToken.children.filter(
    (child) => !(child.type === "text" && child.content.trim() === ""),
  );
  if (meaningful.length === 0) return false;
  return meaningful.every((child) => child.type === "image");
}

function parseListItem(slice, md) {
  const blocks = tokensToBlocks(slice, md);
  const inline = blocks
    .filter((block) => block.type === "paragraph")
    .map((block) => block.inline)
    .join(" ");
  const children = blocks.filter((block) => block.type === "list");
  return { inline, children };
}

export function tokensToBlocks(tokens, md) {
  const blocks = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    switch (token.type) {
      case "heading_open": {
        const inlineToken = tokens[i + 1];
        blocks.push({
          type: "heading",
          level: Number(token.tag.slice(1)),
          inline: renderInline(inlineToken, md),
        });
        i += 3;
        break;
      }

      case "paragraph_open": {
        const inlineToken = tokens[i + 1];
        if (isImageOnly(inlineToken)) {
          for (const child of inlineToken.children) {
            if (child.type !== "image") continue;
            blocks.push({
              type: "image",
              src: child.attrGet("src") || "",
              alt: child.children && child.children[0] ? child.children[0].content : "",
              title: child.attrGet("title") || "",
            });
          }
        } else if (renderInline(inlineToken, md).trim() !== "") {
          blocks.push({ type: "paragraph", inline: renderInline(inlineToken, md) });
        }
        i += 3;
        break;
      }

      case "blockquote_open": {
        const close = findClose(tokens, i, "blockquote");
        blocks.push({
          type: "blockquote",
          blocks: tokensToBlocks(tokens.slice(i + 1, close), md),
        });
        i = close + 1;
        break;
      }

      case "bullet_list_open":
      case "ordered_list_open": {
        const ordered = token.type === "ordered_list_open";
        const base = ordered ? "ordered_list" : "bullet_list";
        const close = findClose(tokens, i, base);
        const items = [];

        let j = i + 1;
        while (j < close) {
          if (tokens[j].type === "list_item_open") {
            const itemClose = findClose(tokens, j, "list_item");
            items.push(parseListItem(tokens.slice(j + 1, itemClose), md));
            j = itemClose + 1;
          } else {
            j += 1;
          }
        }

        blocks.push({ type: "list", ordered, items });
        i = close + 1;
        break;
      }

      case "fence":
      case "code_block": {
        const code = token.content.replace(/\n$/, "");
        const info = String(token.info || "").trim();
        const lang = info.split(/\s+/)[0] || "";

        if (lang.toLowerCase() === "mermaid") {
          blocks.push({ type: "mermaid", code });
        } else {
          blocks.push({
            type: "code",
            lang,
            code,
            html: highlightCode(code, lang),
          });
        }
        i += 1;
        break;
      }

      case "math_block":
      case "math_block_eqno": {
        const tex = String(token.content || "").trim();
        blocks.push({
          type: "math",
          tex,
          html: katex.renderToString(tex, { displayMode: true, throwOnError: false }),
        });
        i += 1;
        break;
      }

      case "table_open": {
        const close = findClose(tokens, i, "table");
        blocks.push({
          type: "table",
          html: md.renderer.render(tokens.slice(i, close + 1), md.options, {}),
        });
        i = close + 1;
        break;
      }

      case "html_block": {
        if (token.content.trim() !== "") {
          blocks.push({ type: "html", html: token.content });
        }
        i += 1;
        break;
      }

      case "hr": {
        blocks.push({ type: "html", html: "<hr />" });
        i += 1;
        break;
      }

      default:
        i += 1;
        break;
    }
  }

  return blocks;
}

/** Hoist the first H1 to `title` and the first H2 to `subtitle`. */
export function classifyBlocks(blocks) {
  let title = null;
  let subtitle = null;
  const body = [];

  for (const block of blocks) {
    if (block.type === "heading" && block.level === 1 && title === null) {
      title = block.inline;
      continue;
    }
    if (block.type === "heading" && block.level === 2 && subtitle === null) {
      subtitle = block.inline;
      continue;
    }
    body.push(block);
  }

  return { title, subtitle, blocks: body };
}

export function extractImages(blocks) {
  const images = [];
  for (const block of blocks) {
    if (block.type === "image") {
      images.push(block);
    } else if (block.type === "mermaid") {
      // Mermaid is rendered to SVG at build time; for layout purposes it is
      // just another image. Default to 16:9 until the real size is known.
      const synthetic = {
        type: "image",
        src: null,
        alt: "mermaid diagram",
        mermaid: true,
        block,
        width: 320,
        height: 180,
        ratio: 16 / 9,
        orientation: "landscape",
      };
      block.image = synthetic;
      images.push(synthetic);
    } else if (block.type === "blockquote") {
      images.push(...extractImages(block.blocks));
    }
  }
  return images;
}

function stripTags(html) {
  return String(html || "").replace(/<[^>]*>/g, "");
}

function countListItems(list) {
  let total = 0;
  for (const item of list.items) {
    total += 1;
    for (const child of item.children) total += countListItems(child).total;
  }
  return { total, top: list.items.length };
}

export function computeMetrics(blocks) {
  const metrics = {
    imageCount: 0,
    textBlocks: 0,
    bulletCount: 0,
    topBulletCount: 0,
    codeBlockCount: 0,
    tableCount: 0,
    paragraphChars: 0,
    quoteCount: 0,
    nestedListCount: 0,
    mermaidCount: 0,
  };

  const visit = (list) => {
    for (const block of list) {
      switch (block.type) {
        case "image":
          metrics.imageCount += 1;
          break;
        case "mermaid":
          metrics.imageCount += 1;
          metrics.mermaidCount += 1;
          break;
        case "list": {
          const { total, top } = countListItems(block);
          metrics.bulletCount += total;
          metrics.topBulletCount += top;
          if (block.items.some((item) => item.children.length > 0)) {
            metrics.nestedListCount += 1;
          }
          metrics.textBlocks += 1;
          break;
        }
        case "paragraph":
          metrics.paragraphChars += stripTags(block.inline).trim().length;
          metrics.textBlocks += 1;
          break;
        case "code":
          metrics.codeBlockCount += 1;
          metrics.textBlocks += 1;
          break;
        case "table":
          metrics.tableCount += 1;
          metrics.textBlocks += 1;
          break;
        case "blockquote":
          metrics.quoteCount += 1;
          metrics.textBlocks += 1;
          visit(block.blocks);
          break;
        default:
          if (TEXT_BLOCK_TYPES.has(block.type)) metrics.textBlocks += 1;
          break;
      }
    }
  };

  visit(blocks);
  return metrics;
}

/**
 * Build one slide from its token group.
 */
export function buildSlide({ index, tokens, md, directives, warnings }) {
  const blocks = tokensToBlocks(tokens, md);
  const { title, subtitle, blocks: body } = classifyBlocks(blocks);

  const slide = {
    type: "slide",
    index,
    number: index + 1,
    title,
    subtitle,
    blocks: body,
    directives,
    layout: directives.layout || "auto",
    resolvedLayout: null,
    layoutCandidates: [],
    images: [],
    metrics: computeMetrics(body),
    warnings: [...(warnings || [])],
    errors: [],
  };

  slide.images = extractImages(body);
  return slide;
}

/** A slide with no content at all is dropped (stray separators, comments). */
export function isSlideEmpty(slide) {
  return (
    slide.title === null &&
    slide.subtitle === null &&
    slide.blocks.length === 0
  );
}
