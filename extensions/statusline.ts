import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { basename } from "node:path";
import { execSync } from "node:child_process";

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

function getGitBranch(cwd: string): string | undefined {
	try {
		return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch {
		return undefined;
	}
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
					const branch = getGitBranch(ctx.cwd);
					const dirLabel = theme.fg("dim", branch ? `${dirName} (${branch})` : dirName);

					const tokensText = isSub
						? formatTokensK(usage?.tokens)
						: `${formatTokensK(usage?.tokens)} (${formatCost(cost)})`;
					const tokensLabel = theme.fg("dim", tokensText);
					const leftPart = dirLabel + theme.fg("dim", " · ") + tokensLabel;
					const status = theme.fg("dim", `${modelName} (${thinkingLevel})`);
					const gap = " ".repeat(Math.max(1, innerWidth - visibleWidth(leftPart) - visibleWidth(status)));

					if (leftContextPercent < 30) {
						const leftContext = theme.fg("accent", `${leftContextPercent}% context left`);
						const leftContextPad = " ".repeat(Math.max(1, innerWidth - visibleWidth(leftContext)));
						return [
							truncateToWidth(leftPart + gap + status, width),
							truncateToWidth(leftContextPad + leftContext, width),
						];
					}
					return [truncateToWidth(leftPart + gap + status, width)];
				},
			};
		});
	});
}
