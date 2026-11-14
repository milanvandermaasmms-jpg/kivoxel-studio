import { redirect } from "next/navigation";
import { connection } from "next/server";
import { StudioApp } from "@/components/studio/StudioApp";
import { dreamnestEnabled } from "@/lib/dreamnest/core";

// With FEATURE_DREAMNEST the Studio has an address per channel; the old address (and its #tab) goes to KIVOXEL.
// Without the flag nothing changes: the Studio stays here.
export default async function StudioHome() {
  await connection();
  if (dreamnestEnabled()) redirect("/studio/kivoxel");
  return <StudioApp />;
}
