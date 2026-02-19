import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

function getLeftContext(usage) {
	const remaining = Math.max(0, 100 - (usage?.percent || 0));
	const rounded = Math.round(remaining * 10) / 10;
	return rounded;
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

					const status = theme.fg("dim", `${modelName} (${thinkingLevel})`);
					const statusPad = " ".repeat(Math.max(1, width - visibleWidth(status)));

					if (leftContextPercent < 30) {
						const leftContext = theme.fg("accent", `${leftContextPercent}% context left`);
						const leftContextPad = " ".repeat(Math.max(1, width - visibleWidth(leftContext)));
						return [
							truncateToWidth(statusPad + status, width),
							truncateToWidth(leftContextPad + leftContext, width),
						];
					}
					return [truncateToWidth(statusPad + status, width)];
				},
			};
		});
	});
}
