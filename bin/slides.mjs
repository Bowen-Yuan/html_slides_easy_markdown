#!/usr/bin/env node
/**
 * gse-slides CLI
 *
 *   slides dev   slides.md   local server + watch + live reload
 *   slides build slides.md   dist/index.html + dist/assets (offline)
 *   slides pdf   slides.md   dist/slides.pdf
 *   slides pptx  slides.md   dist/slides.pptx
 *   slides lint  slides.md   asset / overflow / density checks
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import chokidar from "chokidar";

import { compile, recomputeLayoutCandidates } from "../src/compiler/compile.mjs";
import { ASPECTS } from "../src/parser/frontmatter.mjs";
import { renderDocument } from "../src/render/html.mjs";
import { hydrateMermaid } from "../src/render/mermaid.mjs";
import { applyResolutions, formatLintReport, probeLayouts } from "../src/lint/overflow.mjs";
import { exportPdf } from "../src/export/pdf.mjs";
import { exportPptx } from "../src/export/pptx.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const THEME_FILES = [
  ["node_modules/reveal.js/dist/reveal.css", "reveal.css"],
  ["node_modules/reveal.js/dist/reveal.js", "reveal.js"],
  ["node_modules/katex/dist/katex.min.css", "katex.min.css"],
  ["src/theme/gse.css", "gse.css"],
  ["src/theme/highlight.css", "highlight.css"],
];

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);

function resolvePaths(fileArg) {
  const sourcePath = path.resolve(process.cwd(), fileArg || "slides.md");
  const baseDir = path.dirname(sourcePath);
  const distDir = path.resolve(process.cwd(), "dist");
  return {
    sourcePath,
    baseDir,
    distDir,
    assetsDir: path.join(distDir, "assets"),
    htmlPath: path.join(distDir, "index.html"),
    cacheDir: path.join(ROOT, ".cache", "gse-slides", "remote"),
  };
}

async function copyTheme(paths) {
  await mkdir(paths.assetsDir, { recursive: true });
  for (const [from, to] of THEME_FILES) {
    await cp(path.join(ROOT, from), path.join(paths.assetsDir, to));
  }
  await cp(
    path.join(ROOT, "node_modules/katex/dist/fonts"),
    path.join(paths.assetsDir, "fonts"),
    { recursive: true },
  );
}

async function copyUserAssets(doc, paths) {
  for (const slide of doc.slides) {
    for (const image of slide.images) {
      if (image.mermaid) continue;

      if (image.remote) {
        if (image.outputSrc && image.absPath) {
          await mkdir(paths.assetsDir, { recursive: true });
          await cp(image.absPath, path.join(paths.assetsDir, image.outputSrc));
        }
        continue;
      }

      if (!image.exists || !image.absPath) continue;

      const relative = decodeURIComponent(image.src.split(/[?#]/)[0]);
      const destination = path.join(paths.distDir, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(image.absPath, destination);
    }
  }
}

async function loadDocument(paths) {
  const raw = await readFile(paths.sourcePath, "utf8");
  const doc = await compile(raw, {
    sourcePath: paths.sourcePath,
    baseDir: paths.baseDir,
    assetsDir: paths.assetsDir,
    cacheDir: paths.cacheDir,
  });

  try {
    const mermaid = await hydrateMermaid(doc, { assetsDir: paths.assetsDir });
    doc.warnings.push(...mermaid.warnings);
    doc.errors.push(...mermaid.errors);
    recomputeLayoutCandidates(doc);
  } catch (error) {
    doc.warnings.push(`Mermaid stage skipped: ${error.message}.`);
  }

  doc.warnings = [...new Set(doc.warnings)];
  return doc;
}

function printDocMessages(doc) {
  for (const error of doc.errors) warn(`ERROR  ${error}`);
  for (const warning of doc.warnings) warn(`WARN   ${warning}`);
}

/**
 * Compile + prepare assets + probe layouts + write dist/index.html.
 * Never exits on its own.
 */
async function buildOnce(paths, { print = true } = {}) {
  // Start from a clean assets directory so a removed/renamed asset never
  // lingers in dist/.
  await rm(paths.assetsDir, { recursive: true, force: true });
  await rm(path.join(paths.distDir, ".probe.html"), { force: true });

  const doc = await loadDocument(paths);

  if (doc.errors.length > 0) {
    if (print) printDocMessages(doc);
    return { doc, errors: doc.errors, resolutions: [], htmlPath: null };
  }

  await copyTheme(paths);
  await copyUserAssets(doc, paths);

  const { resolutions } = await probeLayouts(doc, { probeDir: paths.distDir });
  const layoutErrors = applyResolutions(resolutions);

  if (print) {
    for (const warning of doc.warnings) warn(`WARN   ${warning}`);
    for (const error of layoutErrors) warn(`ERROR  ${error}`);
  }

  if (layoutErrors.length > 0) {
    return { doc, errors: layoutErrors, resolutions, htmlPath: null };
  }

  const html = renderDocument(doc);
  await writeFile(paths.htmlPath, html, "utf8");
  await rm(path.join(paths.distDir, ".probe.html"), { force: true });

  return { doc, errors: [], resolutions, htmlPath: paths.htmlPath };
}

