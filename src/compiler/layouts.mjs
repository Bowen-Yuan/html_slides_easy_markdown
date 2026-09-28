/**
 * Layout engine.
 *
 * Input: a slide AST. Output: an ordered list of candidate layouts to try.
 * The first candidate that does not overflow (verified in a real browser)
 * wins. Typography never changes.
 *
 * Decision priority (spec):
 *   1. resize the image
 *   2. figure -> split
 *   3. split -> stacked
 *   4. ask the author to split the slide (build error)
 */

/** directive name -> internal layout id (identical; kept explicit for clarity) */
export const LAYOUT_MAP = {
  auto: "auto",
  text: "text",
  figure: "figure",
  "image-right": "image-right",
  "image-left": "image-left",
  "image-bottom": "image-bottom",
  gallery: "gallery",
  middle: "middle",
  title: "title",
};

function hasNonImageContent(slide) {
  return slide.blocks.some((block) => block.type !== "image");
}

/** "Light" text: a landscape image may then go below the text. */
export function isLightText(slide) {
  const m = slide.metrics;
  return (
    m.bulletCount <= 5 &&
    m.paragraphChars <= 160 &&
    m.codeBlockCount === 0 &&
    m.tableCount === 0 &&
    m.quoteCount === 0 &&
    m.nestedListCount === 0
  );
}

/**
 * @returns {string[]} ordered candidate layout ids
 */
export function candidatesForSlide(slide) {
  const requested = slide.directives.layout;

  // An explicit directive is honoured exactly; no silent fallback.
  if (requested && requested !== "auto") {
    const mapped = LAYOUT_MAP[requested];
    if (mapped) return [mapped];
  }

  const imageCount = slide.metrics.imageCount;

  if (imageCount === 0) return ["text"];

  if (imageCount === 1) {
    if (!hasNonImageContent(slide)) return ["figure"];

    const image = slide.images[0];
    const orientation = image && image.orientation ? image.orientation : "square";
    const ratio = image && image.ratio ? image.ratio : 1;

    if (orientation === "portrait") {
      return ["image-right", "image-left", "image-bottom"];
    }
    if (orientation === "landscape") {
      // An ultra-wide strip (e.g. a 7:1 pipeline) is unreadable in a narrow
      // side column; go straight to a top/bottom stack.
      if (ratio > 2.5) return ["image-bottom", "image-right"];
      if (isLightText(slide)) return ["image-bottom", "image-right"];
      return ["image-right", "image-bottom"];
    }
    return ["image-right", "image-bottom"];
  }

  if (imageCount === 2 || imageCount === 3 || imageCount === 4) return ["grid"];
  return ["gallery"];
}

/** Hard limits from the spec. */
export function layoutErrors(slide) {
  const errors = [];
  const imageCount = slide.metrics.imageCount;

  if (imageCount >= 6 && slide.directives.layout !== "gallery") {
    errors.push(
      `Slide ${slide.number} contains ${imageCount} images. ` +
        `Six or more images require an explicit <!-- layout: gallery --> directive.`,
    );
  }

  return errors;
}

export function layoutWarnings(slide) {
  const warnings = [];
  const imageCount = slide.metrics.imageCount;

  if (imageCount === 3 || imageCount === 4) {
    warnings.push(
      `Slide ${slide.number} contains ${imageCount} images. Confirm the information density is intentional.`,
    );
  }
  if (imageCount === 5) {
    warnings.push(
      `Slide ${slide.number} contains ${imageCount} images. Automatic layout falls back to gallery.`,
    );
  }

  return warnings;
}
