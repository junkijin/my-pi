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
	BASE_URL: "https://mcp.exa.ai",
	ENDPOINTS: {
		SEARCH: "/mcp",
	},
	DEFAULT_NUM_RESULTS: 8,
} as const;

const REQUEST_TIMEOUT_MS = 25_000;
const TOOL_NAME = "websearch";
const MCP_TOOL_NAME = "web_search_exa";
const DEFAULT_LIVECRAWL: "fallback" | "preferred" = "fallback";
const DEFAULT_SEARCH_TYPE: "auto" | "fast" | "deep" = "auto";

interface McpSearchRequest {
	jsonrpc: string;
	id: number;
	method: string;
	params: {
		name: string;
		arguments: {
			query: string;
			numResults?: number;
			livecrawl?: "fallback" | "preferred";
			type?: "auto" | "fast" | "deep";
			contextMaxCharacters?: number;
		};
	};
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

async function writeTempOutput(text: string) {
	const dir = path.join(os.tmpdir(), "pi-tool-output");
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(
		dir,
		`websearch-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
	);
	await fs.writeFile(file, text, "utf8");
	return file;
}

function getDescription() {
	const year = new Date().getFullYear();
	return (
		"Search the web using Exa AI. Use this tool for accessing information beyond knowledge cutoff. " +
		`The current year is ${year}. You MUST use this year when searching for recent information. ` +
		"Results are truncated at 50KB or 2000 lines."
	);
}

function buildSearchRequest(params: {
	query: string;
	numResults?: number;
	livecrawl?: "fallback" | "preferred";
	type?: "auto" | "fast" | "deep";
	contextMaxCharacters?: number;
}): McpSearchRequest {
	return {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: {
			name: MCP_TOOL_NAME,
			arguments: {
				query: params.query,
				type: params.type ?? DEFAULT_SEARCH_TYPE,
				numResults: params.numResults ?? API_CONFIG.DEFAULT_NUM_RESULTS,
				livecrawl: params.livecrawl ?? DEFAULT_LIVECRAWL,
				contextMaxCharacters: params.contextMaxCharacters,
			},
		},
	};
}

function buildDetails(params: {
	query: string;
	numResults?: number;
	livecrawl?: "fallback" | "preferred";
	type?: "auto" | "fast" | "deep";
}) {
	return {
		query: params.query,
		numResults: params.numResults ?? API_CONFIG.DEFAULT_NUM_RESULTS,
		livecrawl: params.livecrawl ?? DEFAULT_LIVECRAWL,
		type: params.type ?? DEFAULT_SEARCH_TYPE,
	};
}

function parseResponseText(responseText: string) {
	for (const line of responseText.split("\n")) {
		if (!line.startsWith("data: ")) {
			continue;
		}
		const data: McpSearchResponse = JSON.parse(line.slice(6));
		const content = data.result?.content?.[0]?.text;
		if (content) {
			return content;
		}
	}
	return null;
}

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
		label: TOOL_NAME,
		description: getDescription(),
		parameters: Type.Object({
			query: Type.String({ description: "Websearch query" }),
			numResults: Type.Optional(
				Type.Number({ description: "Number of search results to return (default: 8)" }),
			),
			livecrawl: Type.Optional(
				StringEnum(["fallback", "preferred"] as const, {
					description:
						"Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
				}),
			),
			type: Type.Optional(
				StringEnum(["auto", "fast", "deep"] as const, {
					description:
						"Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
				}),
			),
			contextMaxCharacters: Type.Optional(
				Type.Number({
					description: "Maximum characters for context string optimized for LLMs (default: 10000)",
				}),
			),
		}),
		renderCall(args, theme) {
			const query = typeof args?.query === "string" ? theme.fg('accent', ` "${args.query}"`) : "";
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
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { signal: combinedSignal, clear } = combineSignals(
				signal,
				REQUEST_TIMEOUT_MS,
			);

			const searchRequest = buildSearchRequest(params);

			try {
				const response = await fetch(
					`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`,
					{
						method: "POST",
						headers: {
							accept: "application/json, text/event-stream",
							"content-type": "application/json",
						},
						body: JSON.stringify(searchRequest),
						signal: combinedSignal,
					},
				);

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Search error (${response.status}): ${errorText}`);
				}

				const responseText = await response.text();
				const content = parseResponseText(responseText);
				const details = buildDetails(params);

				if (!content) {
					return {
						content: [
							{ type: "text", text: "No search results found. Please try a different query." },
						],
						details,
					};
				}

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
