export const TOOL_NAME = "search_web";
export const DEFAULT_MAX_RESULTS = 10;
export const MIN_MAX_RESULTS = 5;
export const MAX_MAX_RESULTS = 20;
export const REQUEST_TIMEOUT_MS = 25_000;
export const TOOL_PROMPT_YEAR = new Date().getFullYear();

export function getToolDescription() {
	return (
		"Search the web using Exa AI with automatic Tavily fallback on failure. " +
		`The current year is ${TOOL_PROMPT_YEAR}. You MUST use this year when searching for recent information. ` +
		"Results are truncated at 50KB or 2000 lines."
	);
}

export function getPromptGuidelines() {
	return [
		`The current year is ${TOOL_PROMPT_YEAR}. Include that year when the user asks for recent or latest information.`,
		"Use this tool when freshness matters or when the answer depends on external sources.",
	];
}
