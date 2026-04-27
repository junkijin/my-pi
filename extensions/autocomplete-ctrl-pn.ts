import { CustomEditor, InteractiveMode, keyText, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, matchesKey } from "@mariozechner/pi-tui";

const PATCH_STATE_KEY = "__ab180_pi_autocomplete_ctrl_pn_patch__";
const SELECT_PREVIOUS_KEY = "\x1b[A";
const SELECT_NEXT_KEY = "\x1b[B";
const MODEL_SELECTOR_COMPONENT_NAME = "ModelSelectorComponent";
const SCOPED_MODELS_SELECTOR_COMPONENT_NAME = "ScopedModelsSelectorComponent";
const TREE_SELECTOR_COMPONENT_NAME = "TreeSelectorComponent";
const SELECTOR_COMPONENT_NAMES = new Set([
	MODEL_SELECTOR_COMPONENT_NAME,
	SCOPED_MODELS_SELECTOR_COMPONENT_NAME,
	TREE_SELECTOR_COMPONENT_NAME,
]);

type HandleInput<T> = (this: T, data: string) => void;

type InputReceiver = {
	handleInput: HandleInput<InputReceiver>;
};

type AutocompleteAwareEditor = InputReceiver & {
	isShowingAutocomplete?: () => boolean;
};

type SelectorResult = {
	component: unknown;
	focus: unknown;
};

type TextLike = {
	setText?: (text: string) => void;
};

type ScopedModelsSelectorLike = InputReceiver & {
	getFooterText?: () => string;
	footerText?: TextLike;
};

type ShowSelector<T> = (this: T, create: (done: () => void) => SelectorResult) => void;

type InteractiveModeLike = {
	showSelector: ShowSelector<InteractiveModeLike>;
};

type PatchState = {
	refCount: number;
	restore: () => void;
};

function getPatchStateStore(): typeof globalThis & { [PATCH_STATE_KEY]?: PatchState } {
	return globalThis as typeof globalThis & { [PATCH_STATE_KEY]?: PatchState };
}

function getNavigationKey(data: string): string | undefined {
	if (matchesKey(data, "ctrl+p")) return SELECT_PREVIOUS_KEY;
	if (matchesKey(data, "ctrl+n")) return SELECT_NEXT_KEY;
	return undefined;
}

function isInputReceiver(value: unknown): value is InputReceiver {
	return typeof value === "object" && value !== null && typeof (value as InputReceiver).handleInput === "function";
}

function getComponentName(value: unknown): string | undefined {
	return (value as { constructor?: { name?: string } }).constructor?.name;
}

function isTargetSelector(value: unknown): value is InputReceiver {
	if (!isInputReceiver(value)) return false;
	const componentName = getComponentName(value);
	return typeof componentName === "string" && SELECTOR_COMPONENT_NAMES.has(componentName);
}

function getAutocompleteNavigationKey(editor: AutocompleteAwareEditor, data: string): string | undefined {
	return editor.isShowingAutocomplete?.() ? getNavigationKey(data) : undefined;
}

function wrapAutocompleteHandleInput<T extends AutocompleteAwareEditor>(handleInput: HandleInput<T>): HandleInput<T> {
	return function wrappedAutocompleteHandleInput(this: T, data: string): void {
		const navigationKey = getAutocompleteNavigationKey(this, data);
		handleInput.call(this, navigationKey ?? data);
	};
}

function wrapSelectorHandleInput<T extends InputReceiver>(handleInput: HandleInput<T>): HandleInput<T> {
	return function wrappedSelectorHandleInput(this: T, data: string): void {
		handleInput.call(this, getNavigationKey(data) ?? data);
	};
}

