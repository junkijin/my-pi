import type { UnifiedParams } from "./types";
import {
	DEFAULT_MAX_RESULTS,
	MAX_MAX_RESULTS,
	MIN_MAX_RESULTS,
} from "./config";

export function normalizeParams(params: { query: string; maxResults?: number }): UnifiedParams {
	const query = params.query?.trim();
	if (!query) {
		throw new Error("Search query cannot be empty");
	}

	const rawMaxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;
	if (!Number.isFinite(rawMaxResults)) {
		throw new Error("maxResults must be a finite number");
	}

	const maxResults = Math.trunc(rawMaxResults);
	if (maxResults !== rawMaxResults) {
		throw new Error("maxResults must be an integer");
	}
	if (maxResults < MIN_MAX_RESULTS || maxResults > MAX_MAX_RESULTS) {
		throw new Error(`maxResults must be between ${MIN_MAX_RESULTS} and ${MAX_MAX_RESULTS}`);
	}

	return { query, maxResults };
}
