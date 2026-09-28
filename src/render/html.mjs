/**
 * Renderer: AST -> HTML.
 *
 * Two entry points:
 *   - renderDocument(doc)      the final dist/index.html
 *   - renderProbeDocument(doc) a headless measurement page containing every
 *                              layout candidate for every slide
 *
 * No CSS lives here. This file only emits structure and class names.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { escapeHtml } from "../parser/markdown.mjs";
import { ASPECTS } from "../parser/frontmatter.mjs";
import { splitColumnsStyle } from "./image-layout.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(here, "template.html");

/**
 * Stylesheet injected by the PDF / PPTX exporters (and the visual test).
 *
 * It overrides ONLY the section geometry and pagination. It deliberately
 * touches no descendant, so every layout keeps the exact rules it has
 * on screen. Loading is done with screen media, because reveal.css ships an
 * `@media print` rule that forces `display:block` on every div and would
 * destroy every image layout.
 */
export function exportCss({ width = 1024, height = 768 } = {}) {
  return `
/* reveal pins html/body to height:100% + overflow:hidden, which would clip
   pagination to a single page. */
html#gse,
html#gse body {
  margin: 0 !important;
  padding: 0 !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
  background: #ffffff !important;
}

.reveal { position: static !important; width: auto !important; height: auto !important; overflow: visible !important; }

.reveal .slides {
  position: static !important;
  width: auto !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  transform: none !important;
  zoom: 1 !important;
  overflow: visible !important;
  text-align: left !important;
  perspective: none !important;
}

.reveal .slides > section {
  display: block !important;
  position: relative !important;
  visibility: visible !important;
  opacity: 1 !important;
  transform: none !important;
  transition: none !important;
  box-sizing: border-box !important;
  width: ${width}px !important;
  height: ${height}px !important;
  margin: 0 !important;
  overflow: hidden !important;
  page-break-after: always !important;
  break-after: page !important;
  page-break-inside: avoid !important;
  break-inside: avoid !important;
}

.reveal .slides > section:last-of-type {
  page-break-after: auto !important;
  break-after: auto !important;
}

/* Chromium emits a trailing blank page when the content ends exactly on a page
   boundary (17 * 768px). Pull the final edge back by one pixel: invisible, and
   the page count then matches the slide count exactly. */
.reveal .slides > section:last-child {
  margin-bottom: -1px !important;
}

/* Centred and media-driven layouts keep their own display mode. */
.reveal .slides > section:is(
  .layout-figure,
  .layout-image-right,
  .layout-image-left,
  .layout-image-bottom,
  .layout-grid,
  .layout-gallery,
  .layout-title,
  .layout-middle
) {
  display: flex !important;
  flex-direction: column;
}

.reveal .controls,
.reveal .progress,
.reveal .backgrounds,
.reveal .pause-overlay {
  display: none !important;
}
`;
}

/** Where does this image live in dist/? */
export function imageHref(image) {
  if ((image.remote || image.mermaid) && image.outputSrc) return `assets/${image.outputSrc}`;
  return image.src || "";
}

function renderImageTag(image) {
  const src = imageHref(image);
  if (!src) return "";
  const alt = escapeHtml(image.alt || "");
  return `<img class="slide-image" src="${escapeHtml(src)}" alt="${alt}" />`;
}

