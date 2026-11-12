"use client";

import type { Session } from "@supabase/supabase-js";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Field, inputClass } from "@/components/ui/Dialog";
import { isPublicPath } from "@/lib/publicPages";
import { StudioProvider, useMembership } from "@/lib/studio";
import { friendlyError, isSupabaseConfigured, supabase } from "@/lib/supabase";

const Centered = ({ children }: { children: React.ReactNode }) => <div className="flex min-h-screen items-center justify-center px-4 py-8">{children}</div>;
const authCard = "w-full max-w-sm rounded-xl border border-slate-200 bg-surface p-6 shadow-[var(--shadow-pop)]";
const Loading = () => (
  <Centered>
    <p className="text-sm text-slate-500">Laden…</p>
  </Centered>
);

// Nothing of the studio is shown without a connected database and a logged-in studio member.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return <>{children}</>;
  if (!isSupabaseConfigured) {
    return (
      <Centered>
        <div className={authCard}>
          <h1 className="text-xl font-semibold tracking-tight">Nog niet gekoppeld</h1>
          <p className="mt-2 text-sm text-slate-500">KIVOXEL Studio is nog niet verbonden met een database. Zet de gegevens van het Supabase-project in .env.local (zie .env.example).</p>
        </div>
      </Centered>
    );
  }
  return <SessionGate>{children}</SessionGate>;
}

function SessionGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <Loading />;
  if (!session) return <LoginForm />;
  return (
    <MemberGate key={session.user.id} userId={session.user.id} email={session.user.email ?? ""}>
      {children}
    </MemberGate>
  );
}

function MemberGate({ userId, email, children }: { userId: string; email: string; children: React.ReactNode }) {
  const { state, reload } = useMembership(userId);

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") {
    return (
      <Centered>
        <div className={authCard}>
          <h1 className="text-xl font-semibold tracking-tight">Laden is niet gelukt</h1>
          <p role="alert" className="mt-2 text-sm text-red-800">
            {state.message}
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void reload()}>Opnieuw proberen</Button>
            <Button variant="secondary" onClick={() => void supabase.auth.signOut()}>
              Uitloggen
            </Button>
          </div>
        </div>
      </Centered>
    );
  }
  if (state.status === "none") {
    return (
      <Centered>
        <CreateStudio email={email} onDone={reload} />
      </Centered>
    );
  }
  return (
    <StudioProvider value={{ me: state.me, studio: state.studio, email, isAdmin: true, reload }}>
      <div className="min-h-screen px-3 py-4 sm:px-6">
        <div className="mx-auto mb-3 flex max-w-6xl items-center justify-between text-xs text-slate-500">
          <span>
            Ingelogd als {state.me.display_name} ({email})
          </span>
          <button type="button" onClick={() => void supabase.auth.signOut()} className="underline underline-offset-2 hover:text-slate-700">
            Uitloggen
          </button>
        </div>
        {children}
      </div>
    </StudioProvider>
  );
}

/** First login only: the database allows exactly one studio, so after this nobody can make another. */
function CreateStudio({ email, onDone }: { email: string; onDone: () => Promise<void> }) {
  const [name, setName] = useState("KIVOXEL Studio");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("create_studio", { p_name: name, p_display_name: displayName });
    if (rpcError) {
      setError(/al een studio/i.test(rpcError.message) ? "Er bestaat al een studio en dit account hoort daar niet bij. Vraag de eigenaar om je toe te voegen." : friendlyError(rpcError.message));
      setBusy(false);
      return;
    }
    await onDone();
  };

  return (
    <div className={authCard}>
      <h1 className="text-xl font-semibold tracking-tight">Studio aanmaken</h1>
      <p className="mb-4 mt-1 text-sm text-slate-500">Ingelogd als {email}. Dit kan maar één keer: wie de studio aanmaakt, wordt eigenaar.</p>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Naam van de studio">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Jouw naam">
          <input required maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
        </Field>
        {error && (
          <p role="alert" className="rounded bg-red-50 px-2 py-1 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy} className="flex-1 py-2">
            {busy ? "Even geduld…" : "Studio aanmaken"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void supabase.auth.signOut()}>
            Uitloggen
          </Button>
        </div>
      </form>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) setError(friendlyError(signInError.message));
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "Inloggen is niet gelukt."));
    }
    setBusy(false);
  };

  return (
    <Centered>
      <div className={authCard}>
        <h1 className="text-xl font-semibold tracking-tight">Inloggen</h1>
        <p className="mb-4 text-sm text-slate-500">KIVOXEL Studio</p>
        <form onSubmit={submit} className="space-y-3">
          <Field label="E-mail">
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Wachtwoord">
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </Field>
          {error && (
            <p role="alert" className="rounded bg-red-50 px-2 py-1 text-sm text-red-800">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full py-2">
            {busy ? "Even geduld…" : "Inloggen"}
          </Button>
        </form>
      </div>
    </Centered>
  );
}
