/**
 * Markdown engine.
 *
 * Responsibilities:
 *   - build the markdown-it instance (GFM-ish + KaTeX math)
 *   - server-side syntax highlighting (so the built HTML needs no JS)
 *   - fence-aware slide separation and safe slide splitting
 *
 * Everything here is parse-only. No HTML layout decisions are made here.
 */

import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js";

const PLAIN_LANGS = new Set(["", "text", "txt", "plain", "plaintext", "none", "raw"]);

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createEngine() {
  const md = new MarkdownIt({
    html: true,
    linkify: false,
    typographer: false,
    breaks: false,
    xhtmlOut: false,
  });

  md.use(texmath, {
    engine: katex,
    delimiters: "dollars",
    katexOptions: { throwOnError: false, output: "html" },
  });

  return md;
}

/** Highlight a code block at build time. Returns raw HTML. */
export function highlightCode(code, lang) {
  const language = String(lang || "").trim().toLowerCase();
  if (PLAIN_LANGS.has(language)) return escapeHtml(code);
  try {
    if (hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
  } catch {
    return escapeHtml(code);
  }
  return escapeHtml(code);
}

/**
 * Make `---` separators behave as thematic breaks even when the author forgot
 * the blank line before them (otherwise markdown turns the previous line into a
 * setext H2). Fenced code blocks are never touched.
 */
export function normalizeSeparators(content) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let fence = null;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      out.push(line);
      continue;
    }

    if (fence === null && /^-{3,}\s*$/.test(line)) {
      const prev = out.length ? out[out.length - 1] : "";
      if (prev.trim() !== "") out.push("");
      out.push(line);
      out.push("");
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

/**
 * Split a top-level token stream into slides on thematic breaks.
 * @returns {Array<Array<object>>}
 */
export function splitSlideTokens(tokens) {
  const groups = [];
  let current = [];

  for (const token of tokens) {
    if (token.type === "hr" && token.level === 0) {
      groups.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  groups.push(current);

  return groups.filter((group) => group.length > 0);
}
