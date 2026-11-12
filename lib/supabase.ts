import { createClient } from "@supabase/supabase-js";
import { createRefreshingFetch } from "./refreshingFetch";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && key);

// The placeholders only keep the build working; AuthGate never renders the app without real values.
export const supabase = createClient(url || "https://not-configured.invalid", key || "not-configured", {
  global: {
    fetch: createRefreshingFetch((...args) => fetch(...args), {
      refresh: async (): Promise<string | null> => {
        const { data } = await supabase.auth.refreshSession();
        return data.session?.access_token ?? null;
      },
      // Local sign-out only: other devices stay logged in.
      onExpired: async (): Promise<void> => {
        await supabase.auth.signOut({ scope: "local" });
      },
    }),
  },
});

export function friendlyError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "E-mail of wachtwoord klopt niet.";
  if (/email not confirmed/i.test(message)) return "Dit e-mailadres is nog niet bevestigd.";
  if (/jwt expired/i.test(message)) return "Je inlog was verlopen. Probeer het opnieuw; lukt dat niet, log dan opnieuw in.";
  if (/rate limit|too many/i.test(message)) return "Te veel pogingen. Wacht even en probeer het opnieuw.";
  if (/failed to fetch|networkerror|load failed/i.test(message)) return "Geen verbinding met de database. Controleer je internet en probeer het opnieuw.";
  if (/same password|different from the old/i.test(message)) return "Kies een ander wachtwoord dan je huidige.";
  if (/password/i.test(message)) return "Dit wachtwoord wordt niet geaccepteerd. Kies een langer of sterker wachtwoord.";
  if (/duplicate key|already exists/i.test(message)) return "Dit bestaat al.";
  if (/permission denied|row-level security/i.test(message)) return "Je hebt hier geen rechten voor.";
  return message;
}
