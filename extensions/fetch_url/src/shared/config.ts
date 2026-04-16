import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";

export const TOOL_NAME = "fetch_url";
export const TOOL_PROMPT_SNIPPET =
  "Fetch a remote URL and return clean markdown, plain text, raw HTML, or a supported image attachment.";
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 120;
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

export function getPromptGuidelines(): string[] {
  return [
    "Use format: markdown for normal web pages unless the user explicitly wants raw HTML or plain text.",
    "Use format: html only when the user explicitly asks for original markup.",
  ];
}

export function getToolDescription(): string {
  return (
    `Fetch content from a URL. Supports text, markdown, and HTML. ` +
    `Images (png/jpg/gif/webp) are returned as attachments. ` +
    `Text output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever hits first).`
  );
}
