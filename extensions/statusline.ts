import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

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

					const cost = getSessionCost(ctx);
					const innerWidth = width - 2;
					const tokensLabel = theme.fg("dim", `${formatTokensK(usage?.tokens)} (${formatCost(cost)})`);
					const status = theme.fg("dim", `${modelName} (${thinkingLevel})`);
					const gap = " ".repeat(Math.max(1, innerWidth - visibleWidth(tokensLabel) - visibleWidth(status)));

					if (leftContextPercent < 30) {
						const leftContext = theme.fg("accent", `${leftContextPercent}% context left`);
						const leftContextPad = " ".repeat(Math.max(1, innerWidth - visibleWidth(leftContext)));
						return [
							truncateToWidth(" " + tokensLabel + gap + status + " ", width),
							truncateToWidth(" " + leftContextPad + leftContext + " ", width),
						];
					}
					return [truncateToWidth(" " + tokensLabel + gap + status + " ", width)];
				},
			};
		});
	});
}
