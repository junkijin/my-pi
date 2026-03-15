import type {
	ProviderSearch,
	ProviderSearchResult,
	UnifiedParams,
} from "../shared/types";

const TAVILY_ENDPOINT = "https://mcp.tavily.com/mcp";
const TAVILY_MCP_TOOL_NAME = "tavily_search";

interface McpSearchRequest {
	jsonrpc: "2.0";
	id: number;
	method: "tools/call";
	params: {
		name: string;
		arguments: {
			query: string;
			max_results: number;
		};
	};
}

interface McpSearchResponse {
	result?: {
		content?: Array<{
			text?: string;
		}>;
	};
}

interface TavilySearchPayload {
	results?: TavilySearchResult[];
}

interface TavilySearchResult {
	title?: string;
	url?: string;
	content?: string;
}

function buildSearchRequest(params: UnifiedParams): McpSearchRequest {
	return {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: {
			name: TAVILY_MCP_TOOL_NAME,
			arguments: {
				query: params.query,
				max_results: params.maxResults,
			},
		},
	};
}

function parseTavilyResults(responseText: string) {
	for (const line of responseText.split("\n")) {
		if (!line.startsWith("data: ")) {
			continue;
		}

		const payload = line.slice(6).trim();
		if (!payload || payload === "[DONE]") {
			continue;
		}

		let data: McpSearchResponse;
		try {
			data = JSON.parse(payload);
		} catch {
			continue;
		}

		const text = data.result?.content?.[0]?.text;
		if (!text) {
			continue;
		}

		try {
			const parsed = JSON.parse(text) as TavilySearchPayload;
			if (Array.isArray(parsed.results)) {
				return parsed.results;
			}
		} catch {
			continue;
		}
	}

	return [];
}

function formatResults(results: TavilySearchResult[]) {
	return results
		.map((result) => {
			const lines: string[] = [
				`Title: ${result.title ?? ""}`,
				`Url: ${result.url ?? ""}`,
			];

			if (result.content) {
				lines.push(`Content: ${result.content}`);
			}

			return lines.join("\n");
		})
		.join("\n\n");
}

export const searchTavily: ProviderSearch = async (
	params,
	signal,
): Promise<ProviderSearchResult> => {
	if (!process.env.TAVILY_API_KEY) {
		throw new Error("TAVILY_API_KEY environment variable is not set");
	}

	const response = await fetch(TAVILY_ENDPOINT, {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
		},
		body: JSON.stringify(buildSearchRequest(params)),
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Tavily search error (${response.status}): ${errorText}`);
	}

	const responseText = await response.text();
	const results = parseTavilyResults(responseText);
	if (results.length === 0) {
		throw new Error("Tavily search returned empty content");
	}

	return {
		content: formatResults(results),
	};
};
