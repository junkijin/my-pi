import type { ProviderSearchResult } from "./types";

export function formatProviderResult(result: ProviderSearchResult) {
	const lines: string[] = [];

	if (result.answer) {
		lines.push(`Answer: ${result.answer}`);
	}

	if (result.items.length > 0) {
		if (lines.length > 0) {
			lines.push("");
		}
		lines.push(`Results (${result.items.length}):`);

		result.items.forEach((item, index) => {
			lines.push("");
			lines.push(`${index + 1}. ${item.title ?? "Untitled result"}`);
			if (item.url) {
				lines.push(`   URL: ${item.url}`);
			}
			if (item.author) {
				lines.push(`   Author: ${item.author}`);
			}
			if (item.publishedDate) {
				lines.push(`   Published: ${item.publishedDate}`);
			}
			if (item.source) {
				lines.push(`   Source: ${item.source}`);
			}
			if (typeof item.score === "number") {
				lines.push(`   Score: ${item.score.toFixed(3)}`);
			}
			if (item.snippet) {
				lines.push(`   Snippet: ${item.snippet}`);
			}
		});
	}

	if (lines.length === 0 && result.rawText) {
		return result.rawText;
	}

	if (lines.length === 0) {
		return "(empty response)";
	}

	if (result.rawText && result.items.length === 0 && !result.answer) {
		lines.push("", result.rawText);
	}

	return lines.join("\n").trim();
}
