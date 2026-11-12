import { describe, expect, it, vi } from "vitest";

vi.mock("../supabase", () => ({ supabase: {}, friendlyError: (m: string) => m }));
const { channelProblem } = await import("./channels");

const ok = { name: "PixelRush", status: "active" as const, language: "en" as const, audience: null, brand_color: null };

describe("channel fields", () => {
  it("accepts a normal channel", () => {
    expect(channelProblem(ok)).toBeNull();
    expect(channelProblem({ ...ok, brand_color: "#22aa55", audience: "Minecraft-fans" })).toBeNull();
  });

  it("refuses an empty or very long name, a long audience and a wrong colour", () => {
    expect(channelProblem({ ...ok, name: "  " })).toMatch(/naam/);
    expect(channelProblem({ ...ok, name: "x".repeat(61) })).toMatch(/naam/);
    expect(channelProblem({ ...ok, audience: "x".repeat(301) })).toMatch(/doelgroep/);
    expect(channelProblem({ ...ok, brand_color: "groen" })).toMatch(/merkkleur/);
  });
});