function formatScopedModelsFooter(footer: string): string {
	const providerKeys = keyText("app.models.toggleProvider").split("/").filter(Boolean);
	if (!providerKeys.includes("ctrl+p")) return footer;

	const providerHint = `${providerKeys.join("/")} provider`;
	const remainingProviderKeys = providerKeys.filter((key) => key !== "ctrl+p");
	const replacementParts = ["ctrl+p/ctrl+n navigate"];
	if (remainingProviderKeys.length > 0) replacementParts.push(`${remainingProviderKeys.join("/")} provider`);

	return footer.replace(providerHint, replacementParts.join(" · "));
}

function patchScopedModelsFooter(value: InputReceiver): void {
	const selector = value as ScopedModelsSelectorLike;
	if (typeof selector.getFooterText !== "function") return;

	const originalGetFooterText = selector.getFooterText;
	selector.getFooterText = function patchedGetFooterText(this: ScopedModelsSelectorLike): string {
		return formatScopedModelsFooter(originalGetFooterText.call(this));
	};
	selector.footerText?.setText?.(selector.getFooterText());
}

function patchSelectorInstance(value: unknown, patchedSelectors: WeakSet<InputReceiver>): void {
	if (!isTargetSelector(value) || patchedSelectors.has(value)) return;

	const originalHandleInput = value.handleInput;
	value.handleInput = wrapSelectorHandleInput(originalHandleInput);
	if (getComponentName(value) === SCOPED_MODELS_SELECTOR_COMPONENT_NAME) patchScopedModelsFooter(value);
	patchedSelectors.add(value);
}

function wrapShowSelector<T extends InteractiveModeLike>(
	showSelector: ShowSelector<T>,
	patchedSelectors: WeakSet<InputReceiver>,
): ShowSelector<T> {
	return function wrappedShowSelector(this: T, create: (done: () => void) => SelectorResult): void {
		return showSelector.call(this, (done) => {
			const result = create(done);
			patchSelectorInstance(result.component, patchedSelectors);
			patchSelectorInstance(result.focus, patchedSelectors);
			return result;
		});
	};
}

function acquirePatch(): void {
	const store = getPatchStateStore();
	const existing = store[PATCH_STATE_KEY];
	if (existing) {
		existing.refCount += 1;
		return;
	}

	const editorProto = Editor.prototype as unknown as AutocompleteAwareEditor;
	const customEditorProto = CustomEditor.prototype as unknown as AutocompleteAwareEditor;
	const interactiveModeProto = InteractiveMode.prototype as unknown as InteractiveModeLike;

	const originalEditorHandleInput = editorProto.handleInput;
	const originalCustomEditorHandleInput = customEditorProto.handleInput;
	const originalShowSelector = interactiveModeProto.showSelector;

	const editorHandleInput = wrapAutocompleteHandleInput(originalEditorHandleInput);
	const customEditorHandleInput = wrapAutocompleteHandleInput(originalCustomEditorHandleInput);
	const patchedSelectors = new WeakSet<InputReceiver>();
	const showSelector = wrapShowSelector(originalShowSelector, patchedSelectors);

	store[PATCH_STATE_KEY] = {
		refCount: 1,
		restore() {
			if (editorProto.handleInput === editorHandleInput) editorProto.handleInput = originalEditorHandleInput;
			if (customEditorProto.handleInput === customEditorHandleInput) {
				customEditorProto.handleInput = originalCustomEditorHandleInput;
			}
			if (interactiveModeProto.showSelector === showSelector) {
				interactiveModeProto.showSelector = originalShowSelector;
			}
		},
	};

	editorProto.handleInput = editorHandleInput;
	customEditorProto.handleInput = customEditorHandleInput;
	interactiveModeProto.showSelector = showSelector;
}

function releasePatch(): void {
	const store = getPatchStateStore();
	const patchState = store[PATCH_STATE_KEY];
	if (!patchState) return;

	patchState.refCount -= 1;
	if (patchState.refCount > 0) return;

	patchState.restore();
	delete store[PATCH_STATE_KEY];
}

export default function (pi: ExtensionAPI) {
	acquirePatch();

	pi.on("session_shutdown", async () => {
		releasePatch();
	});
}
