import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";

export const TOOL_NAME = "fetch_url";
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 120;
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
export const PREVIEW_LINES = 8;
export const HTML_ROOT_SELECTOR = "main, article, [role='main'], body";
export const SANITIZE_SELECTOR = "script, style, noscript, template, iframe, object, embed";
export const BLOCK_SELECTOR =
  "address, article, aside, blockquote, br, div, dl, dt, dd, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, thead, tbody, tfoot, tr, ul";

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const TEXTUAL_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/manifest+json",
  "application/xml",
  "application/xhtml+xml",
  "application/rss+xml",
  "application/atom+xml",
  "application/javascript",
  "application/x-javascript",
  "application/ecmascript",
  "image/svg+xml",
]);

export function getToolDescription(): string {
  return (
    `Fetch content from a URL. Supports text, markdown, and HTML. ` +
    `Images (png/jpg/gif/webp) are returned as attachments. ` +
    `Text output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever hits first).`
  );
}
