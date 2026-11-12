// Supabase decides on its own when to refresh a login, using the clock of this device. When that clock is
// wrong (on 11-11-2026 Milan's pc ran 2 hours behind) or a tab slept for a long time, the database answers
// "JWT expired" while the app still thinks the login is valid. This wrapper then refreshes the login once
// and repeats the request; if refreshing fails, the user is logged out and sees the login screen.

const isDatabaseCall = (url: string) => /\/(rest|storage)\/v1\//.test(url);

/** PostgREST answers 401 with code PGRST303 and message "JWT expired". */
export function isExpiredLogin(status: number, body: unknown): boolean {
  if (status !== 401 || !body || typeof body !== "object") return false;
  const { code, message } = body as { code?: unknown; message?: unknown };
  return code === "PGRST303" || (typeof message === "string" && /jwt expired/i.test(message));
}

type Options = {
  /** Refresh the login; resolves to the new access token, or null when that failed. */
  refresh: () => Promise<string | null>;
  /** Called when refreshing failed, so the app can show the login screen. */
  onExpired: () => Promise<void> | void;
};

export function createRefreshingFetch(baseFetch: typeof fetch, { refresh, onExpired }: Options): typeof fetch {
  let pending: Promise<string | null> | null = null;
  // Several requests can fail at the same moment; they share one refresh.
  const refreshOnce = () => {
    pending ??= refresh().finally(() => {
      setTimeout(() => (pending = null), 0);
    });
    return pending;
  };

  return async (input, init) => {
    const response = await baseFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (response.status !== 401 || !isDatabaseCall(url)) return response;
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (!isExpiredLogin(response.status, body)) return response;

    const token = await refreshOnce();
    if (!token) {
      await onExpired();
      return response;
    }
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return baseFetch(input, { ...init, headers });
  };
}
