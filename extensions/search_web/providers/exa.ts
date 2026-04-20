import type { ProviderSearch, ProviderSearchResult } from "../shared/types";
import { callMcpTool } from "../shared/mcp";
import { cleanTextBlock } from "../shared/utils";
import { parseExaResults } from "./exa-parser";

const EXA_ENDPOINT = process.env.EXA_MCP_URL?.trim() || "https://mcp.exa.ai/mcp";
const EXA_TOOL_NAME = process.env.EXA_MCP_TOOL?.trim() || "web_search_exa";

export const searchExa: ProviderSearch = async (
	params,
	signal,
): Promise<ProviderSearchResult> => {
	const response = await callMcpTool({
		endpoint: EXA_ENDPOINT,
		toolName: EXA_TOOL_NAME,
		arguments_: {
			query: params.query,
			numResults: params.maxResults,
		},
		headers: buildHeaders(),
		signal,
	});

	const rawText = cleanTextBlock(response.textParts.join("\n\n"));
	const items = parseExaResults(rawText);

	if (items.length === 0 && !rawText) {
		throw new Error("Exa search returned empty content");
	}

	return {
		provider: "exa",
		items,
		rawText,
	};
};

function buildHeaders() {
	const apiKey = process.env.EXA_API_KEY?.trim();
	if (!apiKey) {
		return undefined;
	}

	return {
		EXA_API_KEY: apiKey,
	};
}
