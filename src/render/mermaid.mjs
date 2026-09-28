/**
 * Mermaid -> SVG at build time.
 *
 * Mermaid is never rendered at runtime. The diagram is rasterised (as vector
 * SVG) during the build so HTML, PDF and PPTX are byte-identical.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { chromium } from "playwright";
import { orientationOf, parseSvgSize } from "./image-layout.mjs";

const MERMAID_THEME_VARIABLES = {
  background: "#ffffff",
  primaryColor: "#ffffff",
  primaryTextColor: "#222222",
  primaryBorderColor: "#222222",
  secondaryColor: "#ffffff",
  tertiaryColor: "#ffffff",
  lineColor: "#222222",
  textColor: "#222222",
  mainBkg: "#ffffff",
  nodeBorder: "#222222",
  clusterBkg: "#ffffff",
  edgeLabelBackground: "#ffffff",
  fontFamily: "Lato, 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif",
  fontSize: "16px",
};

function collectMermaidBlocks(doc) {
  const found = [];
  for (const slide of doc.slides) {
    for (const block of slide.blocks) {
      if (block.type === "mermaid") found.push({ slide, block });
    }
  }
  return found;
}

function withWhiteBackground(svg) {
  if (/<rect[^>]*width="100%"/i.test(svg.slice(0, 400))) return svg;
  return svg.replace(/<svg\b([^>]*)>/i, `<svg$1><rect width="100%" height="100%" fill="#ffffff"/>`);
}

/**
 * @returns {Promise<{warnings: string[], errors: string[], files: Array<{from:string,to:string}>}>}
 */
export async function hydrateMermaid(doc, { assetsDir }) {
  const warnings = [];
  const errors = [];
  const files = [];
  const targets = collectMermaidBlocks(doc);
  if (targets.length === 0) return { warnings, errors, files };

  let mermaidPath;
  try {
    const require = createRequire(import.meta.url);
    mermaidPath = require.resolve("mermaid/dist/mermaid.min.js");
  } catch {
    for (const { slide, block } of targets) {
      block.mermaidError = true;
      warnings.push(
        `Slide ${slide.number}: mermaid is not installed; rendering the diagram as a code block.`,
      );
    }
    return { warnings, errors, files };
  }

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();

    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: mermaidPath });
    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        // eslint-disable-next-line no-undef
        themeVariables: window.__gseMermaidTheme || {},
      });
    });

    // theme variables are passed as a JSON payload to avoid quoting issues
    await page.evaluate((theme) => {
      // eslint-disable-next-line no-undef
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: theme });
    }, MERMAID_THEME_VARIABLES);

    await mkdir(assetsDir, { recursive: true });

    for (const { slide, block } of targets) {
      try {
        const svg = await page.evaluate(async (code) => {
          const id = "gseMermaid" + Math.random().toString(36).slice(2);
          // eslint-disable-next-line no-undef
          const result = await window.mermaid.render(id, code);
          return result.svg;
        }, block.code);

        const withBg = withWhiteBackground(svg);
        const hash = createHash("sha256").update(block.code).digest("hex").slice(0, 12);
        const fileName = `mermaid-${hash}.svg`;
        const outPath = path.join(assetsDir, fileName);
        await writeFile(outPath, withBg, "utf8");

        const size = parseSvgSize(withBg);
        block.outputSrc = fileName;
        block.mermaidError = false;

        if (block.image) {
          if (size) {
            block.image.width = size.width;
            block.image.height = size.height;
            block.image.ratio = size.width / size.height;
            block.image.orientation = orientationOf(block.image.ratio);
          }
          block.image.outputSrc = fileName;
        }

        files.push({ from: outPath, to: outPath });
      } catch (error) {
        block.mermaidError = true;
        warnings.push(
          `Slide ${slide.number}: failed to render mermaid diagram (${error.message}); falling back to a code block.`,
        );
      }
    }
  } catch (error) {
    errors.push(`Mermaid rendering failed: ${error.message}.`);
    for (const { block } of targets) block.mermaidError = true;
  } finally {
    if (browser) await browser.close();
  }

  return { warnings, errors, files };
}
