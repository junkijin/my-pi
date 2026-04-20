export type ProviderName = "exa" | "tavily";

export interface UnifiedParams {
	query: string;
	maxResults: number;
}

export interface SearchResultItem {
	title?: string;
	url?: string;
	snippet?: string;
	author?: string;
	publishedDate?: string;
	score?: number;
	source?: string;
}

export interface ProviderSearchResult {
	provider: ProviderName;
	answer?: string;
	items: SearchResultItem[];
	rawText?: string;
}

export type ProviderSearch = (
	params: UnifiedParams,
	signal: AbortSignal,
) => Promise<ProviderSearchResult>;

export interface ProviderDefinition {
	name: ProviderName;
	search: ProviderSearch;
}

export interface SearchToolDetails {
	query: string;
	maxResults: number;
	provider: ProviderName;
	fallbackFrom?: ProviderName;
	resultCount: number;
}

export interface ToolUpdatePayload {
	content?: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
}

export interface TruncationMeta {
	outputLines: number;
	totalLines: number;
	outputBytes: number;
	totalBytes: number;
}
