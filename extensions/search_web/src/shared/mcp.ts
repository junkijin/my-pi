import type { SearchResultItem } from "./types";
import {
	cleanTextBlock,
	clipText,
	dedupeResults,
	isRecord,
	safeJsonParse,
	stripMarkdownCodeFence,
	toNonEmptyString,
} from "./utils";

interface McpToolCallOptions {
	endpoint: string;
	toolName: string;
	arguments_: Record<string, unknown>;
	headers?: Record<string, string>;
	signal: AbortSignal;
}

interface JsonRpcErrorShape {
	code?: number;
	message?: string;
	data?: unknown;
}

export interface McpToolCallResult {
	responseText: string;
	result: Record<string, unknown>;
	textParts: string[];
	structuredPayloads: unknown[];
}

export async function callMcpTool(options: McpToolCallOptions): Promise<McpToolCallResult> {
	const response = await fetch(options.endpoint, {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			...(options.headers ?? {}),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: Date.now(),
			method: "tools/call",
			params: {
				name: options.toolName,
				arguments: options.arguments_,
			},
		}),
		signal: options.signal,
	});

	const responseText = await response.text();
	if (!response.ok) {
		throw new Error(
			`${options.toolName} request failed (${response.status}): ${cleanTextBlock(responseText) || response.statusText}`,
		);
	}

	const payloads = parseMcpPayloads(responseText);
	let lastError: JsonRpcErrorShape | null = null;

	for (let index = payloads.length - 1; index >= 0; index -= 1) {
		const payload = payloads[index];
		if (!isRecord(payload)) {
			continue;
		}

		if (isRecord(payload.error)) {
			lastError = payload.error as JsonRpcErrorShape;
		}

		if (!isRecord(payload.result)) {
			continue;
		}

		const result = payload.result;
		const textParts = extractTextParts(result);
		const structuredPayloads = extractStructuredPayloads(result, textParts);
		return {
			responseText,
			result,
			textParts,
			structuredPayloads,
		};
	}

	if (lastError) {
		throw new Error(formatJsonRpcError(lastError));
	}

	throw new Error("MCP server returned no tool result payload");
}

export function normalizeStructuredResults(value: unknown): SearchResultItem[] {
	const items: SearchResultItem[] = [];
	visitForResults(value, items, 0);
	return dedupeResults(items);
}

export function findAnswer(value: unknown): string | undefined {
	return findAnswerRecursive(value, 0);
}

function parseMcpPayloads(responseText: string): unknown[] {
	const trimmed = responseText.trim();
	if (!trimmed) {
		return [];
	}

	const directJson = safeJsonParse<unknown>(trimmed);
	if (directJson !== undefined) {
		return [directJson];
	}

	const payloads: unknown[] = [];
	for (const chunk of parseSseDataChunks(trimmed)) {
		const parsed = safeJsonParse<unknown>(chunk);
		payloads.push(parsed ?? chunk);
	}
	return payloads;
}

function parseSseDataChunks(input: string): string[] {
	const events = input.split(/\r?\n\r?\n/g);
	const chunks: string[] = [];

	for (const event of events) {
		const dataLines = event
			.split(/\r?\n/g)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart());

		if (dataLines.length === 0) {
			continue;
		}

		const chunk = dataLines.join("\n").trim();
		if (!chunk || chunk === "[DONE]") {
			continue;
		}

		chunks.push(chunk);
	}

	return chunks;
}

function extractTextParts(result: Record<string, unknown>): string[] {
	const content = result.content;
	if (!Array.isArray(content)) {
		return [];
	}

	const textParts: string[] = [];
	for (const item of content) {
		if (!isRecord(item)) {
			continue;
		}

		const text = toNonEmptyString(item.text);
		if (text) {
			textParts.push(text);
		}
	}

	return textParts;
}

function extractStructuredPayloads(result: Record<string, unknown>, textParts: string[]) {
	const payloads: unknown[] = [];

	const structuredContent = result.structuredContent;
	if (structuredContent !== undefined) {
		payloads.push(structuredContent);
	}

	for (const text of textParts) {
		const parsed = safeJsonParse<unknown>(stripMarkdownCodeFence(text));
		if (parsed !== undefined) {
			payloads.push(parsed);
		}
	}

	return payloads;
}

function formatJsonRpcError(error: JsonRpcErrorShape) {
	const pieces = [error.message ?? "Unknown MCP error"];
	if (typeof error.code === "number") {
		pieces.unshift(`MCP error ${error.code}`);
	}
	if (error.data !== undefined) {
		const detail =
			typeof error.data === "string"
				? error.data
				: clipText(cleanTextBlock(JSON.stringify(error.data)), 400);
		if (detail) {
			pieces.push(detail);
		}
	}
	return pieces.join(": ");
}

function visitForResults(value: unknown, items: SearchResultItem[], depth: number) {
	if (depth > 8 || value == null) {
		return;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			const item = toSearchResultItem(entry);
			if (item) {
				items.push(item);
				continue;
			}
			visitForResults(entry, items, depth + 1);
		}
		return;
	}

	if (!isRecord(value)) {
		return;
	}

	const directItem = toSearchResultItem(value);
	if (directItem) {
		items.push(directItem);
	}

	for (const key of ["results", "items", "sources", "documents", "data"]) {
		const candidate = value[key];
		if (Array.isArray(candidate)) {
			visitForResults(candidate, items, depth + 1);
		}
	}

	for (const nested of Object.values(value)) {
		if (nested !== value) {
			visitForResults(nested, items, depth + 1);
		}
	}
}

function toSearchResultItem(value: unknown): SearchResultItem | null {
	if (!isRecord(value)) {
		return null;
	}

	const title = firstString(value, ["title", "name", "headline"]);
	const url = firstUrl(value, ["url", "uri", "link", "source"]);
	const snippet = firstString(value, ["content", "snippet", "description", "text", "summary", "raw_content"]);
	const author = firstString(value, ["author", "byline"]);
	const publishedDate = firstString(value, [
		"published_date",
		"publishedDate",
		"published_at",
		"publishedAt",
		"date",
		"created_at",
		"createdAt",
	]);
	const source = firstString(value, ["source", "site", "domain"]);
	const score = typeof value.score === "number" ? value.score : undefined;

	if (!title && !url && !snippet) {
		return null;
	}

	return {
		title: title ? cleanTextBlock(title) : undefined,
		url,
		snippet: snippet ? clipText(cleanTextBlock(snippet), 2000) : undefined,
		author: author ? cleanTextBlock(author) : undefined,
		publishedDate: publishedDate ? cleanTextBlock(publishedDate) : undefined,
		source: source ? cleanTextBlock(source) : undefined,
		score,
	};
}

function findAnswerRecursive(value: unknown, depth: number): string | undefined {
	if (depth > 8 || value == null) {
		return undefined;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			const answer = findAnswerRecursive(entry, depth + 1);
			if (answer) {
				return answer;
			}
		}
		return undefined;
	}

	if (!isRecord(value)) {
		return undefined;
	}

	for (const key of ["answer", "response"]) {
		const text = toNonEmptyString(value[key]);
		if (text) {
			return cleanTextBlock(text);
		}
	}

	for (const nested of Object.values(value)) {
		const answer = findAnswerRecursive(nested, depth + 1);
		if (answer) {
			return answer;
		}
	}

	return undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		const value = toNonEmptyString(record[key]);
		if (value) {
			return value;
		}
	}
	return undefined;
}

function firstUrl(record: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		const value = toNonEmptyString(record[key]);
		if (value && /^https?:\/\//i.test(value)) {
			return value;
		}
	}
	return undefined;
}
