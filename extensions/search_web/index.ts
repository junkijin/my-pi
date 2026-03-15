import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	MAX_MAX_RESULTS,
	MIN_MAX_RESULTS,
	TOOL_NAME,
	getPromptGuidelines,
	getToolDescription,
} from "./shared/config";
import { formatProviderResult } from "./shared/formatter";
import { normalizeParams } from "./shared/params";
import { executeWithFallback } from "./shared/provider-runner";
import { PROVIDERS } from "./shared/providers";
import type { ToolUpdatePayload } from "./shared/types";
import {
	formatOutput,
	getTruncationNotice,
	summarizeForPreview,
	writeTempOutput,
} from "./shared/utils";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: TOOL_NAME,
		description: getToolDescription(),
		promptSnippet:
			"Search the live web for current information, external sources, and fast factual verification.",
		promptGuidelines: getPromptGuidelines(),
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			maxResults: Type.Optional(
				Type.Number({
					minimum: MIN_MAX_RESULTS,
					maximum: MAX_MAX_RESULTS,
					description: "Number of search results to return (default: 10)",
				}),
			),
		}),
		renderCall(args, theme) {
			const query =
				typeof args?.query === "string" ? theme.fg("accent", ` \"${args.query}\"`) : "";
			const text = theme.fg("toolTitle", `${theme.bold(TOOL_NAME)}${query}`);
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) {
				return new Text(`\n${theme.fg("warning", "Searching...")}`, 0, 0);
			}

			const fullText = (result.content?.[0]?.text ?? "").trim();
			const preview = summarizeForPreview(fullText);

			if (!expanded) {
				const hint = keyHint("expandTools", "to expand");
				return new Text(`\n${preview}\n(${hint})`, 0, 0);
			}

			return new Text(`\n${fullText || theme.fg("dim", "(empty response)")}`, 0, 0);
		},
		async execute(_toolCallId, rawParams, signal, onUpdate) {
			const params = normalizeParams(rawParams);
			const update = onUpdate as ((payload: ToolUpdatePayload) => void) | undefined;
			const { result, details } = await executeWithFallback(params, PROVIDERS, signal, update);
			const content = formatProviderResult(result);
			const formatted = formatOutput(content);
			let output = formatted.output;

			if (formatted.truncated) {
				const fullOutputPath = await writeTempOutput(content);
				output += getTruncationNotice(formatted.meta, fullOutputPath);
			}

			return {
				content: [{ type: "text", text: output }],
				details,
			};
		},
	});
}