/* ------------------------------------------------------------------ commands */

async function cmdBuild(fileArg) {
  const paths = resolvePaths(fileArg);
  const { doc, errors } = await buildOnce(paths);

  if (errors.length > 0) {
    warn(`\nBuild failed: ${errors.length} error(s). dist/index.html was not updated.`);
    warn("Typography is fixed. Fix the content, do not shrink the text.");
    process.exitCode = 1;
    return;
  }

  log(`Built ${path.relative(process.cwd(), paths.htmlPath)}  (${doc.slides.length} slides)`);
  if (doc.warnings.length) warn(`${doc.warnings.length} warning(s).`);
}

async function cmdLint(fileArg) {
  const paths = resolvePaths(fileArg);
  const { doc, errors, resolutions } = await buildOnce(paths, { print: false });

  log(`GSE Slides lint: ${path.relative(process.cwd(), paths.sourcePath)}`);
  log(`Slides: ${doc.slides.length}`);
  log("");

  for (const warning of doc.warnings) warn(`WARN   ${warning}`);
  for (const error of errors) warn(`ERROR  ${error}`);

  const overflowReport = formatLintReport(doc, resolutions);
  if (overflowReport) {
    warn("");
    warn(overflowReport);
  }

  log("");
  if (errors.length === 0) {
    log(`OK  no layout errors. ${doc.warnings.length} warning(s).`);
  } else {
    warn(`FAILED  ${errors.length} error(s).`);
    process.exitCode = 1;
  }
}

async function exportWith(fileArg, exporter, extension) {
  const paths = resolvePaths(fileArg);
  const { doc, errors } = await buildOnce(paths);

  if (errors.length > 0) {
    warn(`Cannot export ${extension}: the build has ${errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }

  const dims = ASPECTS[doc.meta.aspect] || ASPECTS["4:3"];

  if (extension === "pdf") {
    const result = await exportPdf({
      htmlPath: paths.htmlPath,
      outPath: path.join(paths.distDir, "slides.pdf"),
      width: dims.width,
      height: dims.height,
      slideCount: doc.slides.length,
    });
    log(`Wrote ${path.relative(process.cwd(), result.outPath)}  (${doc.slides.length} slides, ${result.pages ?? "?"} PDF pages)`);
    if (result.pages && result.pages !== doc.slides.length) {
      warn(
        `WARN   PDF has ${result.pages} pages but the deck has ${doc.slides.length} slides. Check print CSS.`,
      );
    }
    return;
  }

  const result = await exportPptx({
    htmlPath: paths.htmlPath,
    outPath: path.join(paths.distDir, "slides.pptx"),
    width: dims.width,
    height: dims.height,
  });
  log(`Wrote ${path.relative(process.cwd(), result.outPath)}  (${result.slides} slides @ 2x)`);
}

async function cmdDev(fileArg) {
  const paths = resolvePaths(fileArg);
  const { errors } = await buildOnce(paths);

  if (errors.length > 0) {
    warn("Initial build failed. The server will start anyway and rebuild on change.");
  }

  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: path.join(ROOT, "vite.config.js"),
    root: paths.distDir,
    logLevel: "warn",
    server: { open: false },
  });
  await server.listen();
  server.printUrls();

  let building = false;
  let queued = false;

  const rebuild = async () => {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    try {
      const result = await buildOnce(paths);
      if (result.errors.length === 0) {
        log(`\nRebuilt  (${result.doc.slides.length} slides)  ${new Date().toLocaleTimeString()}`);
        server.ws.send({ type: "full-reload", path: "*" });
      } else {
        warn(`\nRebuild failed with ${result.errors.length} error(s).`);
      }
    } finally {
      building = false;
      if (queued) {
        queued = false;
        await rebuild();
      }
    }
  };

  const watcher = chokidar.watch([paths.sourcePath, path.join(paths.baseDir, "assets")], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 120);
  };

  watcher.on("all", schedule);

  log(`\nWatching ${path.relative(process.cwd(), paths.sourcePath)} and its assets/ directory.`);
  log("Press Ctrl+C to stop.");

  const shutdown = async () => {
    await watcher.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const USAGE = `gse-slides

  slides dev   <file.md>   local server, watch, live reload
  slides build <file.md>   dist/index.html + dist/assets
  slides pdf   <file.md>   dist/slides.pdf
  slides pptx  <file.md>   dist/slides.pptx
  slides lint  <file.md>   asset / overflow / density checks

Markdown is the source of truth. Never edit dist/.`;

async function main() {
  const [, , command, fileArg] = process.argv;

  switch (command) {
    case "build":
      await cmdBuild(fileArg);
      break;
    case "dev":
      await cmdDev(fileArg);
      break;
    case "pdf":
      await exportWith(fileArg, exportPdf, "pdf");
      break;
    case "pptx":
      await exportWith(fileArg, exportPptx, "pptx");
      break;
    case "lint":
      await cmdLint(fileArg);
      break;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      log(USAGE);
      break;
    default:
      warn(`Unknown command: ${command}\n`);
      log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  warn(`Fatal: ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});
