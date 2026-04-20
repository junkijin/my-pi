/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Supports multiple terminal protocols:
 * - OSC 777: Ghostty, iTerm2, WezTerm, rxvt-unicode
 * - OSC 99: Kitty
 * - Windows toast: Windows Terminal (WSL)
 * - tmux passthrough: wraps OSC sequences when running inside tmux
 *
 * tmux passthrough requires `allow-passthrough` to be enabled in tmux.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const ESC = "\x1b";
const BEL = "\x07";
const ST = `${ESC}\\`;

function sanitizeOSCText(value: string): string {
	return value
		.replaceAll(ESC, "")
		.replaceAll(BEL, "")
		.replaceAll("\u009c", "")
		.replaceAll("\r", " ")
		.replaceAll("\n", " ");
}

function writeEscapeSequence(sequence: string): void {
	if (process.env.TMUX) {
		const escapedSequence = sequence.replaceAll(ESC, `${ESC}${ESC}`);
		process.stdout.write(`${ESC}Ptmux;${escapedSequence}${ST}`);
		return;
	}

	process.stdout.write(sequence);
}

function windowsToastScript(title: string, body: string): string {
	const escapePowerShell = (value: string) => value.replaceAll("'", "''");
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	return [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${escapePowerShell(body)}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${escapePowerShell(title)}').Show(${toast})`,
	].join("; ");
}

function notifyOSC777(title: string, body: string): void {
	const safeTitle = sanitizeOSCText(title);
	const safeBody = sanitizeOSCText(body);
	writeEscapeSequence(`${ESC}]777;notify;${safeTitle};${safeBody}${BEL}`);
}

function notifyOSC99(title: string, body: string): void {
	const safeTitle = sanitizeOSCText(title);
	const safeBody = sanitizeOSCText(body);

	// Kitty OSC 99: i=notification id, d=0 means not done yet, p=body for second part
	writeEscapeSequence(`${ESC}]99;i=1:d=0;${safeTitle}${ST}`);
	writeEscapeSequence(`${ESC}]99;i=1:p=body;${safeBody}${ST}`);
}

function notifyWindows(title: string, body: string): void {
	const { execFile } = require("child_process");
	execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)]);
}

function notify(title: string, body: string): void {
	if (process.env.WT_SESSION) {
		notifyWindows(title, body);
	} else if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
	} else {
		notifyOSC777(title, body);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async () => {
		notify("Pi", "I'm waiting for your response!");
	});
}
