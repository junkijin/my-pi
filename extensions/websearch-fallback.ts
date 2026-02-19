/**
 * WebSearch Fallback Tool
 *
 * Tavily-based web search tool to use when the built-in WebSearchTool is not working.
 * Uses Tavily MCP endpoint for search results.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	keyHint,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const API_CONFIG = {
	BASE_URL: "https://mcp.tavily.com/mcp",
	DEFAULT_MAX_RESULTS: 10,
} as const;

const REQUEST_TIMEOUT_MS = 25_000;
const TOOL_NAME = "websearch_fallback";

interface McpSearchRequest {
	jsonrpc: string;
	id: number;
	method: string;
	params: {
		name: string;
		arguments: {
			query: string;
			max_results?: number;
			search_depth?: "ultra-fast" | "fast" | "basic" | "advanced";
			time_range?: "day" | "week" | "month" | "year";
			start_date?: string;
			end_date?: string;
		};
	};
}

interface TavilySearchResult {
	title: string;
	url: string;
	content: string;
	score?: number;
}

interface McpSearchResponse {
	jsonrpc: string;
	result?: {
		content?: Array<{
			type: string;
			text: string;
		}>;
	};
}

interface SearchDetails {
	query: string;
	maxResults: number;
	searchDepth?: string;
	timeRange?: string;
	startDate?: string;
	endDate?: string;
}

/**
 * Combines an optional abort signal with a timeout signal.
 * @param signal - Optional parent signal to listen to
 * @param timeoutMs - Timeout in milliseconds
 * @returns Combined signal and cleanup function
 */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	if (!signal) {
		return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
	}

	if (signal.aborted) {
		controller.abort();
		return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
	}

	const onAbort = () => controller.abort();
	signal.addEventListener("abort", onAbort, { once: true });

	const clear = () => {
		clearTimeout(timeoutId);
		signal.removeEventListener("abort", onAbort);
	};

	return { signal: controller.signal, clear };
}

/**
 * Writes output to a temporary file when truncation occurs.
 * @param text - Content to write to the file
 * @returns Path to the created temporary file
 */
