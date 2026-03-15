import type { ProviderSearch, ProviderSearchResult } from "../shared/types";
import { searchTavilyMcp } from "./tavily-mcp";
import { searchTavilyRest } from "./tavily-rest";

const TAVILY_MCP_TOOL_CANDIDATES = unique([
	process.env.TAVILY_MCP_TOOL?.trim(),
	"tavily-search",
	"tavily_search",
]);

export const searchTavily: ProviderSearch = async (
	params,
	signal,
): Promise<ProviderSearchResult> => {
	const apiKey = process.env.TAVILY_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("TAVILY_API_KEY environment variable is not set");
	}

	let restError: Error | null = null;
	try {
		return await searchTavilyRest(params, signal, apiKey);
	} catch (error) {
		restError = error instanceof Error ? error : new Error(String(error));
	}

	let mcpError: Error | null = null;
	for (const toolName of TAVILY_MCP_TOOL_CANDIDATES) {
		try {
			return await searchTavilyMcp(params, signal, apiKey, toolName);
		} catch (error) {
			mcpError = error instanceof Error ? error : new Error(String(error));
		}
	}

	throw new Error(
		`Tavily fallback failed. REST: ${restError?.message ?? "unknown error"}. ` +
			`MCP: ${mcpError?.message ?? "unknown error"}`,
	);
};

function unique(values: Array<string | undefined>) {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
