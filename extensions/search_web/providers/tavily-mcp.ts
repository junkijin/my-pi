import {
	callMcpTool,
	findAnswer,
	normalizeStructuredResults,
} from "../shared/mcp";
import type { ProviderSearchResult, UnifiedParams } from "../shared/types";
import { cleanTextBlock, dedupeResults } from "../shared/utils";

const TAVILY_MCP_URL = process.env.TAVILY_MCP_URL?.trim() || "https://mcp.tavily.com/mcp";

export async function searchTavilyMcp(
	params: UnifiedParams,
	signal: AbortSignal,
	apiKey: string,
	toolName: string,
): Promise<ProviderSearchResult> {
	const response = await callMcpTool({
		endpoint: TAVILY_MCP_URL,
		toolName,
		arguments_: {
			query: params.query,
			max_results: params.maxResults,
		},
		headers: {
			authorization: `Bearer ${apiKey}`,
		},
		signal,
	});

	const payloads = response.structuredPayloads;
	const normalized = payloads.length > 0
		? {
				answer: payloads.map(findAnswer).find((value): value is string => Boolean(value)),
				items: dedupeResults(payloads.flatMap((payload) => normalizeStructuredResults(payload))),
			}
		: { answer: undefined, items: [] };
	const rawText = cleanTextBlock(response.textParts.join("\n\n"));

	if (normalized.items.length === 0 && !normalized.answer && !rawText) {
		throw new Error(`Tavily MCP (${toolName}) returned empty content`);
	}

	return {
		provider: "tavily",
		answer: normalized.answer,
		items: normalized.items,
		rawText,
	};
}
