import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Keybindings, Theme, TUI } from "@mariozechner/pi-tui";

// Matches the reverse-video cursor block the editor emits:
//   \x1b[7m  +  one or more non-escape chars  +  \x1b[0m
// Using [^\x1b]* to avoid crossing into other escape sequences.
const CURSOR_RE = /\x1b\[7m([^\x1b]*)\x1b\[0m/;

// DECSET 1004 focus reporting. Ghostty (and every modern terminal) emits
// \x1b[I when the OS window gains focus and \x1b[O when it loses focus.
const ENABLE_FOCUS_REPORT = "\x1b[?1004h";
const DISABLE_FOCUS_REPORT = "\x1b[?1004l";
const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";

// Shared mutable focus state so the editor instance can see updates from the
// input listener without extra plumbing.
const focusState = {
  osWindowFocused: true,
};

class FocusCursorEditor extends CustomEditor {
  override render(width: number): string[] {
    const lines = super.render(width);

    // The software cursor (reverse-video block) should stay visible only when
    // the hardware cursor is suppressed AND the user is actively interacting
    // with the editor, i.e. during slash-command autocomplete inside a focused
    // editor of a focused OS window.
    //
    // Base Editor suppresses CURSOR_MARKER whenever:
    //   - `this.focused` is false (another TUI component took focus), or
    //   - autocomplete is active.
    // Ghostty additionally renders the hardware cursor hollow when the OS
    // window is unfocused. In every case except the autocomplete-on-focused
    // editor, we want zero visible caret; keeping the software cursor there
    // would contradict the original "hide cursor when unfocused" intent.
    const keepSoftwareCursor =
      focusState.osWindowFocused && this.focused && this.isShowingAutocomplete();
    if (keepSoftwareCursor) {
      return lines;
    }
    return lines.map((line) => line.replace(CURSOR_RE, "$1"));
  }
}

export default function (pi: ExtensionAPI) {
  let savedTui: TUI | undefined;
  let unsubscribeInput: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui: TUI, theme: Theme, keybindings: Keybindings) => {
      savedTui = tui;
      // Switch the TUI from software-only to hardware cursor mode.
      tui.setShowHardwareCursor(true);
      // Ask the terminal to report OS window focus changes.
      tui.terminal.write(ENABLE_FOCUS_REPORT);
      return new FocusCursorEditor(tui, theme, keybindings);
    });

    // Intercept focus-report sequences before they reach the focused TUI
    // component, otherwise the editor would treat them as arbitrary escape
    // input. Any surrounding bytes are forwarded untouched.
    unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      if (!data.includes(FOCUS_IN) && !data.includes(FOCUS_OUT)) {
        return undefined;
      }

      let remaining = data;
      let changed = false;

      // Process sequences in encounter order so a burst of FOCUS_OUT/FOCUS_IN
      // within a single chunk still leaves us in the correct final state.
      while (remaining.length > 0) {
        const inIdx = remaining.indexOf(FOCUS_IN);
        const outIdx = remaining.indexOf(FOCUS_OUT);
        if (inIdx === -1 && outIdx === -1) break;

        const nextIdx =
          inIdx === -1 ? outIdx : outIdx === -1 ? inIdx : Math.min(inIdx, outIdx);
        const nextFocused = nextIdx === inIdx;
        remaining = remaining.slice(0, nextIdx) + remaining.slice(nextIdx + FOCUS_IN.length);
        if (focusState.osWindowFocused !== nextFocused) {
          focusState.osWindowFocused = nextFocused;
          changed = true;
        }
      }

      if (changed) savedTui?.requestRender();
      if (remaining.length === 0) return { consume: true };
      return { data: remaining };
    });
  });

  pi.on("session_end", () => {
    // Restore default cursor mode and stop focus reporting on session exit.
    savedTui?.terminal.write(DISABLE_FOCUS_REPORT);
    savedTui?.setShowHardwareCursor(false);
    savedTui = undefined;
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    focusState.osWindowFocused = true;
  });
}
