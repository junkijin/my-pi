import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function formatNumber(value: number | null | undefined): string {
	if (value == null) return "unknown";
	return value.toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
	if (value == null) return "unknown";
	return `${value.toFixed(1)}%`;
}

export default function modelInfoExtension(pi: ExtensionAPI) {
	pi.registerCommand("model-info", {
		description: "Show the current model information (usage: /model-info [json])",
		handler: async (args, ctx) => {
			const model = ctx.model;
			if (!model) {
				const message = "No model selected";
				if (ctx.hasUI) ctx.ui.notify(message, "warning");
				else process.stdout.write(`${message}\n`);
				return;
			}

			const usage = ctx.getContextUsage();
			const thinkingLevel = pi.getThinkingLevel();
			const outputMode = args.trim().toLowerCase();

			const info = {
				provider: model.provider,
				id: model.id,
				name: model.name,
				api: model.api,
				baseUrl: model.baseUrl,
				reasoning: model.reasoning,
				thinkingLevel,
				input: model.input,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				contextUsage: usage
					? {
							tokens: usage.tokens,
							contextWindow: usage.contextWindow,
							percent: usage.percent,
						}
					: null,
			};

			const text =
				outputMode === "json"
					? JSON.stringify(info, null, 2)
					: [
							`provider: ${info.provider}`,
							`model: ${info.id}`,
							`name: ${info.name}`,
							`api: ${info.api}`,
							`thinking: ${info.thinkingLevel}${info.reasoning ? " (reasoning)" : ""}`,
							`input: ${info.input.join(", ")}`,
							`context window: ${formatNumber(info.contextWindow)}`,
							`max output: ${formatNumber(info.maxTokens)}`,
							`context used: ${usage ? `${formatNumber(usage.tokens)} / ${formatNumber(usage.contextWindow)} (${formatPercent(usage.percent)})` : "unknown"}`,
							`base URL: ${info.baseUrl}`,
					  ].join("\n");

			if (ctx.hasUI) ctx.ui.notify(text, "info");
			else process.stdout.write(`${text}\n`);
		},
	});
}
