import type {
	ProviderSearchResult,
	SearchResultItem,
	UnifiedParams,
} from "../shared/types";
import { cleanTextBlock } from "../shared/utils";

const TAVILY_API_URL = process.env.TAVILY_API_URL?.trim() || "https://api.tavily.com/search";

interface TavilyApiResult {
	title?: string;
	url?: string;
	content?: string;
	score?: number;
	raw_content?: string | null;
}

interface TavilyApiResponse {
	answer?: string;
	results?: TavilyApiResult[];
}

export async function searchTavilyRest(
	params: UnifiedParams,
	signal: AbortSignal,
	apiKey: string,
): Promise<ProviderSearchResult> {
	const response = await fetch(TAVILY_API_URL, {
		method: "POST",
		headers: {
			accept: "application/json",
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			query: params.query,
			max_results: params.maxResults,
			search_depth: "basic",
			include_answer: "basic",
			include_raw_content: false,
		}),
		signal,
	});

	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`Tavily REST search failed (${response.status}): ${cleanTextBlock(text) || response.statusText}`,
		);
	}

	let data: TavilyApiResponse;
	try {
		data = JSON.parse(text) as TavilyApiResponse;
	} catch {
		throw new Error("Tavily REST response was not valid JSON");
	}

	const items = Array.isArray(data.results)
		? data.results.map(mapTavilyResult).filter((item): item is SearchResultItem => item !== null)
		: [];

	if (items.length === 0 && !data.answer) {
		throw new Error("Tavily REST search returned empty content");
	}

	return {
		provider: "tavily",
		answer: typeof data.answer === "string" ? cleanTextBlock(data.answer) : undefined,
		items,
		rawText: items.length === 0 ? cleanTextBlock(text) : undefined,
	};
}

function mapTavilyResult(result: TavilyApiResult): SearchResultItem | null {
	const title = typeof result.title === "string" ? cleanTextBlock(result.title) : undefined;
	const url = typeof result.url === "string" ? result.url.trim() : undefined;
	const snippet = typeof result.content === "string" ? cleanTextBlock(result.content) : undefined;
	const score = typeof result.score === "number" ? result.score : undefined;

	if (!title && !url && !snippet) {
		return null;
	}

	return {
		title,
		url,
		snippet,
		score,
	};
}
