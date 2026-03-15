import type { TextContent } from "@mariozechner/pi-ai";
import {
  applyTruncation,
  buildImageResult,
  ensureWithinMaxResponseSize,
  isSupportedImageMimeType,
  isTextualMimeType,
  looksBinary,
  renderTextualContent,
  sniffImageMimeType,
} from "./content";
import { buildAcceptHeader, createAbortResources, getMimeType, isAbortError, readResponseBody } from "./network";
import type { FetchExecution, FetchUrlDetails, OutputFormat, ToolProgressUpdate } from "./types";

export async function executeFetch(
  url: URL,
  format: OutputFormat,
  timeoutSeconds: number,
  signal: AbortSignal | undefined,
  onUpdate?: (update: ToolProgressUpdate) => void,
): Promise<FetchExecution> {
  onUpdate?.({
    content: [{ type: "text", text: `Fetching ${url.toString()}...` } as TextContent],
    details: { phase: "fetching", url: url.toString() },
  });

  const { signal: requestSignal, cleanup } = createAbortResources(signal, timeoutSeconds * 1000);

  try {
    const response = await fetch(url, {
      signal: requestSignal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept: buildAcceptHeader(format),
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status} ${response.statusText}`.trim());
    }

    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : undefined;
    ensureWithinMaxResponseSize(contentLength);

    const buffer = await readResponseBody(response, requestSignal);
    const contentType = response.headers.get("content-type");
    const headerMimeType = getMimeType(contentType);
    const sniffedImageMimeType = sniffImageMimeType(buffer);
    const mimeType = sniffedImageMimeType ?? headerMimeType;
    const finalUrl = response.url || url.toString();

    const baseDetails: FetchUrlDetails = {
      requestedUrl: url.toString(),
      finalUrl,
      format,
      status: response.status,
      statusText: response.statusText,
      mimeType: mimeType || headerMimeType || "unknown",
      bytes: buffer.length,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    };

    if (mimeType && isSupportedImageMimeType(mimeType)) {
      return buildImageResult(finalUrl, mimeType, buffer, baseDetails);
    }

    if (!isTextualMimeType(mimeType) && looksBinary(buffer)) {
      throw new Error(
        `Unsupported binary content type: ${mimeType || "unknown"}. This tool currently returns text, markdown, html, or supported image attachments only.`,
      );
    }

    const rendered = renderTextualContent(buffer, contentType, mimeType, format, finalUrl);
    const truncated = await applyTruncation(rendered.output, format);

    return {
      details: {
        ...baseDetails,
        charset: rendered.charset,
        title: rendered.title,
        description: rendered.description,
        truncation: truncated.truncation,
        fullOutputPath: truncated.fullOutputPath,
      },
      content: [{ type: "text", text: truncated.text }],
    };
  } catch (error) {
    if (isAbortError(error) || requestSignal.aborted) {
      throw new Error(`Request timed out after ${timeoutSeconds} seconds`);
    }
    throw error;
  } finally {
    cleanup();
  }
}
