import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutputFormat } from "./types";

const PREVIEW_LINES = 8;

async function writeFullOutput(output: string, format: OutputFormat): Promise<string> {
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
