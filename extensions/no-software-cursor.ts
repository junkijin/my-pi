import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, Editor, Input, SettingsList, TUI, isFocusable } from "@mariozechner/pi-tui";

type FocusableRenderTarget = {
	focused?: boolean;
};

type RenderFn<T> = (this: T, width: number) => string[];

type SettingsListLike = SettingsList & {
	__junkijinPiSettingsListFocused?: boolean;
	focused?: boolean;
	searchInput?: Input;
	submenuComponent?: unknown;
	render: RenderFn<SettingsListLike>;
	activateItem: (...args: unknown[]) => unknown;
	closeSubmenu: (...args: unknown[]) => unknown;
};

type TUILike = TUI & {
	doRender: (...args: unknown[]) => unknown;
	getShowHardwareCursor: () => boolean;
	setShowHardwareCursor: (enabled: boolean) => void;
};

type CursorPatchState = {
	refCount: number;
	hardwareCursorEnabled: boolean;
	originalEditorRender: RenderFn<Editor>;
	originalInputRender: RenderFn<Input>;
	originalSettingsListRender: RenderFn<SettingsListLike>;
	originalSettingsListFocusedDescriptor?: PropertyDescriptor;
	originalSettingsListActivateItem: SettingsListLike["activateItem"];
	originalSettingsListCloseSubmenu: SettingsListLike["closeSubmenu"];
	originalTuiDoRender: TUILike["doRender"];
	originalTuiSetShowHardwareCursor: TUILike["setShowHardwareCursor"];
};

