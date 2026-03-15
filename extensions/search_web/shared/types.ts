export interface UnifiedParams {
	query: string;
	maxResults: number;
}

export interface ProviderSearchResult {
	content: string;
}

export type ProviderSearch = (
	params: UnifiedParams,
	signal: AbortSignal,
) => Promise<ProviderSearchResult>;

export interface TruncationMeta {
	outputLines: number;
	totalLines: number;
	outputBytes: number;
	totalBytes: number;
}
