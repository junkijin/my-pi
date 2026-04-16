import { REQUEST_TIMEOUT_MS } from "./config";
import type {
	ProviderDefinition,
	ProviderName,
	SearchToolDetails,
	ToolUpdatePayload,
	UnifiedParams,
} from "./types";
import { combineSignals, isAbortError } from "./utils";

async function callProvider(
	provider: ProviderDefinition,
	params: UnifiedParams,
	signal?: AbortSignal,
) {
	const { signal: combinedSignal, clear } = combineSignals(signal, REQUEST_TIMEOUT_MS);
	try {
		return await provider.search(params, combinedSignal);
	} catch (error) {
		if (isAbortError(error)) {
			throw new Error("Search request timed out");
		}
		throw error;
	} finally {
		clear();
	}
}

export async function executeWithFallback(
	params: UnifiedParams,
	providers: ProviderDefinition[],
	signal: AbortSignal | undefined,
	onUpdate?: (update: ToolUpdatePayload) => void,
) {
	const failures: Array<{ provider: ProviderName; error: Error }> = [];

	for (const [index, provider] of providers.entries()) {
		onUpdate?.({
			content: [
				{
					type: "text",
					text: index === 0 ? "Searching..." : "Primary search failed. Retrying...",
				},
			],
			details: {
				query: params.query,
				maxResults: params.maxResults,
				provider: provider.name,
				phase: index === 0 ? "primary" : "fallback",
			},
		});

		try {
			const result = await callProvider(provider, params, signal);
			return {
				result,
				details: buildSearchToolDetails(params, providers, index, result.rawText, result.items.length),
			};
		} catch (error) {
			const normalized = error instanceof Error ? error : new Error(String(error));
			failures.push({ provider: provider.name, error: normalized });
		}
	}

	const message = failures
		.map(({ provider, error }) => `${provider}: ${error.message}`)
		.join(" | ");
	throw new Error(`Search failed with all providers. ${message}`);
}

function buildSearchToolDetails(
	params: UnifiedParams,
	providers: ProviderDefinition[],
	providerIndex: number,
	rawText: string | undefined,
	itemCount: number,
): SearchToolDetails {
	return {
		query: params.query,
		maxResults: params.maxResults,
		provider: providers[providerIndex].name,
		fallbackFrom: providerIndex > 0 ? providers[providerIndex - 1]?.name : undefined,
		resultCount: itemCount > 0 ? itemCount : rawText ? 1 : 0,
	};
}