function renderList(list) {
  const tag = list.ordered ? "ol" : "ul";
  const items = list.items
    .map((item) => {
      const children = item.children.map(renderList).join("");
      return `<li>${item.inline}${children}</li>`;
    })
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

export function renderBlock(block) {
  switch (block.type) {
    case "paragraph":
      return `<p>${block.inline}</p>`;
    case "heading":
      return `<h${block.level}>${block.inline}</h${block.level}>`;
    case "list":
      return renderList(block);
    case "blockquote":
      return `<blockquote>${renderBlocks(block.blocks)}</blockquote>`;
    case "code": {
      const langClass = block.lang ? ` language-${escapeHtml(block.lang)}` : "";
      return `<pre><code class="hljs${langClass}">${block.html}</code></pre>`;
    }
    case "math":
      return `<div class="math-block">${block.html}</div>`;
    case "table":
      return block.html;
    case "html":
      return block.html;
    case "mermaid":
      if (block.outputSrc && !block.mermaidError) {
        return renderImageTag({
          src: null,
          outputSrc: block.outputSrc,
          mermaid: true,
          alt: "mermaid diagram",
        });
      }
      return `<pre><code class="hljs language-mermaid">${escapeHtml(block.code)}</code></pre>`;
    case "image":
      return renderImageTag(block);
    default:
      return "";
  }
}

export function renderBlocks(blocks) {
  return blocks.map(renderBlock).join("");
}

function renderHeader(slide) {
  let html = "";
  if (slide.title !== null) html += `<h1>${slide.title}</h1>`;
  if (slide.subtitle !== null) html += `<h2>${slide.subtitle}</h2>`;
  return html;
}

function renderBody(slide, layout) {
  const textBlocks = slide.blocks.filter(
    (block) => block.type !== "image" && block.type !== "mermaid",
  );
  const images = slide.images;
  const media = images.map(renderImageTag);

  switch (layout) {
    case "title": {
      const meta = renderBlocks(textBlocks);
      return meta ? `<div class="title-meta">${meta}</div>` : "";
    }

    case "middle": {
      return textBlocks.length ? `<div class="slide-body">${renderBlocks(textBlocks)}</div>` : "";
    }

    case "figure": {
      const figure = media.length ? `<div class="figure-box">${media[0]}</div>` : "";
      const caption = textBlocks.length ? renderBlocks(textBlocks) : "";
      return `<div class="slide-body">${figure}${caption}</div>`;
    }

    case "image-right":
    case "image-left": {
      const text = `<div class="text">${renderBlocks(textBlocks)}</div>`;
      const mediaCol = `<div class="media">${media.join("")}</div>`;
      const inner = layout === "image-left" ? mediaCol + text : text + mediaCol;
      const style = splitColumnsStyle(layout, slide.directives.imageWidth);
      return `<div class="slide-body"${style}>${inner}</div>`;
    }

    case "image-bottom": {
      const text = `<div class="text">${renderBlocks(textBlocks)}</div>`;
      const style = slide.directives.imageWidth
        ? ` style="max-width:${slide.directives.imageWidth}%"`
        : "";
      const mediaCol = `<div class="media"${style}>${media.join("")}</div>`;
      return `<div class="slide-body">${text}${mediaCol}</div>`;
    }

    case "grid": {
      const rows2 = images.length > 2 ? " grid-rows-2" : "";
      const cells = media.map((html) => `<div class="grid-cell">${html}</div>`).join("");
      const tail = textBlocks.length ? renderBlocks(textBlocks) : "";
      return `<div class="slide-body"><div class="image-grid-2${rows2}">${cells}</div>${tail}</div>`;
    }

    case "gallery": {
      const cols = images.length <= 2 ? images.length : Math.ceil(Math.sqrt(images.length));
      const cells = media.map((html) => `<div class="grid-cell">${html}</div>`).join("");
      const tail = textBlocks.length ? renderBlocks(textBlocks) : "";
      const style = ` style="grid-template-columns:repeat(${cols},minmax(0,1fr))"`;
      return `<div class="slide-body"><div class="image-gallery"${style}>${cells}</div>${tail}</div>`;
    }

    case "text":
    default:
      return `<div class="slide-body">${renderBlocks(slide.blocks)}</div>`;
  }
}

/**
 * @param {object} slide
 * @param {{ layout?: string, slideNumber?: boolean, probeKey?: string }} [options]
 */
export function renderSlide(slide, options = {}) {
  const layout = options.layout || slide.resolvedLayout || slide.layoutCandidates[0] || "text";
  const attrs = [`class="layout-${layout}"`, `data-layout="${layout}"`, `data-slide="${slide.number}"`];
  if (options.probeKey) attrs.push(`data-probe="${escapeHtml(options.probeKey)}"`);

  const showNumber = options.slideNumber !== false && layout !== "title";
  const index = showNumber ? `<div class="slide-index">${slide.number}</div>` : "";

  return `<section ${attrs.join(" ")}>${renderHeader(slide)}${renderBody(slide, layout)}${index}</section>`;
}

function revealInitFor(meta) {
  const dims = ASPECTS[meta.aspect] || ASPECTS["4:3"];
  return {
    width: dims.width,
    height: dims.height,
    margin: 0,
    center: false,
    controls: false,
    progress: false,
    hash: true,
    // Slide numbers are rendered by the theme (see .slide-index) so that the
    // HTML, PDF and PPTX all show exactly the same number.
    slideNumber: false,
    transition: "none",
    backgroundTransition: "none",
  };
}

/**
 * Probe-only geometry. Deliberately does NOT touch `display`: every layout
 * keeps the exact display mode the theme gives it. reveal.css is not loaded in
 * the probe, so `.reveal .slides > section { display: none }` never applies and
 * no `display` override is needed (an override would defeat `.layout-*` flex).
 */
const PROBE_CSS = `
html#gse.probe, html#gse.probe body { margin:0; padding:0; background:#ffffff; }
html#gse.probe .reveal { width:auto; height:auto; overflow:visible; }
html#gse.probe .reveal .slides {
  width:auto; height:auto; margin:0; padding:0; overflow:visible; text-align:left;
}
html#gse.probe .reveal .slides > section {
  position:relative !important;
  width:1024px !important;
  height:768px !important;
  margin:0 0 8px 0 !important;
  visibility:visible !important;
  opacity:1 !important;
}
`;

/** A page containing every candidate layout, for headless overflow probing. */
export function renderProbeDocument(doc, { candidatesBySlide }) {
  const sections = [];

  for (const slide of doc.slides) {
    const candidates = candidatesBySlide.get(slide.index) || slide.layoutCandidates;
    for (const layout of candidates) {
      sections.push(
        renderSlide(slide, {
          layout,
          slideNumber: doc.meta.slideNumber,
          probeKey: `${slide.index}:${layout}`,
        }),
      );
    }
  }

  return `<!doctype html>
<html id="gse" class="probe" lang="zh-CN">
<head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="./assets/katex.min.css" />
<link rel="stylesheet" href="./assets/highlight.css" />
<link rel="stylesheet" href="./assets/gse.css" />
<style>${PROBE_CSS}</style>
</head>
<body>
<div class="reveal"><div class="slides">
${sections.join("\n")}
</div></div>
</body>
</html>
`;
}

/** The final, self-contained presentation. */
export function renderDocument(doc) {
  const template = readFileSync(TEMPLATE_PATH, "utf8");

  const slidesHtml = doc.slides
    .map((slide) =>
      renderSlide(slide, {
        layout: slide.resolvedLayout || slide.layoutCandidates[0],
        slideNumber: doc.meta.slideNumber,
      }),
    )
    .join("\n");

  return template
    .replace(/\{\{lang\}\}/g, "zh-CN")
    .replace(/\{\{title\}\}/g, escapeHtml(doc.meta.title))
    .replace(/\{\{author\}\}/g, escapeHtml(doc.meta.author))
    .replace("{{slides}}", slidesHtml)
    .replace("{{revealInit}}", JSON.stringify(revealInitFor(doc.meta), null, 2));
}
