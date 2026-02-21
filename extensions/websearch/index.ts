import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { searchExa } from "./providers/exa";
import { searchTavily } from "./providers/tavily";
import type { ProviderSearch, UnifiedParams } from "./shared/types";
import {
	REQUEST_TIMEOUT_MS,
	combineSignals,
	formatOutput,
	getTruncationNotice,
	isAbortError,
	writeTempOutput,
} from "./shared/utils";

const TOOL_NAME = "websearch";
const DEFAULT_MAX_RESULTS = 10;
const MIN_MAX_RESULTS = 5;
const MAX_MAX_RESULTS = 20;

function getDescription() {
	const year = new Date().getFullYear();
	return (
		"Search the web using Exa AI with automatic Tavily fallback on failure. " +
		`The current year is ${year}. You MUST use this year when searching for recent information. ` +
		"Results are truncated at 50KB or 2000 lines."
	);
}

function normalizeParams(params: { query: string; maxResults?: number }): UnifiedParams {
	const query = params.query?.trim();
	if (!query) {
		throw new Error("Search query cannot be empty");
	}

	const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;
	if (maxResults < MIN_MAX_RESULTS || maxResults > MAX_MAX_RESULTS) {
		throw new Error(`maxResults must be between ${MIN_MAX_RESULTS} and ${MAX_MAX_RESULTS}`);
	}

	return { query, maxResults };
}

async function callProvider(
	provider: ProviderSearch,
	params: UnifiedParams,
	signal?: AbortSignal,
) {
	const { signal: combinedSignal, clear } = combineSignals(signal, REQUEST_TIMEOUT_MS);
	try {
		return await provider(params, combinedSignal);
	} catch (error) {
		if (isAbortError(error)) {
			throw new Error("Search request timed out");
		}
		throw error;
	} finally {
		clear();
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: TOOL_NAME,
		description: getDescription(),
		parameters: Type.Object({
			query: Type.String({ description: "Websearch query" }),
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
			const text = theme.fg("toolTitle", `${theme.bold(`${TOOL_NAME}`)}${query}`);
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) {
				return new Text(`\n${theme.fg("warning", "Searching...")}`, 0, 0);
			}

			const full = (result.content?.[0]?.text ?? "").trim();
			const lines = full.split("\n");
			const short = lines.slice(0, 8).join("\n");

			if (!expanded) {
				const hint = keyHint("expandTools", "to expand");
				const body = short.length > 0 ? `${short}\n(${hint})` : hint;
				return new Text(`\n${body}`, 0, 0);
			}

			return new Text(`\n${full}`, 0, 0);
		},
		async execute(_toolCallId, rawParams, signal, _onUpdate, _ctx) {
			const params = normalizeParams(rawParams);
			const details = {
				query: params.query,
				maxResults: params.maxResults,
			};

			let content: string | null = null;
			let exaError: Error | null = null;

			try {
				const exaResult = await callProvider(searchExa, params, signal);
				content = exaResult.content;
			} catch (error) {
				exaError = error instanceof Error ? error : new Error(String(error));
			}

			if (!content) {
				try {
					const tavilyResult = await callProvider(searchTavily, params, signal);
					content = tavilyResult.content;
				} catch (error) {
					const tavilyError = error instanceof Error ? error : new Error(String(error));
					const exaMessage = exaError?.message ?? "Unknown Exa error";
					throw new Error(
						`Websearch failed with both providers. Exa: ${exaMessage}. Tavily: ${tavilyError.message}`,
					);
				}
			}

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
