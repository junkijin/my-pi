import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SearchResultItem, TruncationMeta } from "./types";

export function combineSignals(signal: AbortSignal | undefined, timeoutMs: number) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	if (!signal) {
		return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
	}

	if (signal.aborted) {
		controller.abort(signal.reason);
		return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
	}

	const onAbort = () => controller.abort(signal.reason);
	signal.addEventListener("abort", onAbort, { once: true });

	const clear = () => {
		clearTimeout(timeoutId);
		signal.removeEventListener("abort", onAbort);
	};

	return { signal: controller.signal, clear };
}

export function isAbortError(error: unknown) {
	return error instanceof Error && error.name === "AbortError";
}

export function formatOutput(content: string) {
	const truncation = truncateHead(content, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	if (!truncation.truncated) {
		return {
			output: truncation.content,
			truncated: false as const,
		};
	}

	const meta: TruncationMeta = {
		outputLines: truncation.outputLines,
		totalLines: truncation.totalLines,
		outputBytes: truncation.outputBytes,
		totalBytes: truncation.totalBytes,
	};

	return {
		output: truncation.content,
		truncated: true as const,
		meta,
	};
}

export async function writeTempOutput(content: string) {
	const dir = path.join(os.tmpdir(), "pi-tool-output");
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(
		dir,
		`search-web-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
	);
	await fs.writeFile(file, content, "utf8");
	return file;
}

export function getTruncationNotice(meta: TruncationMeta, fullOutputPath: string) {
	return (
		`\n\n[Output truncated: ${meta.outputLines} of ${meta.totalLines} lines ` +
		`(${formatSize(meta.outputBytes)} of ${formatSize(meta.totalBytes)}). ` +
		`Full output saved to: ${fullOutputPath}]`
	);
}

export function cleanTextBlock(value: string) {
	return value
		.replace(/\r\n/g, "\n")
		.replace(/[\t\f\v]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function clipText(value: string, maxChars: number) {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function stripMarkdownCodeFence(value: string) {
	const trimmed = value.trim();
	const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match ? match[1].trim() : trimmed;
}

export function safeJsonParse<T>(value: string): T | undefined {
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toNonEmptyString(value: unknown) {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function extractLeadParagraphs(
	value: string,
	options: { maxParagraphs: number; maxChars: number },
) {
	const cleaned = cleanTextBlock(value);
	if (!cleaned) {
		return "";
	}

	const paragraphs = cleaned
		.split(/\n\s*\n/g)
		.map((paragraph) => cleanTextBlock(paragraph))
		.filter((paragraph) => isUsefulParagraph(paragraph));

	if (paragraphs.length === 0) {
		return clipText(cleaned, options.maxChars);
	}

	const selected: string[] = [];
	let length = 0;

	for (const paragraph of paragraphs) {
		const nextLength = length + paragraph.length + (selected.length > 0 ? 2 : 0);
		if (selected.length >= options.maxParagraphs || nextLength > options.maxChars) {
			break;
		}
		selected.push(paragraph);
		length = nextLength;
	}

	if (selected.length === 0) {
		selected.push(clipText(paragraphs[0], options.maxChars));
	}

	return selected.join("\n\n");
}

export function dedupeResults(items: SearchResultItem[]) {
	const seen = new Set<string>();
	const deduped: SearchResultItem[] = [];

	for (const item of items) {
		const key = normalizeResultKey(item);
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(item);
	}

	return deduped;
}

export function summarizeForPreview(fullText: string) {
	const normalized = cleanTextBlock(fullText);
	if (!normalized) {
		return "(empty response)";
	}

	const lines = normalized.split("\n");
	return lines.slice(0, 8).join("\n");
}

function isUsefulParagraph(value: string) {
	if (value.length < 40) {
		return false;
	}
	if (/^(title|author|published date|url|text):/i.test(value)) {
		return false;
	}
	if (/^[-#*_\s]+$/.test(value)) {
		return false;
	}
	if (/^#{1,6}\s/.test(value)) {
		return false;
	}
	if (/lorem ipsum/i.test(value)) {
		return false;
	}
	if (!/[.!?。！？]/.test(value) && value.length < 140) {
		return false;
	}
	return /[A-Za-z0-9가-힣]/.test(value);
}

function normalizeResultKey(item: SearchResultItem) {
	if (item.url) {
		return item.url.toLowerCase();
	}
	if (item.title) {
		return item.title.toLowerCase();
	}
	if (item.snippet) {
		return item.snippet.toLowerCase();
	}
	return undefined;
}
