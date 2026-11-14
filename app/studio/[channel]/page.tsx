import { notFound } from "next/navigation";
import { connection } from "next/server";
import { StudioApp } from "@/components/studio/StudioApp";
import { dreamnestEnabled } from "@/lib/dreamnest/core";
import { isRouteSlug } from "@/lib/studioRoutes";

// Fase 0.5: /studio/kivoxel, /studio/dreamnest and later more channels. Only with FEATURE_DREAMNEST.
export default async function ChannelStudio({ params }: { params: Promise<{ channel: string }> }) {
  await connection();
  const { channel } = await params;
  if (!dreamnestEnabled()) {
    // Never a redirect back to "/": the old Studio right here, so a stale redirect can never make a loop.
    if (channel === "kivoxel") return <StudioApp />;
    notFound();
  }
  if (!isRouteSlug(channel)) notFound();
  return <StudioApp route={channel} />;
}
