import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { basename } from "node:path";

function getLeftContext(usage) {
	const remaining = Math.max(0, 100 - (usage?.percent || 0));
	const rounded = Math.round(remaining * 10) / 10;
	return rounded;
}

function getSessionCostTotal(ctx): number {
	let cost = 0;

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			cost += entry.message.usage?.cost?.total ?? 0;
		}
	}

	return cost;
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
					const sessionCost = getSessionCostTotal(ctx);
					const innerWidth = width;

					const dirName = basename(ctx.cwd);
					const branch = footerData.getGitBranch();
					const dirLabel = theme.fg("dim", branch ? `${dirName} (${branch})` : dirName);
					const contextLeftText = `${leftContextPercent}%`;
					const contextLeftLabel = theme.fg("dim", contextLeftText);
					const pricePart = isSub ? "" : theme.fg("dim", " · ") + theme.fg("dim", formatCost(sessionCost));
					const leftPart = dirLabel + theme.fg("dim", " · ") + contextLeftLabel + pricePart;
					const modelStatus = theme.fg("dim", `${modelName} (${thinkingLevel})`);
					const gap = " ".repeat(Math.max(1, innerWidth - visibleWidth(leftPart) - visibleWidth(modelStatus)));
					const lines = [truncateToWidth(leftPart + gap + modelStatus, width)];

					const extensionStatuses = getExtensionStatuses(footerData);
					if (extensionStatuses.length > 0) {
						lines.push(truncateToWidth(formatStatusLine(theme, extensionStatuses), width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});
	});
}
