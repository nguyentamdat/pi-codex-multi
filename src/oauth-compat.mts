import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai/oauth";
import type {
	AuthEvent,
	AuthInteraction,
	AuthPrompt,
	OAuthCredential,
	OAuthCredentials,
} from "@earendil-works/pi-ai";

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("OAuth prompt cancelled");
}

async function waitForLegacyPrompt<T>(start: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return start();

	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(abortError(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}

		let promise: Promise<T>;
		try {
			promise = start();
		} catch (error: unknown) {
			signal.removeEventListener("abort", onAbort);
			reject(error);
			return;
		}
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

function notifyLegacyOAuth(callbacks: OAuthLoginCallbacks, event: AuthEvent): void {
	switch (event.type) {
		case "auth_url":
			callbacks.onAuth({ url: event.url, instructions: event.instructions });
			return;
		case "device_code":
			callbacks.onDeviceCode({
				userCode: event.userCode,
				verificationUri: event.verificationUri,
				intervalSeconds: event.intervalSeconds,
				expiresInSeconds: event.expiresInSeconds,
			});
			return;
		case "info":
		case "progress":
			callbacks.onProgress?.(event.message);
	}
}

async function promptLegacyOAuth(
	callbacks: OAuthLoginCallbacks,
	prompt: AuthPrompt,
): Promise<string> {
	if (prompt.type === "select") {
		const selected = await waitForLegacyPrompt(
			() => callbacks.onSelect({
				message: prompt.message,
				options: prompt.options.map(({ id, label }) => ({ id, label })),
			}),
			prompt.signal,
		);
		if (selected === undefined) throw new Error("OAuth selection cancelled");
		return selected;
	}

	return waitForLegacyPrompt(
		() => prompt.type === "manual_code" && callbacks.onManualCodeInput
			? callbacks.onManualCodeInput()
			: callbacks.onPrompt({
					message: prompt.message,
					placeholder: prompt.placeholder,
					allowEmpty: false,
				}),
		prompt.signal,
	);
}

export function createOAuthInteraction(callbacks: OAuthLoginCallbacks): AuthInteraction {
	const signal = callbacks.signal ?? new AbortController().signal;
	return {
		signal,
		notify: (event) => notifyLegacyOAuth(callbacks, event),
		prompt: (prompt) => promptLegacyOAuth(callbacks, prompt),
	};
}

const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

type TokenFetch = (input: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "statusText" | "text" | "json">>;

export async function refreshOpenAICodexToken(
credentials: OAuthCredentials,
signal: AbortSignal,
fetchImpl: TokenFetch = fetch,
 ): Promise<OAuthCredentials> {
const response = await fetchImpl(OPENAI_CODEX_TOKEN_URL, {
method: "POST",
headers: { "Content-Type": "application/x-www-form-urlencoded" },
body: new URLSearchParams({
grant_type: "refresh_token",
refresh_token: credentials.refresh,
client_id: OPENAI_CODEX_CLIENT_ID,
}),
signal,
});

if (!response.ok) {
const body = await response.text().catch(() => "");
throw new Error(`OpenAI Codex token refresh failed (${response.status}): ${body || response.statusText}`);
}

const token = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
if (typeof token.access_token !== "string" || typeof token.expires_in !== "number") {
throw new Error("OpenAI Codex token refresh response missing access_token or expires_in");
}

return {
...credentials,
type: "oauth",
access: token.access_token,
refresh: typeof token.refresh_token === "string" && token.refresh_token ? token.refresh_token : credentials.refresh,
expires: Date.now() + token.expires_in * 1000,
};
}

export function toOAuthCredential(credentials: OAuthCredentials): OAuthCredential {
return { ...credentials, type: "oauth" };
}
