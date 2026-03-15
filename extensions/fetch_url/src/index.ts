import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { MAX_TIMEOUT_SECONDS, TOOL_NAME, getToolDescription } from "./constants";
import { executeFetch } from "./fetch";
import { normalizeTimeoutSeconds, validateUrl } from "./network";
import { renderCall, renderResult } from "./render";
import type { OutputFormat, ToolProgressUpdate } from "./types";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: TOOL_NAME,
    description: getToolDescription(),
    promptSnippet:
      "Fetch a remote URL and return clean markdown, plain text, raw HTML, or a supported image attachment.",
    promptGuidelines: [
      "Use format: markdown for normal web pages unless the user explicitly wants raw HTML or plain text.",
      "Use format: html only when the user explicitly asks for original markup.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch (http/https)" }),
      format: StringEnum(["text", "markdown", "html"] as const, {
        description: "Output format",
        default: "markdown",
      }),
      timeout: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: MAX_TIMEOUT_SECONDS,
          description: `Timeout in seconds (max ${MAX_TIMEOUT_SECONDS})`,
        }),
      ),
    }),
    renderCall,
    renderResult,
    async execute(_toolCallId, params, signal, onUpdate) {
      const url = validateUrl(params.url);
      const format = (params.format ?? "markdown") as OutputFormat;
      const timeoutSeconds = normalizeTimeoutSeconds(params.timeout);

      return executeFetch(
        url,
        format,
        timeoutSeconds,
        signal,
        onUpdate as ((update: ToolProgressUpdate) => void) | undefined,
      );
    },
  });
}
