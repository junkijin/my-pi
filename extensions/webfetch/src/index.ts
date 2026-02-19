import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load as loadHtml } from "cheerio";
import TurndownService from "turndown";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

type WebfetchDetails = {
  truncation?: {
    truncated: boolean;
    truncatedBy: "lines" | "bytes";
    outputLines: number;
    totalLines: number;
    outputBytes: number;
    totalBytes: number;
    firstLineExceedsLimit?: boolean;
  };
  fullOutputPath?: string;
};

type AbortResources = {
  controller: AbortController;
  cleanup: () => void;
};

function getTempFilePath(): string {
  const id = randomBytes(8).toString("hex");
  return join(tmpdir(), `pi-webfetch-${id}.txt`);
}

function buildAcceptHeader(format: "text" | "markdown" | "html"): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
  }
}

function extractTextFromHtml(html: string): string {
  const $ = loadHtml(html);
  $("script, style, noscript, iframe, object, embed").remove();
  const text = $.root().text();
  return text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function convertHtmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  turndown.remove(["script", "style", "meta", "link"]);
  return turndown.turndown(html);
}

function createAbortResources(signal: AbortSignal | undefined, timeoutMs: number): AbortResources {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  };

  return { controller, cleanup };
}

function getMimeType(contentType: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isImageMimeType(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime);
}

function formatBinaryResult(url: string, mime: string, arrayBuffer: ArrayBuffer) {
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const content: (TextContent | ImageContent)[] = [
    { type: "text", text: `Fetched image [${mime}] from ${url}` },
    { type: "image", data: base64, mimeType: mime },
  ];
  return { content, details: {} as WebfetchDetails };
}

function normalizeOutput(raw: string, format: "text" | "markdown" | "html", contentType: string): string {
  if (format === "markdown" && contentType.includes("text/html")) {
    return convertHtmlToMarkdown(raw);
  }

  if (format === "text" && contentType.includes("text/html")) {
    return extractTextFromHtml(raw);
  }

  return raw;
}

function applyTruncation(output: string, format: "text" | "markdown" | "html") {
  const truncation = truncateHead(output);
  let finalText = truncation.content || "";
  let details: WebfetchDetails | undefined;

  if (truncation.truncated) {
    const tempFile = getTempFilePath();

    return writeFile(tempFile, output, "utf-8").then(() => {
      finalText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
      finalText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
      finalText += ` Full output saved to: ${tempFile}]`;

      details = { truncation, fullOutputPath: tempFile };
      return { finalText, details };
    });
  }

  return Promise.resolve({ finalText, details });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "webfetch",
    label: "webfetch",
    description:
      `Fetch content from a URL. Supports text, markdown, and HTML. ` +
      `Images (png/jpg/gif/webp) are returned as attachments. ` +
      `Text output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever hits first).`,
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch (http/https)" }),
      format: StringEnum(["text", "markdown", "html"] as const, {
        description: "Output format",
        default: "markdown",
      }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (max 120)" })),
    }),
    renderCall(args, theme) {
      const url = typeof args?.url === "string" ? theme.fg('accent', ` "${args.url}"`) : "";
			const text = theme.fg("toolTitle", `${theme.bold('webfetch')}${url}`);
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(`\n${theme.fg("warning", "Fetching...")}`, 0, 0);
      }

      const first = result.content?.[0];
      if (!first || first.type !== "text") {
        return new Text(`\n${theme.fg("dim", "(binary content)")}`, 0, 0);
      }

      const full = (first.text ?? "").trim();
      const lines = full.split("\n");
      const short = lines.slice(0, 8).join("\n");

      if (!expanded) {
        const hint = keyHint("expandTools", "to expand");
        const body = short.length > 0 ? `${short}\n(${hint})` : hint;
        return new Text(`\n${body}`, 0, 0);
      }

      return new Text(`\n${full}`, 0, 0);
    },
    async execute(_toolCallId, params, signal) {
      const { url, format } = params;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        throw new Error("URL must start with http:// or https://");
      }

      const timeoutMs = Math.min(
        (params.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000,
        MAX_TIMEOUT_MS,
      );

      const { controller, cleanup } = createAbortResources(signal, timeoutMs);

      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept: buildAcceptHeader(format),
        "Accept-Language": "en-US,en;q=0.9",
      };

      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal, headers });
      } finally {
        cleanup();
      }

      if (!response.ok) {
        throw new Error(`Request failed with status code: ${response.status}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        throw new Error("Response too large (exceeds 5MB limit)");
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
        throw new Error("Response too large (exceeds 5MB limit)");
      }

      const contentType = response.headers.get("content-type") || "";
      const mime = getMimeType(contentType);

      if (isImageMimeType(mime)) {
        return formatBinaryResult(url, mime, arrayBuffer);
      }

      const raw = Buffer.from(arrayBuffer).toString("utf-8");
      const output = normalizeOutput(raw, format, contentType);

      const { finalText, details } = await applyTruncation(output, format);
      return { content: [{ type: "text", text: finalText }], details };
    },
  });
}
