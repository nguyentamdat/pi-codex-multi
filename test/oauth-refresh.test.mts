import { expect, test } from "bun:test";
import { refreshOpenAICodexToken } from "../src/oauth-compat.mts";

const credentials = {
	type: "oauth" as const,
	access: "old-access",
	refresh: "stored-refresh",
	expires: 0,
	accountId: "account-id",
};

test("refresh keeps the stored token when OpenAI omits refresh_token", async () => {
	let body = "";
	const refreshed = await refreshOpenAICodexToken(
		credentials,
		new AbortController().signal,
		async (url, init) => {
			expect(url).toBe("https://auth.openai.com/oauth/token");
			expect(init.method).toBe("POST");
			body = String(init.body);
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				text: async () => "",
				json: async () => ({ access_token: "new-access", expires_in: 3600 }),
			};
		},
	);

	expect(new URLSearchParams(body)).toEqual(new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: "stored-refresh",
		client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
	}));
	expect(refreshed).toMatchObject({ access: "new-access", refresh: "stored-refresh", accountId: "account-id" });
});

test("refresh reports token endpoint failures", async () => {
	await expect(refreshOpenAICodexToken(credentials, new AbortController().signal, async () => ({
		ok: false,
		status: 401,
		statusText: "Unauthorized",
		text: async () => "invalid_grant",
		json: async () => ({}),
	}))).rejects.toThrow("OpenAI Codex token refresh failed (401): invalid_grant");
});
