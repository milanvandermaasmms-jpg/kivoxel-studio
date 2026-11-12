import { describe, expect, it, vi } from "vitest";
import { createRefreshingFetch, isExpiredLogin } from "./refreshingFetch";

const REST = "https://x.supabase.co/rest/v1/yt_jobs?select=id";
const expired = () => new Response(JSON.stringify({ code: "PGRST303", message: "JWT expired" }), { status: 401 });
const ok = () => new Response("[]", { status: 200 });

describe("refreshing an expired login", () => {
  it("recognises the database's 'JWT expired' answer", () => {
    expect(isExpiredLogin(401, { code: "PGRST303", message: "JWT expired" })).toBe(true);
    expect(isExpiredLogin(401, { message: "JWT expired" })).toBe(true);
    expect(isExpiredLogin(401, { message: "permission denied" })).toBe(false);
    expect(isExpiredLogin(403, { message: "JWT expired" })).toBe(false);
  });

  it("refreshes once and repeats the request with the new token", async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok());
    const refresh = vi.fn(async () => "nieuw-token");
    const onExpired = vi.fn();
    const res = await createRefreshingFetch(base, { refresh, onExpired })(REST, { headers: { Authorization: "Bearer oud" } });
    expect(res.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Headers(base.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer nieuw-token");
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("shares one refresh between requests that fail together", async () => {
    const base = vi.fn<typeof fetch>(async (_input, init) => (new Headers(init?.headers).get("Authorization") === "Bearer nieuw" ? ok() : expired()));
    const refresh = vi.fn(async () => "nieuw");
    const f = createRefreshingFetch(base, { refresh, onExpired: () => {} });
    const results = await Promise.all([f(REST), f(REST), f(REST)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("logs out when refreshing fails", async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValue(expired());
    const onExpired = vi.fn();
    const res = await createRefreshingFetch(base, { refresh: async () => null, onExpired })(REST);
    expect(res.status).toBe(401);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("leaves other answers and the login service itself alone", async () => {
    const refresh = vi.fn(async () => "x");
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ message: "permission denied" }), { status: 401 }));
    expect((await createRefreshingFetch(denied, { refresh, onExpired: () => {} })(REST)).status).toBe(401);
    const auth = vi.fn<typeof fetch>().mockResolvedValue(expired());
    await createRefreshingFetch(auth, { refresh, onExpired: () => {} })("https://x.supabase.co/auth/v1/token");
    expect(refresh).not.toHaveBeenCalled();
  });
});
