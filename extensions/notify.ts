/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Supports multiple terminal protocols:
 * - OSC 777: Ghostty, iTerm2, WezTerm, rxvt-unicode
 * - OSC 99: Kitty
 * - Windows toast: Windows Terminal (WSL)
 * - tmux passthrough: wraps OSC sequences for outer terminal delivery when running inside tmux
 *
 * tmux passthrough requires `allow-passthrough` to be enabled in tmux.
 */

import { getAgentDir, SettingsManager, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isContextOverflow, type AssistantMessage } from "@mariozechner/pi-ai";

const ESC = "\x1b";
const BEL = "\x07";
const ST = `${ESC}\\`;

const DEFAULT_RETRY_SETTINGS = {
	enabled: true,
	maxRetries: 3,
};

const RETRYABLE_ERROR_PATTERN =
	/overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

function sanitizeOSCText(value: string): string {
	return value
		.replaceAll(ESC, "")
		.replaceAll(BEL, "")
		.replaceAll("\u009c", "")
		.replaceAll("\r", " ")
		.replaceAll("\n", " ");
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

function wrapForTmux(sequence: string): string {
	if (!process.env.TMUX) {
		return sequence;
	}

	return `${ESC}Ptmux;${sequence.replaceAll(ESC, `${ESC}${ESC}`)}${ST}`;
}

function writeTerminalSequence(sequence: string): void {
	if (!process.stdout.isTTY) {
		return;
	}

	process.stdout.write(wrapForTmux(sequence));
}

function notifyOSC777(title: string, body: string): void {
	const safeTitle = sanitizeOSCText(title);
	const safeBody = sanitizeOSCText(body);
	writeTerminalSequence(`${ESC}]777;notify;${safeTitle};${safeBody}${BEL}`);
}

function notifyOSC99(title: string, body: string): void {
	const safeTitle = sanitizeOSCText(title);
	const safeBody = sanitizeOSCText(body);

	// Kitty OSC 99: i=notification id, d=0 means not done yet, p=body for second part
	writeTerminalSequence(`${ESC}]99;i=1:d=0;${safeTitle}${ST}`);
	writeTerminalSequence(`${ESC}]99;i=1:p=body;${safeBody}${ST}`);
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

function getRetrySettings(cwd: string): typeof DEFAULT_RETRY_SETTINGS {
	try {
		const settings = SettingsManager.create(cwd, getAgentDir()).getRetrySettings();
		return {
			enabled: settings.enabled,
			maxRetries: settings.maxRetries,
		};
	} catch {
		return DEFAULT_RETRY_SETTINGS;
	}
}

function findLastAssistantMessage(messages: unknown[]): AssistantMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message && typeof message === "object" && "role" in message && message.role === "assistant") {
			return message as AssistantMessage;
		}
	}

	return undefined;
}

function isRetryableError(message: AssistantMessage, contextWindow: number | undefined): boolean {
	if (message.stopReason !== "error" || !message.errorMessage) {
		return false;
	}

	if (isContextOverflow(message, contextWindow)) {
		return false;
	}

	return RETRYABLE_ERROR_PATTERN.test(message.errorMessage);
}

export default function (pi: ExtensionAPI) {
	let retryableErrorCount = 0;

	const resetRetryState = () => {
		retryableErrorCount = 0;
	};

	const notifyAgentDone = () => {
		notify("Pi", "I'm waiting for your response!");
	};

	pi.on("session_start", resetRetryState);
	pi.on("session_shutdown", resetRetryState);

	pi.on("message_start", (event) => {
		if (event.message.role === "user") {
			resetRetryState();
		}
	});

	pi.on("message_end", (event) => {
		if (event.message.role === "assistant" && event.message.stopReason !== "error") {
			resetRetryState();
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		const lastAssistant = findLastAssistantMessage(event.messages);
		if (!lastAssistant) {
			return;
		}

		if (lastAssistant.stopReason === "aborted") {
			resetRetryState();
			return;
		}

		if (lastAssistant.stopReason === "error") {
			const retrySettings = getRetrySettings(ctx.cwd);
			const contextWindow = ctx.model?.contextWindow;
			if (retrySettings.enabled && isRetryableError(lastAssistant, contextWindow)) {
				retryableErrorCount++;

				if (retryableErrorCount <= retrySettings.maxRetries) {
					return;
				}
			}

			resetRetryState();
			notifyAgentDone();
			return;
		}

		resetRetryState();
		notifyAgentDone();
	});
}
