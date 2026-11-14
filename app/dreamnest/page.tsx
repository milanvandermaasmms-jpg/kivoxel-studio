import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { dreamnestEnabled } from "@/lib/dreamnest/core";

// Fase 0.5: Dreamnest lives in the Studio itself (/studio/dreamnest). This old address only forwards.
export default async function DreamnestPage() {
  await connection();
  if (!dreamnestEnabled()) notFound();
  redirect("/studio/dreamnest");
}
