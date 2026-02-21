import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TruncationMeta } from "./types";

export const REQUEST_TIMEOUT_MS = 25_000;

export function combineSignals(signal: AbortSignal | undefined, timeoutMs: number) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	if (!signal) {
		return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
	}

	if (signal.aborted) {
		controller.abort();
		return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
	}

	const onAbort = () => controller.abort();
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
		`websearch-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
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
