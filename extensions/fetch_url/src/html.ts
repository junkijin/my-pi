import { load as loadHtml } from "cheerio";
import TurndownService from "turndown";
import { BLOCK_SELECTOR, HTML_ROOT_SELECTOR, SANITIZE_SELECTOR } from "./constants";

export function toAbsoluteUrl(value: string, baseUrl: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  if (/^(?:data:|mailto:|tel:|javascript:)/i.test(trimmed)) return trimmed;

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

export function sanitizeHtml(rawHtml: string, baseUrl: string) {
  const htmlWithoutComments = rawHtml.replace(/<!--[\s\S]*?-->/g, "");
  const $ = loadHtml(htmlWithoutComments, { decodeEntities: false });

  $(SANITIZE_SELECTOR).remove();

  $("[href]").each((_, element) => {
    const current = $(element).attr("href");
    if (current) {
      $(element).attr("href", toAbsoluteUrl(current, baseUrl));
    }
  });

  $("[src]").each((_, element) => {
    const current = $(element).attr("src");
    if (current) {
      $(element).attr("src", toAbsoluteUrl(current, baseUrl));
    }
  });

  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("meta[name='twitter:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    undefined;

  const description =
    $("meta[name='description']").attr("content")?.trim() ||
    $("meta[property='og:description']").attr("content")?.trim() ||
    $("meta[name='twitter:description']").attr("content")?.trim() ||
    undefined;

  return { $, title, description };
}

export function getHtmlRoot($: ReturnType<typeof loadHtml>) {
  const preferred = $(HTML_ROOT_SELECTOR).first();
  if (preferred.length > 0) return preferred;
  return $.root();
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function prependMetadata(text: string, title?: string, description?: string): string {
  const parts: string[] = [];
  const normalizedText = normalizeWhitespace(text);

  if (title && !normalizedText.toLowerCase().startsWith(title.toLowerCase())) {
    parts.push(title);
  }

  if (description && !normalizedText.toLowerCase().includes(description.toLowerCase())) {
    parts.push(description);
  }

  if (normalizedText) {
    parts.push(normalizedText);
  }

  return parts.join("\n\n").trim();
}

export function htmlToText(
  rawHtml: string,
  baseUrl: string,
): { text: string; title?: string; description?: string } {
  const { $, title, description } = sanitizeHtml(rawHtml, baseUrl);
  const root = getHtmlRoot($);

  root.find("img").each((_, element) => {
    const alt = $(element).attr("alt")?.trim();
    if (alt) {
      $(element).replaceWith(`\n[Image: ${alt}]\n`);
    }
  });

  root.find("br").replaceWith("\n");
  root.find(BLOCK_SELECTOR).each((_, element) => {
    const node = $(element);
    node.before("\n");
    node.after("\n");
  });

  const text = prependMetadata(root.text(), title, description);
  return { text, title, description };
}

export function htmlToMarkdown(
  rawHtml: string,
  baseUrl: string,
): { text: string; title?: string; description?: string } {
  const { $, title, description } = sanitizeHtml(rawHtml, baseUrl);
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  turndown.remove(["script", "style", "meta", "link", "noscript", "template"]);

  const rootHtml = $.html(getHtmlRoot($));
  const markdown = normalizeWhitespace(turndown.turndown(rootHtml));

  const parts: string[] = [];
  if (title && !markdown.toLowerCase().startsWith(`# ${title}`.toLowerCase())) {
    parts.push(`# ${title}`);
  }

  if (description && !markdown.toLowerCase().includes(description.toLowerCase())) {
    parts.push(`> ${description}`);
  }

  if (markdown) {
    parts.push(markdown);
  }

  return {
    text: parts.join("\n\n").trim(),
    title,
    description,
  };
}
