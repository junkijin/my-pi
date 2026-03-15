import type {
	ProviderSearch,
	ProviderSearchResult,
	UnifiedParams,
} from "../shared/types";

const EXA_ENDPOINT = "https://mcp.exa.ai/mcp";
const EXA_MCP_TOOL_NAME = "web_search_exa";

interface McpSearchRequest {
	jsonrpc: "2.0";
	id: number;
	method: "tools/call";
	params: {
		name: string;
		arguments: {
			query: string;
			numResults: number;
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

function buildSearchRequest(params: UnifiedParams): McpSearchRequest {
	return {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: {
			name: EXA_MCP_TOOL_NAME,
			arguments: {
				query: params.query,
				numResults: params.maxResults,
			},
		},
	};
}

function parseExaContent(responseText: string) {
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
		if (text && text.trim().length > 0) {
			return text;
		}
	}

	return "";
}

export const searchExa: ProviderSearch = async (
	params,
	signal,
): Promise<ProviderSearchResult> => {
	const response = await fetch(EXA_ENDPOINT, {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
		},
		body: JSON.stringify(buildSearchRequest(params)),
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Exa search error (${response.status}): ${errorText}`);
	}

	const responseText = await response.text();
	const content = parseExaContent(responseText);
	if (!content) {
		throw new Error("Exa search returned empty content");
	}

	return { content };
};
