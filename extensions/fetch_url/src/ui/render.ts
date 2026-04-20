import { formatSize, keyHint } from "@mariozechner/pi-coding-agent";
import type { TextContent } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { summarizeForPreview } from "../shared/output";
import type { FetchUrlDetails } from "../shared/types";
import { TOOL_NAME } from "../shared/config";

export function renderCall(args: Record<string, unknown> | undefined, theme: any) {
  const url = typeof args?.url === "string" ? theme.fg("accent", ` ${args.url}`) : "";
  return new Text(theme.fg("toolTitle", `${theme.bold(TOOL_NAME)}${url}`), 0, 0);
}

export function renderResult(
  result: { content?: Array<{ type: string; text?: string }>; details?: unknown },
  options: { expanded: boolean; isPartial?: boolean },
  theme: any,
) {
  if (options.isPartial) {
    return new Text(`\n${theme.fg("warning", "Fetching...")}`, 0, 0);
  }

  const details = result.details as FetchUrlDetails | undefined;
  if (details?.image) {
    let summary = theme.fg(
      "success",
      `Image fetched (${details.image.mimeType}, ${formatSize(details.image.bytes)})`,
    );
    if (options.expanded) {
      summary += `\n${theme.fg("dim", details.finalUrl)}`;
    }
    return new Text(`\n${summary}`, 0, 0);
  }

  const textContent = result.content?.find((item): item is TextContent => item.type === "text");
  const fullText = textContent?.text?.trim() ?? "";
  const preview = summarizeForPreview(fullText);

  if (!options.expanded) {
    const hint = keyHint("app.tools.expand", "to expand");
    const suffix = details?.truncation?.truncated ? `\n${theme.fg("warning", "(truncated)")}` : "";
    return new Text(`\n${preview}\n(${hint})${suffix}`, 0, 0);
  }

  return new Text(`\n${fullText || theme.fg("dim", "(empty response)")}`, 0, 0);
}