const PATCH_STATE_KEY = "__junkijin_pi_no_software_cursor_patch__";
const SETTINGS_LIST_FOCUSED_KEY = "__junkijinPiSettingsListFocused";
const SOFTWARE_CURSOR_START = /\x1b\[7m/;
const SOFTWARE_CURSOR_BLOCK = /\x1b\[7m([^\x1b]*)\x1b\[(?:0|27)m/g;

function getPatchStateStore(): typeof globalThis & { [PATCH_STATE_KEY]?: CursorPatchState } {
	return globalThis as typeof globalThis & { [PATCH_STATE_KEY]?: CursorPatchState };
}

function isHardwareCursorEnabled(): boolean {
	return Boolean(getPatchStateStore()[PATCH_STATE_KEY]?.hardwareCursorEnabled);
}

function setHardwareCursorEnabled(enabled: boolean): void {
	const patchState = getPatchStateStore()[PATCH_STATE_KEY];
	if (patchState) {
		patchState.hardwareCursorEnabled = enabled;
	}
}

function stripSoftwareCursor(lines: string[], focused: boolean): string[] {
	const hasHardwareMarker = lines.some((line) => line.includes(CURSOR_MARKER));
	let injectedMarker = false;

	return lines.map((line) => {
		let nextLine = line;

		if (focused && !hasHardwareMarker && !injectedMarker && SOFTWARE_CURSOR_START.test(nextLine)) {
			nextLine = nextLine.replace(SOFTWARE_CURSOR_START, `${CURSOR_MARKER}\x1b[7m`);
			injectedMarker = true;
		}

		return nextLine.replace(SOFTWARE_CURSOR_BLOCK, "$1");
	});
}

function wrapRender<T extends FocusableRenderTarget>(originalRender: RenderFn<T>): RenderFn<T> {
	return function wrappedRender(this: T, width: number): string[] {
		const lines = originalRender.call(this, width);
		if (!isHardwareCursorEnabled()) {
			return lines;
		}
		return stripSoftwareCursor(lines, Boolean(this.focused));
	};
}

function syncSettingsListFocus(instance: SettingsListLike): void {
	const listFocused = Boolean(instance[SETTINGS_LIST_FOCUSED_KEY]);
	const childFocused = isHardwareCursorEnabled() && listFocused;
	const searchInput = instance.searchInput;
	if (searchInput) {
		searchInput.focused = childFocused && !instance.submenuComponent;
	}

	if (isFocusable(instance.submenuComponent as FocusableRenderTarget | null)) {
		instance.submenuComponent.focused = childFocused;
	}
}

function wrapSettingsListRender(originalRender: RenderFn<SettingsListLike>): RenderFn<SettingsListLike> {
	return function wrappedSettingsListRender(this: SettingsListLike, width: number): string[] {
		syncSettingsListFocus(this);
		return originalRender.call(this, width);
	};
}

function wrapTuiDoRender(originalDoRender: TUILike["doRender"]): TUILike["doRender"] {
	return function wrappedDoRender(this: TUILike, ...args: unknown[]): unknown {
		setHardwareCursorEnabled(this.getShowHardwareCursor());
		return originalDoRender.apply(this, args);
	};
}

function wrapTuiSetShowHardwareCursor(
	originalSetShowHardwareCursor: TUILike["setShowHardwareCursor"],
): TUILike["setShowHardwareCursor"] {
	return function wrappedSetShowHardwareCursor(this: TUILike, enabled: boolean): void {
		setHardwareCursorEnabled(enabled);
		originalSetShowHardwareCursor.call(this, enabled);
	};
}

function acquirePatch(): void {
	const store = getPatchStateStore();
	const existing = store[PATCH_STATE_KEY];
	if (existing) {
		existing.refCount += 1;
		return;
	}

	const settingsListProto = SettingsList.prototype as SettingsListLike;
	const tuiProto = TUI.prototype as unknown as TUILike;
	const patchState: CursorPatchState = {
		refCount: 1,
		hardwareCursorEnabled: process.env.PI_HARDWARE_CURSOR === "1",
		originalEditorRender: Editor.prototype.render,
		originalInputRender: Input.prototype.render,
		originalSettingsListRender: settingsListProto.render,
		originalSettingsListFocusedDescriptor: Object.getOwnPropertyDescriptor(settingsListProto, "focused"),
		originalSettingsListActivateItem: settingsListProto.activateItem,
		originalSettingsListCloseSubmenu: settingsListProto.closeSubmenu,
		originalTuiDoRender: tuiProto.doRender,
		originalTuiSetShowHardwareCursor: tuiProto.setShowHardwareCursor,
	};

	Editor.prototype.render = wrapRender(patchState.originalEditorRender);
	Input.prototype.render = wrapRender(patchState.originalInputRender);
	Object.defineProperty(settingsListProto, "focused", {
		configurable: true,
		get(this: SettingsListLike): boolean {
			return Boolean(this[SETTINGS_LIST_FOCUSED_KEY]);
		},
		set(this: SettingsListLike, value: boolean) {
			this[SETTINGS_LIST_FOCUSED_KEY] = value;
			syncSettingsListFocus(this);
		},
	});
	settingsListProto.render = wrapSettingsListRender(patchState.originalSettingsListRender);
	settingsListProto.activateItem = function patchedActivateItem(this: SettingsListLike, ...args: unknown[]) {
		const result = patchState.originalSettingsListActivateItem.apply(this, args);
		syncSettingsListFocus(this);
		return result;
	};
	settingsListProto.closeSubmenu = function patchedCloseSubmenu(this: SettingsListLike, ...args: unknown[]) {
		const result = patchState.originalSettingsListCloseSubmenu.apply(this, args);
		syncSettingsListFocus(this);
		return result;
	};
	tuiProto.doRender = wrapTuiDoRender(patchState.originalTuiDoRender);
	tuiProto.setShowHardwareCursor = wrapTuiSetShowHardwareCursor(patchState.originalTuiSetShowHardwareCursor);
	store[PATCH_STATE_KEY] = patchState;
}

function releasePatch(): void {
	const store = getPatchStateStore();
	const patchState = store[PATCH_STATE_KEY];
	if (!patchState) {
		return;
	}

	patchState.refCount -= 1;
	if (patchState.refCount > 0) {
		return;
	}

	const settingsListProto = SettingsList.prototype as SettingsListLike;
	const tuiProto = TUI.prototype as unknown as TUILike;
	Editor.prototype.render = patchState.originalEditorRender;
	Input.prototype.render = patchState.originalInputRender;
	settingsListProto.render = patchState.originalSettingsListRender;
	settingsListProto.activateItem = patchState.originalSettingsListActivateItem;
	settingsListProto.closeSubmenu = patchState.originalSettingsListCloseSubmenu;
	tuiProto.doRender = patchState.originalTuiDoRender;
	tuiProto.setShowHardwareCursor = patchState.originalTuiSetShowHardwareCursor;
	if (patchState.originalSettingsListFocusedDescriptor) {
		Object.defineProperty(settingsListProto, "focused", patchState.originalSettingsListFocusedDescriptor);
	} else {
		delete (settingsListProto as { focused?: boolean }).focused;
	}
	delete store[PATCH_STATE_KEY];
}

export default function (pi: ExtensionAPI) {
	acquirePatch();

	pi.on("session_shutdown", async () => {
		releasePatch();
	});
}
