import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, Editor, Input, SettingsList, isFocusable } from "@mariozechner/pi-tui";

type FocusableRenderTarget = {
	focused?: boolean;
};

type RenderFn<T> = (this: T, width: number) => string[];

type SettingsListLike = SettingsList & {
	__junkijinPiSettingsListFocused?: boolean;
	searchInput?: Input;
	submenuComponent?: unknown;
	activateItem: (...args: unknown[]) => unknown;
	closeSubmenu: (...args: unknown[]) => unknown;
};

type CursorPatchState = {
	refCount: number;
	originalEditorRender: RenderFn<Editor>;
	originalInputRender: RenderFn<Input>;
	originalSettingsListFocusedDescriptor?: PropertyDescriptor;
	originalSettingsListActivateItem: SettingsListLike["activateItem"];
	originalSettingsListCloseSubmenu: SettingsListLike["closeSubmenu"];
};

const PATCH_STATE_KEY = "__junkijin_pi_no_software_cursor_patch__";
const SETTINGS_LIST_FOCUSED_KEY = "__junkijinPiSettingsListFocused";
const SOFTWARE_CURSOR_START = /\x1b\[7m/;
const SOFTWARE_CURSOR_BLOCK = /\x1b\[7m([^\x1b]*)\x1b\[(?:0|27)m/g;

function getPatchStateStore(): typeof globalThis & { [PATCH_STATE_KEY]?: CursorPatchState } {
	return globalThis as typeof globalThis & { [PATCH_STATE_KEY]?: CursorPatchState };
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
		return stripSoftwareCursor(lines, Boolean(this.focused));
	};
}

function syncSettingsListFocus(instance: SettingsListLike): void {
	const focused = Boolean(instance[SETTINGS_LIST_FOCUSED_KEY]);
	const searchInput = instance.searchInput;
	if (searchInput) {
		searchInput.focused = focused && !instance.submenuComponent;
	}

	if (isFocusable(instance.submenuComponent as FocusableRenderTarget | null)) {
		instance.submenuComponent.focused = focused;
	}
}

function acquirePatch(): void {
	const store = getPatchStateStore();
	const existing = store[PATCH_STATE_KEY];
	if (existing) {
		existing.refCount += 1;
		return;
	}

	const settingsListProto = SettingsList.prototype as SettingsListLike;
	const patchState: CursorPatchState = {
		refCount: 1,
		originalEditorRender: Editor.prototype.render,
		originalInputRender: Input.prototype.render,
		originalSettingsListFocusedDescriptor: Object.getOwnPropertyDescriptor(settingsListProto, "focused"),
		originalSettingsListActivateItem: settingsListProto.activateItem,
		originalSettingsListCloseSubmenu: settingsListProto.closeSubmenu,
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
	Editor.prototype.render = patchState.originalEditorRender;
	Input.prototype.render = patchState.originalInputRender;
	settingsListProto.activateItem = patchState.originalSettingsListActivateItem;
	settingsListProto.closeSubmenu = patchState.originalSettingsListCloseSubmenu;
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
