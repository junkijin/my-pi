import type { SearchResultItem } from "../shared/types";
import { cleanTextBlock, dedupeResults, extractLeadParagraphs } from "../shared/utils";

export function parseExaResults(rawText: string): SearchResultItem[] {
	if (!rawText) {
		return [];
	}

	const blocks = rawText
		.split(/(?=^Title:\s)/gm)
		.map((block) => block.trim())
		.filter(Boolean);

	const items = (blocks.length > 0 ? blocks : [rawText])
		.map(parseExaBlock)
		.filter((item): item is SearchResultItem => item !== null);

	return dedupeResults(items);
}

function parseExaBlock(block: string): SearchResultItem | null {
	const lines = block.split(/\r?\n/);
	let title: string | undefined;
	let author: string | undefined;
	let publishedDate: string | undefined;
	let url: string | undefined;
	const bodyLines: string[] = [];
	let inBody = false;

	for (const line of lines) {
		if (!inBody && line.startsWith("Title:")) {
			title = line.slice("Title:".length).trim();
			continue;
		}
		if (!inBody && line.startsWith("Author:")) {
			author = line.slice("Author:".length).trim();
			continue;
		}
		if (!inBody && line.startsWith("Published Date:")) {
			publishedDate = line.slice("Published Date:".length).trim();
			continue;
		}
		if (!inBody && line.startsWith("URL:")) {
			url = line.slice("URL:".length).trim();
			continue;
		}
		if (!inBody && line.startsWith("Text:")) {
			inBody = true;
			const rest = line.slice("Text:".length).trim();
			if (rest) {
				bodyLines.push(rest);
			}
			continue;
		}
		if (inBody) {
			bodyLines.push(line);
		}
	}

	const body = cleanTextBlock(bodyLines.join("\n"));
	const snippetSource = pruneNoisyLeadParagraphs(body || block, title, author);
	const snippet = extractLeadParagraphs(snippetSource, {
		maxParagraphs: 1,
		maxChars: 1600,
	});

	if (!title && !url && !snippet) {
		return null;
	}

	return {
		title: title ? cleanTextBlock(title) : undefined,
		author: author ? cleanTextBlock(author) : undefined,
		publishedDate: publishedDate ? cleanTextBlock(publishedDate) : undefined,
		url,
		snippet,
	};
}

function pruneNoisyLeadParagraphs(
	text: string,
	title: string | undefined,
	author: string | undefined,
) {
	const normalizedTitle = title?.replace(/\s+/g, " ").trim().toLowerCase();
	const normalizedAuthor = author?.replace(/\s+/g, " ").trim().toLowerCase();
	const paragraphs = cleanTextBlock(text)
		.split(/\n\s*\n/g)
		.map((paragraph) => cleanTextBlock(paragraph))
		.filter(Boolean);

	const filtered = paragraphs.filter((paragraph) => {
		const normalized = paragraph
			.replace(/^#{1,6}\s*/, "")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase();

		if (!normalized) {
			return false;
		}
		if (normalizedTitle && normalized === normalizedTitle) {
			return false;
		}
		if (/^(by|add us on|see full bio)$/i.test(paragraph)) {
			return false;
		}
		if (/(getty|shutterstock|reuters|associated press|ap photo|bloomberg)/i.test(paragraph) && paragraph.length < 220) {
			return false;
		}
		if (normalizedAuthor && normalized.startsWith(`${normalizedAuthor} is `)) {
			return false;
		}
		if (!/[.!?。！？]/.test(paragraph) && paragraph.length < 140) {
			return false;
		}
		return true;
	});

	return filtered.join("\n\n") || text;
}
