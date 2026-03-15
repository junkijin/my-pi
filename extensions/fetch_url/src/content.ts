import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_RESPONSE_SIZE,
  PREVIEW_LINES,
  SUPPORTED_IMAGE_MIME_TYPES,
  TEXTUAL_MIME_TYPES,
} from "./constants";
import { htmlToMarkdown, htmlToText, normalizeWhitespace } from "./html";
import type { FetchExecution, FetchUrlDetails, OutputFormat } from "./types";

export function getCharsetFromContentType(contentType: string | null): string | undefined {
  const match = contentType?.match(/charset\s*=\s*['\"]?([^;'\"\s]+)/i);
  return match?.[1]?.trim().toLowerCase();
}

export function sniffCharsetFromBuffer(buffer: Buffer): string | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "utf-8";
  }

  if (buffer.length >= 2) {
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return "utf-16be";
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return "utf-16le";
  }

  const sniff = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
  const metaCharset =
    sniff.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'>/]+)/i)?.[1] ??
    sniff.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([^\s"';>]+)/i)?.[1];

  return metaCharset?.trim().toLowerCase();
}

export function decodeText(
  buffer: Buffer,
  contentType: string | null,
): { text: string; charset?: string } {
  const charset = getCharsetFromContentType(contentType) ?? sniffCharsetFromBuffer(buffer) ?? "utf-8";

  try {
    return {
      text: new TextDecoder(charset, { fatal: false }).decode(buffer),
      charset,
    };
  } catch {
    return {
      text: new TextDecoder("utf-8", { fatal: false }).decode(buffer),
      charset: charset === "utf-8" ? charset : "utf-8",
    };
  }
}

export function isTextualMimeType(mimeType: string): boolean {
  if (!mimeType) return false;
  if (mimeType.startsWith("text/")) return true;
  if (TEXTUAL_MIME_TYPES.has(mimeType)) return true;
  if (mimeType.endsWith("+json") || mimeType.endsWith("+xml")) return true;
  return false;
}

export function looksLikeHtml(text: string): boolean {
  return /<(?:!doctype\s+html|html|head|body|main|article|section|div|p|h1|h2|table|ul|ol|a)\b/i.test(
    text,
  );
}

export function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let suspicious = 0;

  for (const byte of sample) {
    if (byte === 0) return true;
    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13;
    if (isControl) suspicious += 1;
  }

  return suspicious / sample.length > 0.2;
}

export function sniffImageMimeType(buffer: Buffer): string | undefined {
  if (buffer.length >= 8) {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (png.every((byte, index) => buffer[index] === byte)) return "image/png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return undefined;
}

export async function writeFullOutput(output: string, format: OutputFormat): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-fetch-url-"));
  const extension = format === "html" ? "html" : format === "markdown" ? "md" : "txt";
  const tempFile = join(tempDir, `output.${extension}`);
  await writeFile(tempFile, output, "utf-8");
  return tempFile;
}

export async function applyTruncation(output: string, format: OutputFormat) {
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return {
      text: truncation.content,
      truncation: undefined,
      fullOutputPath: undefined as string | undefined,
    };
  }

  const fullOutputPath = await writeFullOutput(output, format);
  let text = truncation.content;
  text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
  text += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  text += ` Full output saved to: ${fullOutputPath}]`;

  return {
    text,
    truncation,
    fullOutputPath,
  };
}

export function summarizeForPreview(resultText: string): string {
  const trimmed = resultText.trim();
  if (!trimmed) return "(empty response)";
  return trimmed.split("\n").slice(0, PREVIEW_LINES).join("\n");
}

export function buildImageResult(
  url: string,
  mimeType: string,
  buffer: Buffer,
  details: FetchUrlDetails,
): FetchExecution {
  return {
    details: {
      ...details,
      image: {
        mimeType,
        bytes: buffer.length,
      },
    },
    content: [
      {
        type: "text",
        text: `Fetched image [${mimeType}] from ${url} (${formatSize(buffer.length)})`,
      },
      {
        type: "image",
        data: buffer.toString("base64"),
        mimeType,
      },
    ],
  };
}

export function renderTextualContent(
  buffer: Buffer,
  contentType: string | null,
  mimeType: string,
  requestedFormat: OutputFormat,
  finalUrl: string,
): { output: string; title?: string; description?: string; charset?: string } {
  const decoded = decodeText(buffer, contentType);
  const rawText = decoded.text;
  const isHtml = mimeType === "text/html" || mimeType === "application/xhtml+xml" || looksLikeHtml(rawText);

  if (requestedFormat === "html") {
    return {
      output: rawText.trim(),
      charset: decoded.charset,
    };
  }

  if (isHtml) {
    const converted =
      requestedFormat === "markdown"
        ? htmlToMarkdown(rawText, finalUrl)
        : htmlToText(rawText, finalUrl);

    return {
      output: converted.text,
      title: converted.title,
      description: converted.description,
      charset: decoded.charset,
    };
  }

  return {
    output: normalizeWhitespace(rawText),
    charset: decoded.charset,
  };
}

export function isSupportedImageMimeType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType);
}

export function ensureWithinMaxResponseSize(contentLength?: number) {
  if (contentLength && Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_SIZE) {
    throw new Error(`Response too large (exceeds ${formatSize(MAX_RESPONSE_SIZE)} limit)`);
  }
}