async function writeTempOutput(text: string) {
	const dir = path.join(os.tmpdir(), "pi-tool-output");
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(
		dir,
		`websearch-fallback-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
	);
	await fs.writeFile(file, text, "utf8");
	return file;
}

/**
 * Generates the tool description with the current year for context.
 * @returns Dynamic description string
 */
function getDescription() {
	const year = new Date().getFullYear();
	return (
		"Use this tool if WebSearchTool is not working. Searches the web using Tavily API. " +
		`The current year is ${year}. You MUST use this year when searching for recent information. ` +
		"Results are truncated at 50KB or 2000 lines."
	);
}

/**
 * Builds a JSON-RPC request object for the Tavily MCP search endpoint.
 * @param params - Search parameters including query, maxResults, etc.
 * @returns McpSearchRequest object ready for JSON serialization
 */
function buildSearchRequest(params: {
	query: string;
	maxResults?: number;
	searchDepth?: "ultra-fast" | "fast" | "basic" | "advanced";
	timeRange?: "day" | "week" | "month" | "year";
	startDate?: string;
	endDate?: string;
}): McpSearchRequest {
	return {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: {
			name: "tavily_search",
			arguments: {
				query: params.query,
				max_results: params.maxResults ?? API_CONFIG.DEFAULT_MAX_RESULTS,
				search_depth: params.searchDepth,
				time_range: params.timeRange,
				start_date: params.startDate,
				end_date: params.endDate,
			},
		},
	};
}

interface ParseError {
	type: "parse_error";
	message: string;
	cause?: Error;
}

/**
 * Parses the SSE response from Tavily MCP endpoint.
 * @param responseText - The raw response text from the API
 * @returns Array of search results or a ParseError object if parsing fails
 */
function parseResponseText(
	responseText: string,
): TavilySearchResult[] | ParseError {
	const lines = responseText.split("\n");
	let lastParseError: Error | undefined;

	for (const line of lines) {
		if (!line.startsWith("data: ")) {
			continue;
		}

		let data: McpSearchResponse;
		try {
			data = JSON.parse(line.slice(6));
		} catch (e) {
			lastParseError = e instanceof Error ? e : new Error(String(e));
			continue;
		}

		const contentText = data.result?.content?.[0]?.text;
		if (!contentText) {
			continue;
		}

		try {
			// Tavily returns JSON string in the text field
			const parsed = JSON.parse(contentText);
			if (parsed.results && Array.isArray(parsed.results)) {
				return parsed.results as TavilySearchResult[];
			}
		} catch (e) {
			lastParseError = e instanceof Error ? e : new Error(String(e));
		}
	}

	return {
		type: "parse_error",
		message: lastParseError
			? `Failed to parse search response: ${lastParseError.message}`
			: "No valid search results found in response",
		cause: lastParseError,
	};
}

/**
 * Formats search results into a human-readable string.
 * @param results - Array of Tavily search results
 * @returns Formatted string with numbered results
 */
function formatResults(results: TavilySearchResult[]): string {
	return results
		.map((r) => {
			let text = `Title: ${r.title}\n`;
			text += `Url: ${r.url}\n`;
			if (r.content) {
				text += `Content: ${r.content}\n`;
			}
			return text;
		})
		.join("\n");
}

/**
 * Truncates content if it exceeds size/line limits.
 * @param content - The content to potentially truncate
 * @returns Object with output text and truncation metadata
 */
function formatOutput(content: string) {
	const truncation = truncateHead(content, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	let output = truncation.content;
	if (!truncation.truncated) {
		return { output, truncated: false as const };
	}

	return {
		output,
		truncated: true as const,
		meta: {
			outputLines: truncation.outputLines,
			totalLines: truncation.totalLines,
			outputBytes: truncation.outputBytes,
			totalBytes: truncation.totalBytes,
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: "WebSearch Fallback",
		description: getDescription(),
		parameters: Type.Object({
			query: Type.String({ maxLength: 400, description: "Search query" }),
			maxResults: Type.Optional(
				Type.Number({
					minimum: 1,
					maximum: 20,
					description: "Number of search results to return (default: 10)",
				}),
			),
			searchDepth: Type.Optional(
				StringEnum(["ultra-fast", "fast", "basic", "advanced"] as const, {
					description: "Search depth for the search",
				}),
			),
			timeRange: Type.Optional(
				StringEnum(["day", "week", "month", "year"] as const, {
					description: "Time range for the search",
				}),
			),
			startDate: Type.Optional(
				Type.String({
					pattern: "^\\d{4}-\\d{2}-\\d{2}$",
					description: "Start date in YYYY-MM-DD format",
				}),
			),
			endDate: Type.Optional(
				Type.String({
					pattern: "^\\d{4}-\\d{2}-\\d{2}$",
					description: "End date in YYYY-MM-DD format",
				}),
			),
		}),
		renderCall(args, theme) {
			const query =
				typeof args?.query === "string" ? theme.fg("accent", ` "${args.query}"`) : "";
			const text = theme.fg("toolTitle", `${theme.bold(TOOL_NAME)}${query}`);
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
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			// Validate API key before making request
			if (!process.env.TAVILY_API_KEY) {
				throw new Error(
					"TAVILY_API_KEY environment variable is not set. " +
						"Please set it to use the websearch fallback tool.",
				);
			}

			// Validate query
			const query = params.query?.trim();
			if (!query) {
				throw new Error("Search query cannot be empty");
			}

			// Validate date range
			if (params.startDate && params.endDate) {
				const start = new Date(params.startDate);
				const end = new Date(params.endDate);
				if (start > end) {
					throw new Error(
						`Invalid date range: start date (${params.startDate}) cannot be after end date (${params.endDate})`,
					);
				}
			}

			const { signal: combinedSignal, clear } = combineSignals(
				signal,
				REQUEST_TIMEOUT_MS,
			);

			const searchRequest = buildSearchRequest({
				...params,
				query,
			});

			try {
				const response = await fetch(API_CONFIG.BASE_URL, {
					method: "POST",
					headers: {
						accept: "application/json, text/event-stream",
						"content-type": "application/json",
						authorization: `Bearer ${process.env.TAVILY_API_KEY || ""}`,
						"x-client-source": "claude-code-skill",
					},
					body: JSON.stringify(searchRequest),
					signal: combinedSignal,
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Search error (${response.status}): ${errorText}`);
				}

				const responseText = await response.text();
				const results = parseResponseText(responseText);

				// Build details for the response
				const details: SearchDetails = {
					query,
					maxResults: params.maxResults ?? API_CONFIG.DEFAULT_MAX_RESULTS,
					searchDepth: params.searchDepth,
					timeRange: params.timeRange,
					startDate: params.startDate,
					endDate: params.endDate,
				};

				if ("type" in results && results.type === "parse_error") {
					throw new Error(results.message, { cause: results.cause });
				}

				if (results.length === 0) {
					return {
						content: [
							{ type: "text", text: "No search results found. Please try a different query." },
						],
						details,
					};
				}

				const content = formatResults(results);
				const formatted = formatOutput(content);
				let output = formatted.output;

				if (formatted.truncated) {
					const tempFile = await writeTempOutput(content);
					output +=
						`\n\n[Output truncated: ${formatted.meta.outputLines} of ${formatted.meta.totalLines} lines ` +
						`(${formatSize(formatted.meta.outputBytes)} of ${formatSize(formatted.meta.totalBytes)}). ` +
						`Full output saved to: ${tempFile}]`;
				}

				return {
					content: [{ type: "text", text: output }],
					details,
				};
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					throw new Error("Search request timed out");
				}
				throw error;
			} finally {
				clear();
			}
		},
	});
}
