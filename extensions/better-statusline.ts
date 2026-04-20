import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { basename } from "node:path";

function getLeftContext(usage) {
	const remaining = Math.max(0, 100 - (usage?.percent || 0));
	const rounded = Math.round(remaining * 10) / 10;
	return rounded;
}

function formatTokensK(tokens: number | undefined): string {
	if (!tokens) return "0k";
	const k = tokens / 1000;
	return k >= 10 ? `${Math.round(k)}k` : `${Math.round(k * 10) / 10}k`;
}

function getSessionCost(ctx): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			total += entry.message.usage?.cost?.total ?? 0;
		}
	}
	return total;
}

function formatCost(cost: number): string {
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function getExtensionStatuses(footerData): string[] {
	return Array.from(footerData.getExtensionStatuses().entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatusText(text))
		.filter(Boolean);
}

function formatStatusLine(theme, statuses: string[]): string {
	return statuses.join(theme.fg("dim", " · "));
}

function getModelInfo(ctx) {
	const model = ctx.model;
	if (!model) {
		return "model not selected";
	}
	return `${model.provider}/${model.id}`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const usage = ctx.getContextUsage();
					const leftContextPercent = getLeftContext(usage);
					const thinkingLevel = pi.getThinkingLevel();
					const modelName = getModelInfo(ctx);

					const isSub = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
					const cost = getSessionCost(ctx);
					const innerWidth = width;

					const dirName = basename(ctx.cwd);
					const branch = footerData.getGitBranch();
					const dirLabel = theme.fg("dim", branch ? `${dirName} (${branch})` : dirName);

					const tokensText = isSub
						? formatTokensK(usage?.tokens)
						: `${formatTokensK(usage?.tokens)} (${formatCost(cost)})`;
					const tokensLabel = theme.fg("dim", tokensText);
					const leftPart = dirLabel + theme.fg("dim", " · ") + tokensLabel;
					const modelStatus = theme.fg("dim", `${modelName} (${thinkingLevel})`);
					const gap = " ".repeat(Math.max(1, innerWidth - visibleWidth(leftPart) - visibleWidth(modelStatus)));
					const lines = [truncateToWidth(leftPart + gap + modelStatus, width)];

					const extensionStatuses = getExtensionStatuses(footerData);
					if (extensionStatuses.length > 0) {
						lines.push(truncateToWidth(formatStatusLine(theme, extensionStatuses), width, theme.fg("dim", "...")));
					}

					if (leftContextPercent < 30) {
						const leftContext = theme.fg("accent", `${leftContextPercent}% context left`);
						const leftContextPad = " ".repeat(Math.max(1, innerWidth - visibleWidth(leftContext)));
						lines.push(truncateToWidth(leftContextPad + leftContext, width));
					}

					return lines;
				},
			};
		});
	});
}
