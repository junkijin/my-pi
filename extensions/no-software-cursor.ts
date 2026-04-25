import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, Editor, SettingsList, TUI, isFocusable, type Component, type Focusable } from "@mariozechner/pi-tui";

const PATCH_STATE_KEY = "__junkijin_pi_no_software_cursor_patch__";
const REVERSE_SGR = "\x1b\\[(?:\\d+;)*0*7(?:;\\d+)*m";
const SOFTWARE_CURSOR_START = "\x1b[7m";
const MARKER = escapeRegExp(CURSOR_MARKER);
const MARKED_SOFTWARE_CURSOR = new RegExp(`(${MARKER})(${REVERSE_SGR})|(${REVERSE_SGR})(${MARKER})`, "g");

type RenderFn<T> = (this: T, width: number, ...args: unknown[]) => string[];
type CursorPosition = { row: number; col: number } | null;

type EditorLike = Editor & {
	render: RenderFn<EditorLike>;
};

type SettingsListLike = SettingsList & {
	searchInput?: Component | null;
	submenuComponent?: Component | null;
	render: RenderFn<SettingsListLike>;
};

type TUILike = TUI & {
	extractCursorPosition: (lines: string[], height: number) => CursorPosition;
	getShowHardwareCursor?: () => boolean;
	setFocus: (component: Component | null) => void;
};

type CursorPatchState = {
	refCount: number;
	focusedSettingsLists: WeakSet<SettingsListLike>;
	focusedSettingsListByTui: WeakMap<TUI, SettingsListLike>;
	restore: () => void;
};

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPatchStateStore(): typeof globalThis & { [PATCH_STATE_KEY]?: CursorPatchState } {
	return globalThis as typeof globalThis & { [PATCH_STATE_KEY]?: CursorPatchState };
}

function getPatchState(): CursorPatchState | undefined {
	return getPatchStateStore()[PATCH_STATE_KEY];
}

function stripReverseVideo(sgr: string): string {
	const params = sgr
		.slice(2, -1)
		.split(";")
		.filter((param) => Number(param) !== 7);
	return params.length > 0 ? `\x1b[${params.join(";")}m` : "";
}

function stripMarkedSoftwareCursor(lines: string[]): void {
	for (let index = 0; index < lines.length; index += 1) {
		lines[index] = lines[index].replace(MARKED_SOFTWARE_CURSOR, (_match, markerBefore, sgrAfter, sgrBefore) => {
			return markerBefore ? `${CURSOR_MARKER}${stripReverseVideo(sgrAfter)}` : `${stripReverseVideo(sgrBefore)}${CURSOR_MARKER}`;
		});
	}
}

function insertMarkerBeforeSoftwareCursor(lines: string[]): void {
	if (lines.some((line) => line.includes(CURSOR_MARKER))) return;

	for (let index = 0; index < lines.length; index += 1) {
		const cursorStartIndex = lines[index].indexOf(SOFTWARE_CURSOR_START);
		if (cursorStartIndex === -1) continue;
		lines[index] = `${lines[index].slice(0, cursorStartIndex)}${CURSOR_MARKER}${lines[index].slice(cursorStartIndex)}`;
		return;
	}
}

function wrapEditorRender(render: RenderFn<EditorLike>): RenderFn<EditorLike> {
	return function wrappedEditorRender(this: EditorLike, width: number, ...args: unknown[]): string[] {
		const lines = render.call(this, width, ...args);

		// pi-tui intentionally suppresses CURSOR_MARKER while autocomplete is visible because
		// the software cursor still shows the edit position. This extension removes that
		// software cursor, so re-add the marker before stripping reverse-video in TUI render.
		if (this.focused && this.isShowingAutocomplete()) insertMarkerBeforeSoftwareCursor(lines);

		return lines;
	};
}

