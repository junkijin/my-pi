import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { executeFetch } from "./fetch/execute";
import { normalizeTimeoutSeconds, validateUrl } from "./fetch/network";
import {
  MAX_TIMEOUT_SECONDS,
  TOOL_NAME,
  TOOL_PROMPT_SNIPPET,
  getPromptGuidelines,
  getToolDescription,
} from "./shared/config";
import type { OutputFormat, ToolProgressUpdate } from "./shared/types";
import { renderCall, renderResult } from "./ui/render";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: TOOL_NAME,
    description: getToolDescription(),
    promptSnippet: TOOL_PROMPT_SNIPPET,
    promptGuidelines: getPromptGuidelines(),
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
