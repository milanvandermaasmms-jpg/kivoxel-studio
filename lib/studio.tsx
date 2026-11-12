"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { friendlyError, supabase } from "./supabase";

export type StudioRole = "eigenaar" | "beheerder";
export type Member = { id: string; studio_id: string; user_id: string; display_name: string; role: StudioRole };
export type Studio = { id: string; name: string };

export const MEMBER_COLUMNS = "id, studio_id, user_id, display_name, role";

type Membership = { status: "loading" } | { status: "none" } | { status: "error"; message: string } | { status: "ready"; me: Member; studio: Studio };

export function useMembership(userId: string) {
  const [state, setState] = useState<Membership>({ status: "loading" });

  const reload = useCallback(async () => {
    const { data: me, error } = await supabase.from("studio_members").select(MEMBER_COLUMNS).eq("user_id", userId).maybeSingle<Member>();
    if (error) return setState({ status: "error", message: friendlyError(error.message) });
    if (!me) return setState({ status: "none" });
    const { data: studio, error: studioError } = await supabase.from("studios").select("id, name").eq("id", me.studio_id).single<Studio>();
    if (studioError) return setState({ status: "error", message: friendlyError(studioError.message) });
    setState({ status: "ready", me, studio });
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload };
}

type StudioContextValue = { me: Member; studio: Studio; email: string; isAdmin: boolean; reload: () => Promise<void> };

const StudioContext = createContext<StudioContextValue | null>(null);

export const StudioProvider = StudioContext.Provider;

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside StudioProvider");
  return value;
}
