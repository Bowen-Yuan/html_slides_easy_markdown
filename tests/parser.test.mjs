import test from "node:test";
import assert from "node:assert/strict";

import { parseFrontmatter } from "../src/parser/frontmatter.mjs";
import {
  createEngine,
  normalizeSeparators,
  splitSlideTokens,
  highlightCode,
} from "../src/parser/markdown.mjs";
import { extractDirectives, parseDirective } from "../src/parser/directives.mjs";
import {
  tokensToBlocks,
  classifyBlocks,
  computeMetrics,
  buildSlide,
  extractImages,
} from "../src/compiler/slide-ast.mjs";

const md = createEngine();

const blocksOf = (source) => tokensToBlocks(md.parse(source, {}), md);

test("front matter: defaults are applied", () => {
  const { meta } = parseFrontmatter("---\ntitle: Hi\n---\nbody");
  assert.equal(meta.title, "Hi");
  assert.equal(meta.theme, "gse");
  assert.equal(meta.aspect, "4:3");
  assert.equal(meta.slideNumber, true);
  assert.equal(meta.remoteAssets, false);
});

test("front matter: unsupported aspect falls back with a warning", () => {
  const { meta, warnings } = parseFrontmatter("---\naspect: 21:9\n---\n");
  assert.equal(meta.aspect, "4:3");
  assert.equal(warnings.length, 1);
});

test("front matter: unknown keys are reported", () => {
  const { warnings } = parseFrontmatter("---\nbanana: yes\n---\n");
  assert.equal(warnings.length, 1);
});

test("separators: a blank line is inserted before a bare --- separator", () => {
  const out = normalizeSeparators("hello\n---\nworld");
  assert.match(out, /hello\n\n---\n\nworld/);
});

test("separators: fences are left untouched", () => {
  const source = "```\na\n---\nb\n```";
  assert.equal(normalizeSeparators(source), source);
});

test("slides: thematic breaks split the deck", () => {
  const groups = splitSlideTokens(md.parse("a\n\n---\n\nb\n\n---\n\nc", {}));
  assert.equal(groups.length, 3);
});

test("directives: layout is extracted and removed from the token stream", () => {
  const { directives, tokens, warnings } = extractDirectives(
    md.parse("<!-- layout: image-right -->\n\n# Title\n", {}),
  );
  assert.equal(directives.layout, "image-right");
  assert.equal(warnings.length, 0);
  assert.ok(tokens.every((token) => !token.content.includes("<!--")));
});

test("directives: an unsupported image width is rejected", () => {
  const result = parseDirective("image-width", "42%");
  assert.ok(result.warning);
  assert.equal(parseDirective("image-width", "40%").value, 40);
});

test("directives: an unknown layout is rejected", () => {
  assert.ok(parseDirective("layout", "diagonal").warning);
});

test("blocks: a lone image becomes an image block", () => {
  const blocks = blocksOf("![architecture](assets/a.svg)");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "image");
  assert.equal(blocks[0].src, "assets/a.svg");
  assert.equal(blocks[0].alt, "architecture");
});

test("blocks: nested lists keep their structure", () => {
  const blocks = blocksOf("- a\n  - b\n  - c\n- d");
  assert.equal(blocks[0].type, "list");
  assert.equal(blocks[0].items.length, 2);
  assert.equal(blocks[0].items[0].inline, "a");
  assert.equal(blocks[0].items[0].children[0].items.length, 2);
  assert.equal(blocks[0].items[0].children[0].items[0].inline, "b");
});

test("blocks: ordered lists are recognised", () => {
  const blocks = blocksOf("1. one\n2. two");
  assert.equal(blocks[0].ordered, true);
});

test("blocks: code fences carry a language and highlighted html", () => {
  const blocks = blocksOf("```js\nconst x = 1;\n```");
  assert.equal(blocks[0].type, "code");
  assert.equal(blocks[0].lang, "js");
  assert.match(blocks[0].html, /<span/);
});

test("blocks: plain text fences are not syntax highlighted", () => {
  const html = highlightCode("a < b", "text");
  assert.equal(html, "a &lt; b");
});

test("blocks: display math is rendered to KaTeX html", () => {
  const blocks = blocksOf("$$\nx^2 + y^2\n$$");
  assert.equal(blocks[0].type, "math");
  assert.match(blocks[0].html, /katex/);
});

test("blocks: inline math stays inline", () => {
  const blocks = blocksOf("cost is $O(n \\log n)$ exactly");
  assert.equal(blocks[0].type, "paragraph");
  assert.match(blocks[0].inline, /katex/);
});

test("blocks: blockquotes are nested blocks", () => {
  const blocks = blocksOf("> quoted text");
  assert.equal(blocks[0].type, "blockquote");
  assert.equal(blocks[0].blocks[0].type, "paragraph");
});

test("blocks: tables are preserved as html", () => {
  const blocks = blocksOf("| a | b |\n| - | - |\n| 1 | 2 |");
  assert.equal(blocks[0].type, "table");
  assert.match(blocks[0].html, /<table/);
});

test("blocks: mermaid fences become mermaid blocks", () => {
  const blocks = blocksOf("```mermaid\ngraph LR\nA --> B\n```");
  assert.equal(blocks[0].type, "mermaid");
});

test("classify: the first h1/h2 become title and subtitle", () => {
  const { title, subtitle, blocks } = classifyBlocks(
    blocksOf("# Title\n\n## Subtitle\n\n- one\n\n### smaller"),
  );
  assert.equal(title, "Title");
  assert.equal(subtitle, "Subtitle");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "list");
  assert.equal(blocks[1].type, "heading");
});

test("metrics: bullets, nesting, code and paragraphs are counted", () => {
  const metrics = computeMetrics(
    blocksOf("- a\n  - b\n- c\n\n```js\nx\n```\n\nsome words here"),
  );
  assert.equal(metrics.bulletCount, 3);
  assert.equal(metrics.topBulletCount, 2);
  assert.equal(metrics.nestedListCount, 1);
  assert.equal(metrics.codeBlockCount, 1);
  assert.ok(metrics.paragraphChars > 0);
});

test("buildSlide: images are collected and misdirectives are dropped", () => {
  const slide = buildSlide({
    index: 0,
    tokens: md.parse("# T\n\n![a](x.svg)\n", {}),
    md,
    directives: {},
    warnings: [],
  });
  assert.equal(slide.title, "T");
  assert.equal(slide.images.length, 1);
  assert.equal(extractImages(slide.blocks).length, 1);
  assert.equal(slide.layout, "auto");
});

test("buildSlide: mermaid participates in layout as an image", () => {
  const slide = buildSlide({
    index: 0,
    tokens: md.parse("```mermaid\ngraph LR\nA-->B\n```\n", {}),
    md,
    directives: {},
    warnings: [],
  });
  assert.equal(slide.metrics.mermaidCount, 1);
  assert.equal(slide.images.length, 1);
  assert.equal(slide.images[0].mermaid, true);
});
