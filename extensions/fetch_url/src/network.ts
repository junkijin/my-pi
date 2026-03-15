import { formatSize } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_TIMEOUT_SECONDS,
  MAX_RESPONSE_SIZE,
  MAX_TIMEOUT_SECONDS,
} from "./constants";
import type { AbortResources, OutputFormat } from "./types";

export function validateUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http:// or https://");
  }

  return url;
}

export function normalizeTimeoutSeconds(timeout?: number): number {
  if (timeout === undefined) {
    return DEFAULT_TIMEOUT_SECONDS;
  }

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("timeout must be a positive number of seconds");
  }

  return Math.min(timeout, MAX_TIMEOUT_SECONDS);
}

export function createAbortResources(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortResources {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);

  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", forwardAbort);
      }
    },
  };
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError";
}

export function getMimeType(contentType: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function buildAcceptHeader(format: OutputFormat): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.95, text/html;q=0.9, text/plain;q=0.8, application/xhtml+xml;q=0.7, application/json;q=0.6, */*;q=0.1";
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.95, text/html;q=0.9, application/xhtml+xml;q=0.7, application/json;q=0.6, */*;q=0.1";
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.95, text/plain;q=0.8, text/markdown;q=0.7, application/json;q=0.6, */*;q=0.1";
  }
}

export async function readResponseBody(response: Response, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_SIZE) {
        throw new Error(`Response too large (exceeds ${formatSize(MAX_RESPONSE_SIZE)} limit)`);
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}