function withFocusedChild<T>(settingsList: SettingsListLike, render: () => T): T {
	const snapshots: Array<[Focusable, boolean]> = [];
	const focus = (component: Component | null | undefined, focused: boolean) => {
		if (!isFocusable(component)) return;
		snapshots.push([component, component.focused]);
		component.focused = focused;
	};

	focus(settingsList.searchInput, !settingsList.submenuComponent);
	focus(settingsList.submenuComponent, true);

	try {
		return render();
	} finally {
		for (const [component, focused] of snapshots.reverse()) component.focused = focused;
	}
}

function wrapSettingsListRender(render: RenderFn<SettingsListLike>): RenderFn<SettingsListLike> {
	return function wrappedSettingsListRender(this: SettingsListLike, width: number, ...args: unknown[]): string[] {
		const renderList = () => render.call(this, width, ...args);
		return getPatchState()?.focusedSettingsLists.has(this) ? withFocusedChild(this, renderList) : renderList();
	};
}

function wrapCursorExtraction(extractCursorPosition: TUILike["extractCursorPosition"]): TUILike["extractCursorPosition"] {
	return function wrappedExtractCursorPosition(this: TUILike, lines: string[], height: number): CursorPosition {
		if (this.getShowHardwareCursor?.() ?? process.env.PI_HARDWARE_CURSOR === "1") {
			stripMarkedSoftwareCursor(lines);
		}
		return extractCursorPosition.call(this, lines, height);
	};
}

function wrapTuiSetFocus(setFocus: TUILike["setFocus"]): TUILike["setFocus"] {
	return function wrappedSetFocus(this: TUILike, component: Component | null): void {
		setFocus.call(this, component);

		const patchState = getPatchState();
		if (!patchState) return;

		const previous = patchState.focusedSettingsListByTui.get(this);
		if (previous) patchState.focusedSettingsLists.delete(previous);

		if (component instanceof SettingsList) {
			const settingsList = component as SettingsListLike;
			patchState.focusedSettingsLists.add(settingsList);
			patchState.focusedSettingsListByTui.set(this, settingsList);
		} else {
			patchState.focusedSettingsListByTui.delete(this);
		}
	};
}

function acquirePatch(): void {
	const store = getPatchStateStore();
	const existing = store[PATCH_STATE_KEY];
	if (existing) {
		existing.refCount += 1;
		return;
	}

	const editorProto = Editor.prototype as EditorLike;
	const settingsListProto = SettingsList.prototype as SettingsListLike;
	const tuiProto = TUI.prototype as unknown as TUILike;
	const originalEditorRender = editorProto.render;
	const originalSettingsListRender = settingsListProto.render;
	const originalExtractCursorPosition = tuiProto.extractCursorPosition;
	const originalTuiSetFocus = tuiProto.setFocus;
	const editorRender = wrapEditorRender(originalEditorRender);
	const settingsListRender = wrapSettingsListRender(originalSettingsListRender);
	const extractCursorPosition = wrapCursorExtraction(originalExtractCursorPosition);
	const tuiSetFocus = wrapTuiSetFocus(originalTuiSetFocus);

	store[PATCH_STATE_KEY] = {
		refCount: 1,
		focusedSettingsLists: new WeakSet(),
		focusedSettingsListByTui: new WeakMap(),
		restore() {
			if (editorProto.render === editorRender) editorProto.render = originalEditorRender;
			if (settingsListProto.render === settingsListRender) settingsListProto.render = originalSettingsListRender;
			if (tuiProto.extractCursorPosition === extractCursorPosition) tuiProto.extractCursorPosition = originalExtractCursorPosition;
			if (tuiProto.setFocus === tuiSetFocus) tuiProto.setFocus = originalTuiSetFocus;
		},
	};

	editorProto.render = editorRender;
	settingsListProto.render = settingsListRender;
	tuiProto.extractCursorPosition = extractCursorPosition;
	tuiProto.setFocus = tuiSetFocus;
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
