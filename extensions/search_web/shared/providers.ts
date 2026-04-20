import { searchExa } from "../providers/exa";
import { searchTavily } from "../providers/tavily";
import type { ProviderDefinition } from "./types";

export const PROVIDERS: ProviderDefinition[] = [
	{ name: "exa", search: searchExa },
	{ name: "tavily", search: searchTavily },
];
