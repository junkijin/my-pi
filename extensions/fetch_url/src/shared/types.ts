import type { TruncationResult } from "@mariozechner/pi-coding-agent";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";

export type OutputFormat = "text" | "markdown" | "html";

export type FetchUrlDetails = {
  requestedUrl: string;
  finalUrl: string;
  format: OutputFormat;
  status: number;
  statusText: string;
  mimeType: string;
  charset?: string;
  title?: string;
  description?: string;
  bytes: number;
  contentLength?: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
  image?: {
    mimeType: string;
    bytes: number;
  };
};

export type FetchExecution = {
  details: FetchUrlDetails;
  content: (TextContent | ImageContent)[];
};

export type AbortResources = {
  signal: AbortSignal;
  cleanup: () => void;
};

export type ToolProgressUpdate = {
  content?: TextContent[];
  details?: Record<string, unknown>;
};
