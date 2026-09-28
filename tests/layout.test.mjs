import test from "node:test";
import assert from "node:assert/strict";

import { createEngine } from "../src/parser/markdown.mjs";
import { buildSlide } from "../src/compiler/slide-ast.mjs";
import {
  candidatesForSlide,
  isLightText,
  layoutErrors,
  layoutWarnings,
  LAYOUT_MAP,
} from "../src/compiler/layouts.mjs";
import { orientationOf, parseSvgSize, splitColumnsStyle } from "../src/render/image-layout.mjs";

const md = createEngine();

function slideFrom(source, directives = {}) {
  return buildSlide({
    index: 0,
    tokens: md.parse(source, {}),
    md,
    directives,
    warnings: [],
  });
}

test("orientation: thresholds are exactly 0.80 and 1.25", () => {
  assert.equal(orientationOf(0.79), "portrait");
  assert.equal(orientationOf(0.8), "square");
  assert.equal(orientationOf(1.25), "square");
  assert.equal(orientationOf(1.26), "landscape");
});

test("svg: width/height attributes are preferred", () => {
  const size = parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="620"></svg>');
  assert.deepEqual(size, { width: 1200, height: 620 });
});

test("svg: viewBox is used when attributes are missing", () => {
  const size = parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 900"></svg>');
  assert.deepEqual(size, { width: 640, height: 900 });
});

test("svg: percentage sizes are ignored in favour of the viewBox", () => {
  const size = parseSvgSize('<svg width="100%" height="100%" viewBox="0 0 700 700"></svg>');
  assert.deepEqual(size, { width: 700, height: 700 });
});

test("auto layout: no image means text", () => {
  const slide = slideFrom("# T\n\n- a\n- b");
  assert.deepEqual(candidatesForSlide(slide), ["text"]);
});

test("auto layout: image only means figure", () => {
  const slide = slideFrom("# Architecture\n\n![a](a.svg)");
  assert.deepEqual(candidatesForSlide(slide), ["figure"]);
});

test("auto layout: portrait image prefers a left/right split", () => {
  const slide = slideFrom("# T\n\n- a\n- b\n- c\n\n![p](p.svg)");
  slide.images[0].orientation = "portrait";
  assert.deepEqual(candidatesForSlide(slide), ["image-right", "image-left", "image-bottom"]);
});

test("auto layout: landscape image with light text prefers top/bottom", () => {
  const slide = slideFrom("# T\n\n- a\n- b\n- c\n\n![l](l.svg)");
  slide.images[0].orientation = "landscape";
  assert.equal(isLightText(slide), true);
  assert.deepEqual(candidatesForSlide(slide), ["image-bottom", "image-right"]);
});

test("auto layout: landscape image with heavy text falls back to a split", () => {
  const heavy = ["- one", "- two", "- three", "- four", "- five", "- six", "- seven"].join("\n");
  const slide = slideFrom(`# T\n\n${heavy}\n\n![l](l.svg)`);
  slide.images[0].orientation = "landscape";
  assert.equal(isLightText(slide), false);
  assert.deepEqual(candidatesForSlide(slide), ["image-right", "image-bottom"]);
});

test("auto layout: two images produce a grid", () => {
  const slide = slideFrom("# T\n\n![a](a.svg)\n\n![b](b.svg)");
  assert.equal(slide.metrics.imageCount, 2);
  assert.deepEqual(candidatesForSlide(slide), ["grid"]);
});

test("auto layout: five images fall back to a gallery with a warning", () => {
  const source = ["# T"].concat([0, 1, 2, 3, 4].map((i) => `![i${i}](i${i}.svg)`)).join("\n\n");
  const slide = slideFrom(source);
  assert.equal(slide.metrics.imageCount, 5);
  assert.deepEqual(candidatesForSlide(slide), ["gallery"]);
  assert.equal(layoutWarnings(slide).length, 1);
});

test("auto layout: six images are a hard error without a gallery directive", () => {
  const source = ["# T"].concat([0, 1, 2, 3, 4, 5].map((i) => `![i${i}](i${i}.svg)`)).join("\n\n");
  const slide = slideFrom(source);
  assert.equal(slide.metrics.imageCount, 6);
  assert.equal(layoutErrors(slide).length, 1);
});

test("auto layout: a gallery directive allows six images", () => {
  const source = ["# T"].concat([0, 1, 2, 3, 4, 5].map((i) => `![i${i}](i${i}.svg)`)).join("\n\n");
  const slide = slideFrom(source, { layout: "gallery" });
  assert.equal(layoutErrors(slide).length, 0);
  assert.deepEqual(candidatesForSlide(slide), ["gallery"]);
});

test("explicit directives win and produce a single candidate", () => {
  assert.equal(LAYOUT_MAP["image-right"], "image-right");
  const slide = slideFrom("# T\n\n- a\n\n![a](a.svg)", { layout: "image-bottom" });
  assert.deepEqual(candidatesForSlide(slide), ["image-bottom"]);

  const textSlide = slideFrom("# T\n\n![a](a.svg)", { layout: "text" });
  assert.deepEqual(candidatesForSlide(textSlide), ["text"]);
});

test("explicit image width maps to a grid column template", () => {
  assert.match(splitColumnsStyle("image-right", 40), /minmax\(0,1fr\) 40%/);
  assert.match(splitColumnsStyle("image-left", 60), /60% minmax\(0,1fr\)/);
  assert.equal(splitColumnsStyle("image-right", undefined), "");
});
