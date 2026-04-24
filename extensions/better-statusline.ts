import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { basename } from "node:path";

const SEP = " · ";
const ELLIPSIS = "...";

function fit(text: string, width: number): string {
	return truncateToWidth(text, width, width <= ELLIPSIS.length ? "" : ELLIPSIS);
}

function formatContextRemaining(usage: ContextUsage | undefined): string {
	const usedPercent = usage?.percent;
	if (usedPercent == null || !Number.isFinite(usedPercent)) return "?%";

	const remainingPercent = Math.min(100, Math.max(0, 100 - usedPercent));
	return `${Math.round(remainingPercent * 10) / 10}%`;
}

function getAssistantBranchCostTotal(ctx: ExtensionContext): number {
	return ctx.sessionManager.getBranch().reduce((total, entry) => {
		if (entry.type !== "message" || entry.message.role !== "assistant") return total;
		return total + (entry.message.usage?.cost?.total ?? 0);
	}, 0);
}

function formatCost(cost: number): string | undefined {
	if (cost <= 0) return undefined;
	return cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`;
}

function renderLeftPriorityLine(left: string, right: string, width: number): string {
	if (width <= 0) return "";

	const leftText = fit(left, width);
	if (!leftText) return fit(right, width);
	if (!right) return leftText;

	const leftWidth = visibleWidth(leftText);
	const rightBudget = width - leftWidth - 1;
	if (rightBudget <= ELLIPSIS.length) return leftText;

	const rightText = fit(right, rightBudget);
	const rightWidth = visibleWidth(rightText);
	const gap = " ".repeat(Math.max(1, width - leftWidth - rightWidth));
	return leftText + gap + rightText;
}

function renderMainLineText(
	ctx: ExtensionContext,
	branch: string | null,
	width: number,
	thinkingLevel: string,
): string {
	const dirName = basename(ctx.cwd) || ctx.cwd;
	const dirLabel = branch ? `${dirName} (${branch})` : dirName;
	const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "model not selected";
	const costPart = ctx.model && !ctx.modelRegistry.isUsingOAuth(ctx.model)
		? formatCost(getAssistantBranchCostTotal(ctx))
		: undefined;
	const leftParts = [dirLabel, formatContextRemaining(ctx.getContextUsage()), costPart].filter(
		(part): part is string => Boolean(part),
	);

	return renderLeftPriorityLine(leftParts.join(SEP), `${model} (${thinkingLevel})`, width);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					const mainLine = renderMainLineText(ctx, footerData.getGitBranch(), width, pi.getThinkingLevel());
					const lines = [mainLine ? theme.fg("dim", mainLine) : ""];
					const statusText = [...footerData.getExtensionStatuses()]
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => text.replace(/\s+/g, " ").trim())
						.filter((text) => text.length > 0)
						.join(SEP);
					const statusLine = statusText ? fit(statusText, width) : "";

					if (statusLine) {
						lines.push(theme.fg("dim", statusLine));
					}

					return lines;
				},
			};
		});
	});
}
