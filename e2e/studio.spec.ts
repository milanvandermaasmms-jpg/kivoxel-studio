// 24-11-2026 (opdracht 6): the main flows of the studio in a real browser, with fake data (e2e/mock.ts).
import { expect, test } from "@playwright/test";
import { mockStudio, signIn, V_HELD } from "./mock";

test("zonder inlog: het inlogscherm, niets van de studio", async ({ page }) => {
  await page.goto("/studio/kivoxel");
  await expect(page.getByRole("button", { name: /inloggen/i })).toBeVisible();
  await expect(page.getByText("TESTDATA")).toHaveCount(0);
});

test("ingelogd: de studio opent en de tabbladen werken", async ({ page }) => {
  await mockStudio(page);
  await signIn(page);
  await page.goto("/studio/kivoxel");
  await expect(page.getByText("Ingelogd als")).toBeVisible();
  for (const [tab, hash] of [["In productie", "productie"], ["Bibliotheek", "bibliotheek"], ["Instellingen", "instellingen"]]) {
    await page.getByRole("tab", { name: new RegExp(tab) }).first().click();
    await expect(page).toHaveURL(new RegExp(`#${hash}`));
    await expect(page.getByRole("tab", { name: new RegExp(tab) }).first()).toHaveAttribute("aria-selected", "true");
  }
});

test("Bibliotheek: 'Wat Ivar leerde' toont een les en zet hem uit", async ({ page }) => {
  const lessons = {
    version: 2,
    builtAt: "2026-11-24T12:00:00.000Z",
    lessons: [{ id: "terug:c:payoff", channelId: null, title: "Uitkomst vaker te kort: elke Short houdt de uitkomst 1,5 s langer in beeld", evidence: ["Op 4 verschillende video's gaf je deze feedback"], count: 4, status: "actief", action: { type: "payoff_extra", ms: 1500 } }],
    off: [],
    history: [{ version: 2, at: "2026-11-24T12:00:00.000Z", changes: ["Nieuw: Uitkomst vaker te kort (actief)"] }],
    applied: { "terug:c:payoff": 3 },
  };
  const writes = await mockStudio(page, { lessons });
  await signIn(page);
  await page.goto("/studio/kivoxel#bibliotheek");
  await page.getByText("Wat Ivar leerde").click();
  await expect(page.getByText(/Uitkomst vaker te kort/).first()).toBeVisible();
  await expect(page.getByText(/3× toegepast in een productie/)).toBeVisible();
  await page.getByRole("button", { name: "Uitzetten" }).click();
  await expect.poll(() => writes.find((w) => w.table === "worker/lessons/toggle")?.body).toEqual({ id: "terug:c:payoff", off: true });
});

test("Afgekeurd door de studio: 'Toch keuren' zet de Short terug naar Te keuren (jouw beslissing wint)", async ({ page }) => {
  const writes = await mockStudio(page);
  await signIn(page);
  await page.goto("/studio/kivoxel");
  await page.getByText(/Afgekeurd \(/).first().click();
  await expect(page.getByText(/afgekeurd door de studio/)).toBeVisible();
  await page.getByRole("button", { name: "Toch keuren" }).click();
  await expect.poll(() => writes.find((w) => w.table === "yt_videos" && w.method === "PATCH")).toMatchObject({ body: { status: "review" } });
  expect(writes.find((w) => w.table === "yt_videos")!.query).toContain(V_HELD);
});
