"use client";
// Ivar — Studio Assistant: always reachable from the shared shell (bottom right) on every studio page. The panel keeps
// its conversation while navigating; minimising never stops a task. Answers come from the worker on the pc through the
// normal queue (yt_jobs, step 'assistant'); this file only shows them and calls real, permission-checked functions.
import { Brain, ChevronRight, History, Loader2, Maximize2, MessageSquarePlus, Minimize2, Minus, Pencil, RotateCcw, Search, Send, Square, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "@/lib/studio";
import { supabase } from "@/lib/supabase";
import { isDreamnestChannel } from "@/lib/studioRoutes";
import { pageVisible } from "@/lib/visible";
import { workerHealth } from "@/lib/youtube/workerClient";
import * as data from "@/lib/ivar/data";
import { usePageContext } from "@/lib/ivar/pageContext";
import { suggestions, type ProjectState } from "@/lib/ivar/suggest";
import { launcherSignal, taskView, type JobRow, type LauncherSignal } from "@/lib/ivar/tasks";
import { clientKey, sameTarget, scopeOf, scopeTrail, type Card, type ChannelKind, type Conversation, type Idea, type MemoryItem, type Message, type Revision, type Scope } from "@/lib/ivar/types";
import { IvarCard, TaskCard, type CardCtx, type CardLive } from "./IvarCards";

type ChannelInfo = { id: string; name: string; is_default: boolean; slug: string | null; safety_profile: string | null; status: string };
const kindOf = (c: ChannelInfo | undefined | null): ChannelKind | null => (!c ? null : isDreamnestChannel(c) ? "dreamnest" : c.is_default ? "kivoxel" : "other");

// Per-viewer conveniences only (open panel, chosen conversation, unsent draft). The conversation itself lives in Supabase.
const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(`ivar:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(`ivar:${key}`);
      else window.localStorage.setItem(`ivar:${key}`, value);
    } catch {
      /* private window: works without remembering */
    }
  },
};

export function Ivar() {
  const { studio, isAdmin } = useStudio();
  if (!isAdmin) return null;
  return <IvarShell studioId={studio.id} />;
}

function Avatar({ size = 32 }: { size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-700 font-semibold text-white shadow-sm" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      Iv
    </span>
  );
}

function useVisualViewportHeight(active: boolean) {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) return;
    const update = () => setH(Math.round(vv.height));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return h;
}

function IvarShell({ studioId }: { studioId: string }) {
  const page = usePageContext();
  const [open, setOpenState] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<"chat" | "history" | "memory" | "scope">("chat");
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [convId, setConvIdState] = useState<string | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [draftScope, setDraftScope] = useState<Scope | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [live, setLive] = useState<CardLive>({ revisions: new Map(), jobs: new Map(), ideas: new Map(), now: Date.now() });
  const [projectJobs, setProjectJobs] = useState<JobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [workerOnline, setWorkerOnline] = useState(false);
  const [seenAt, setSeenAt] = useState(0);
  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mobile, setMobile] = useState(false);
  const vvh = useVisualViewportHeight(open && mobile);

  // Restore after a refresh: open state, conversation and layout.
  useEffect(() => {
    setOpenState(store.get("open") === "1");
    setExpanded(store.get("expanded") === "1");
    setConvIdState(store.get("conversation"));
    setSeenAt(Number(store.get("seen") ?? 0));
    const mq = window.matchMedia("(max-width: 639px)");
    const upd = () => setMobile(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    store.set("open", v ? "1" : "0");
    if (!v) setTimeout(() => launcherRef.current?.focus(), 0);
  }, []);
  const setConvId = useCallback((id: string | null) => {
    setConvIdState(id);
    store.set("conversation", id);
    setMessages([]);
    setConv(null);
  }, []);

  useEffect(() => {
    void supabase
      .from("yt_channels")
      .select("id, name, is_default, slug, safety_profile, status")
      .eq("studio_id", studioId)
      .order("is_default", { ascending: false })
      .returns<ChannelInfo[]>()
      .then(({ data: rows }) => setChannels(rows ?? []));
  }, [studioId]);
  const channelName = useCallback((id: string | null) => channels.find((c) => c.id === id)?.name ?? null, [channels]);

  // The scope: of the conversation when there is one, else what Milan picked, else the page he looks at.
  const pageScope: Scope = useMemo(() => ({ ...page, channelName: page.channelName ?? channelName(page.channelId) }), [page, channelName]);
  const scope: Scope = conv ? { ...scopeOf(conv, channelName(conv.channel_id)), page: page.channelId === conv.channel_id ? page.page : null } : (draftScope ?? pageScope);
  const scopeDiffers = !!conv && messages.length > 0 && !!page.channelId && !sameTarget(scope, pageScope);

  // ---------- loading ----------
  const reloadMessages = useCallback(async () => {
    if (!convId) return;
    try {
      const [c, msgs] = await Promise.all([data.getConversation(convId), data.loadMessages(convId)]);
      if (!c) {
        setConvId(null);
        return;
      }
      setConv(c);
      setMessages((prev) => (JSON.stringify(prev) === JSON.stringify(msgs) ? prev : msgs));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [convId, setConvId]);

  const cards = useMemo(() => messages.flatMap((m) => m.cards ?? []), [messages]);
  const reloadLive = useCallback(async () => {
    const revIds = cards.flatMap((c) => (c.type === "titles" ? c.options.map((o) => o.revisionId) : c.type === "metadata" ? c.changes.map((x) => x.revisionId) : []));
    const ideaIds = cards.flatMap((c) => (c.type === "concept" ? [c.ideaId] : []));
    const yt = [...new Set(cards.flatMap((c) => (c.type === "task" && c.queue === "yt" ? [c.jobId] : [])))];
    const dn = [...new Set(cards.flatMap((c) => (c.type === "task" && c.queue === "dn" ? [c.jobId] : [])))];
    try {
      const [revs, ideas, ytJobs, dnJobs, active] = await Promise.all([data.loadRevisions(revIds), data.loadIdeas(ideaIds), data.loadJobs(yt), data.loadDnJobs(dn), data.activeJobsFor(studioId, scope)]);
      const jobs = new Map<string, { row: JobRow; queue: "yt" | "dn" }>();
      for (const j of ytJobs) jobs.set(j.id, { row: j, queue: "yt" });
      for (const j of dnJobs) jobs.set(j.id, { row: j, queue: "dn" });
      for (const j of active) jobs.set(j.id, { row: j, queue: "yt" });
      setLive({ revisions: new Map(revs.map((r: Revision) => [r.id, r])), ideas: new Map(ideas.map((i: Idea) => [i.id, i])), jobs, now: Date.now() });
      setProjectJobs(active);
    } catch {
      /* the cards show "status laden…" and the next poll tries again */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, studioId, scope.projectId, scope.projectKind]);

  useEffect(() => {
    void reloadMessages();
  }, [reloadMessages]);
  useEffect(() => {
    void reloadLive();
  }, [reloadLive]);

  // Live updates (realtime when it works; polling stays as a safety net).
  useEffect(() => {
    if (!convId) return;
    const ch = supabase
      .channel(`ivar-${convId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ivar_messages", filter: `conversation_id=eq.${convId}` }, () => void reloadMessages())
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [convId, reloadMessages]);
  const waiting = messages.some((m) => m.role === "assistant" && (m.status === "pending" || m.status === "running"));
  const activeTasks = [...live.jobs.values()].filter((j) => j.row.status === "queued" || j.row.status === "running");
  useEffect(() => {
    const fast = waiting || activeTasks.length > 0;
    const ms = open ? (fast ? 3000 : 20_000) : fast ? 8000 : 60_000;
    const id = setInterval(() => {
      if (!pageVisible()) return;
      void reloadMessages();
      void reloadLive();
    }, ms);
    return () => clearInterval(id);
  }, [open, waiting, activeTasks.length, reloadMessages, reloadLive]);
  // A ticking clock for elapsed times, only while something runs and the panel is open.
  useEffect(() => {
    if (!open || !activeTasks.length) return;
    const id = setInterval(() => setLive((l) => ({ ...l, now: Date.now() })), 1000);
    return () => clearInterval(id);
  }, [open, activeTasks.length]);
  useEffect(() => {
    if (!open) return;
    const check = () => void workerHealth().then((h) => setWorkerOnline(!!h));
    check();
    const id = setInterval(check, 20_000);
    return () => clearInterval(id);
  }, [open]);

  // While open, everything counts as seen; the launcher then shows only what happened after closing.
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    setSeenAt(now);
    store.set("seen", String(now));
  }, [open, messages, live.jobs]);

  // The state of the project in scope, for quiet suggestions.
  useEffect(() => {
    setProjectState(null);
    if (!scope.projectId || !scope.projectKind) return;
    const id = scope.projectId;
    if (scope.projectKind === "video") {
      void supabase.from("yt_videos").select("status, youtube_video_id").eq("id", id).maybeSingle<{ status: string; youtube_video_id: string | null }>().then(async ({ data: v }) => {
        if (!v) return;
        const r = await supabase.from("yt_renders").select("id").eq("video_id", id).limit(1).returns<{ id: string }[]>();
        const s = v.youtube_video_id ? await supabase.from("yt_video_snapshots").select("id").eq("youtube_video_id", v.youtube_video_id).limit(1).returns<{ id: string }[]>() : { data: [] };
        setProjectState({ kind: "video", status: v.status, hasRender: !!r.data?.length, onYouTube: !!v.youtube_video_id, hasStats: !!s.data?.length });
      });
    } else if (scope.projectKind === "recording") {
      void supabase.from("yt_moments").select("id").eq("recording_id", id).limit(1).returns<{ id: string }[]>().then(({ data: m }) => setProjectState({ kind: "recording", status: "ready", analysed: !!m?.length }));
    } else {
      void supabase.from("dn_episodes").select("status").eq("id", id).maybeSingle<{ status: string }>().then(({ data: e }) => e && setProjectState({ kind: "episode", status: e.status }));
    }
  }, [scope.projectId, scope.projectKind]);

  // ---------- launcher signal ----------
  const signal: LauncherSignal = useMemo(
    () =>
      launcherSignal(
        [...live.jobs.values()].map((j) => taskView(j.row, j.queue)),
        messages.filter((m) => m.role === "assistant").map((m) => ({ status: m.status, updated_at: m.updated_at })),
        seenAt,
      ),
    [live.jobs, messages, seenAt],
  );

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  useEffect(() => {
    if (open && view === "chat") setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, view, convId]);

  const newConversation = () => {
    setConvId(null);
    setDraftScope(null);
    setView("chat");
  };

  const ctx: CardCtx = { studioId, conversationId: convId, workerOnline, live, refresh: () => void reloadLive(), ask: (t) => void sendRef.current?.(t) };
  const sendRef = useRef<((text: string) => Promise<boolean>) | null>(null);

  const panelStyle: React.CSSProperties = mobile ? { height: vvh ? `${vvh}px` : "100dvh" } : {};
  const statusText = signal === "busy" ? "taak bezig" : signal === "ready" ? "resultaat klaar" : signal === "attention" ? "heeft aandacht nodig" : "";

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Ivar openen, Studio Assistant${statusText ? ` (${statusText})` : ""}`}
          title="Ivar — Studio Assistant (Alt+I)"
          className="fixed z-40 flex h-14 w-14 items-center justify-center rounded-full border border-violet-200 bg-surface shadow-[var(--shadow-pop)] motion-safe:transition hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          style={{ right: "max(1rem, env(safe-area-inset-right))", bottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <Avatar size={40} />
          {signal !== "idle" && (
            <span aria-hidden className={`absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface ${signal === "busy" ? "bg-violet-500" : signal === "ready" ? "bg-emerald-500" : "bg-amber-500"}`}>
              {signal === "busy" && <span className="absolute inset-[-4px] rounded-full border-2 border-violet-400/60 border-t-transparent motion-safe:animate-spin [animation-duration:2.4s]" />}
            </span>
          )}
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="Ivar — Studio Assistant"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              if (view !== "chat") setView("chat");
              else setOpen(false);
            }
          }}
          className={`fixed z-40 flex flex-col overflow-hidden border-slate-200 bg-surface shadow-[var(--shadow-pop)] motion-safe:animate-[ivar-in_160ms_ease-out] ${
            mobile ? "inset-x-0 top-0 border-0" : `bottom-3 right-3 top-3 rounded-2xl border ${expanded ? "w-[min(760px,calc(100vw-1.5rem))]" : "w-[420px]"}`
          }`}
          style={{ ...panelStyle, paddingBottom: mobile ? "env(safe-area-inset-bottom)" : undefined }}
        >
          <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <Avatar />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-slate-900">Ivar — Studio Assistant</h2>
              <button type="button" onClick={() => setView(view === "scope" ? "chat" : "scope")} className="flex max-w-full items-center gap-0.5 truncate text-xs text-violet-700 hover:underline" aria-label={`Scope: ${scopeTrail(scope).join(" → ")}. Klik om te wijzigen.`}>
                {scopeTrail(scope).map((part, i) => (
                  <span key={i} className="inline-flex min-w-0 items-center gap-0.5">
                    {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
                    <span className="truncate">{part}</span>
                  </span>
                ))}
              </button>
            </div>
            <IconButton label="Gesprekken" onClick={() => setView(view === "history" ? "chat" : "history")} active={view === "history"}>
              <History className="h-4 w-4" />
            </IconButton>
            <IconButton label="Geheugen" onClick={() => setView(view === "memory" ? "chat" : "memory")} active={view === "memory"}>
              <Brain className="h-4 w-4" />
            </IconButton>
            <IconButton label="Nieuw gesprek" onClick={newConversation}>
              <MessageSquarePlus className="h-4 w-4" />
            </IconButton>
            {!mobile && (
              <IconButton label={expanded ? "Kleiner" : "Vergroten"} onClick={() => (setExpanded(!expanded), store.set("expanded", expanded ? "0" : "1"))}>
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </IconButton>
            )}
            <IconButton label="Minimaliseren (taken lopen door)" onClick={() => setOpen(false)}>
              {mobile ? <X className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
            </IconButton>
          </header>

          {error && (
            <p role="alert" className="mx-3 mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
              {error}
            </p>
          )}

          {view === "history" && <HistoryView studioId={studioId} channels={channels} currentChannel={page.channelId} active={convId} onOpen={(id) => (setConvId(id), setView("chat"))} onDeleted={(id) => id === convId && newConversation()} />}
          {view === "memory" && <MemoryView studioId={studioId} channels={channels} scope={scope} />}
          {view === "scope" && (
            <ScopeView
              studioId={studioId}
              channels={channels}
              scope={scope}
              locked={waiting}
              onPick={async (next) => {
                try {
                  if (conv) {
                    await data.setConversationScope(conv.id, next);
                    await reloadMessages();
                  } else setDraftScope(next);
                  setView("chat");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          )}
          {view === "chat" && (
            <ChatView
              studioId={studioId}
              conv={conv}
              convId={convId}
              messages={messages}
              scope={scope}
              pageScope={pageScope}
              scopeDiffers={scopeDiffers}
              projectJobs={projectJobs}
              ctx={ctx}
              sendRef={sendRef}
              inputRef={inputRef}
              suggestionList={suggestions(kindOf(channels.find((c) => c.id === scope.channelId)), projectState)}
              onNewForPage={() => {
                setConvId(null);
                setDraftScope(pageScope);
              }}
              onCreated={(c) => {
                setConvIdState(c.id);
                store.set("conversation", c.id);
                setConv(c);
                setDraftScope(null);
              }}
              reload={reloadMessages}
              setError={setError}
            />
          )}
        </section>
      )}
    </>
  );
}

function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${active ? "bg-violet-50 text-violet-700" : ""}`}>
      {children}
    </button>
  );
}

/** Plain text with **bold** and "- " bullets; nothing else is interpreted (no HTML from the model). */
function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>));
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l)))
          return (
            <ul key={i} className="my-1 list-disc space-y-0.5 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i} className="my-1 whitespace-pre-wrap">
            {inline(b)}
          </p>
        );
      })}
    </>
  );
}

function ChatView(props: {
  studioId: string;
  conv: Conversation | null;
  convId: string | null;
  messages: Message[];
  scope: Scope;
  pageScope: Scope;
  scopeDiffers: boolean;
  projectJobs: JobRow[];
  ctx: CardCtx;
  sendRef: React.MutableRefObject<((text: string) => Promise<boolean>) | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  suggestionList: string[];
  onNewForPage: () => void;
  onCreated: (c: Conversation) => void;
  reload: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const { studioId, conv, convId, messages, scope, ctx } = props;
  const draftKey = `draft:${convId ?? "new"}`;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [busyStop, setBusyStop] = useState(false);
  const pendingKey = useRef<{ text: string; key: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => setText(store.get(draftKey) ?? ""), [draftKey]);
  const setDraft = (v: string) => {
    setText(v);
    store.set(draftKey, v || null);
  };

  const last = messages[messages.length - 1];
  const waitingReply = [...messages].reverse().find((m) => m.role === "assistant" && (m.status === "pending" || m.status === "running")) ?? null;
  const lastDone = useRef<string | null>(null);
  useEffect(() => {
    const done = [...messages].reverse().find((m) => m.role === "assistant" && m.status !== "pending" && m.status !== "running");
    if (done && lastDone.current && done.id !== lastDone.current) setAnnounce(done.status === "done" ? "Ivar heeft geantwoord" : done.status === "error" ? "Ivar kon niet antwoorden" : "Antwoord gestopt");
    lastDone.current = done?.id ?? lastDone.current ?? "start";
  }, [messages]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, last?.status, last?.cards?.length]);

  const sendText = async (raw: string): Promise<boolean> => {
    const body = raw.trim();
    if (!body || sending || waitingReply) return false;
    setSending(true);
    props.setError(null);
    try {
      let id = convId;
      if (!id) {
        const c = await data.createConversation(studioId, scope);
        props.onCreated(c);
        id = c.id;
      }
      // The same text after a failed attempt keeps its key: the database sees it as the same message.
      if (!pendingKey.current || pendingKey.current.text !== body) pendingKey.current = { text: body, key: clientKey() };
      await data.send(id, body, pendingKey.current.key, { ...scope, page: props.pageScope.page ?? null });
      pendingKey.current = null;
      store.set(`draft:${convId ?? "new"}`, null);
      store.set(`draft:${id}`, null);
      setText("");
      await props.reload();
      return true;
    } catch (e) {
      props.setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSending(false);
    }
  };
  props.sendRef.current = sendText;

  const waitedLong = waitingReply && Date.now() - Date.parse(waitingReply.created_at) > 15_000 && waitingReply.status === "pending";
  const running = props.projectJobs.filter((j) => !messages.some((m) => m.cards?.some((c) => c.type === "task" && c.jobId === j.id)));

  return (
    <>
      {props.scopeDiffers && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
          <span className="min-w-0 flex-1 truncate">Je kijkt nu naar {scopeTrail(props.pageScope).join(" → ")}. Dit gesprek blijft bij {scopeTrail(scope)[0]}.</span>
          <button type="button" onClick={props.onNewForPage} className="font-medium text-violet-700 hover:underline">
            Nieuw gesprek hier
          </button>
        </div>
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2" aria-label="Gesprek met Ivar">
        {running.length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-medium text-slate-500">Lopende taken bij dit project</p>
            {running.map((j) => (
              <TaskCard key={j.id} card={{ type: "task", queue: "yt", jobId: j.id, label: scopeTrail(scope).slice(0, 2).join(" → ") }} ctx={ctx} />
            ))}
          </div>
        )}
        {!messages.length && (
          <div className="py-4 text-sm text-slate-600">
            <p>Hoi! Ik denk mee over video's en voer opdrachten uit in de studio: titels, analyses, editvoorstellen, montages starten en de voortgang volgen. Ik publiceer nooit zelf.</p>
            {props.suggestionList.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {props.suggestionList.map((s) => (
                  <button key={s} type="button" onClick={() => setDraft(s)} className="rounded-full border border-violet-200 px-3 py-1 text-xs text-violet-800 hover:bg-violet-50">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="my-2 flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-violet-600 px-3 py-2 text-sm text-white">{m.content}</p>
            </div>
          ) : (
            <div key={m.id} className="my-2 text-sm text-slate-800">
              {(m.status === "pending" || m.status === "running") && !m.content ? (
                <p className="inline-flex items-center gap-1.5 text-slate-500">
                  <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
                  {m.note ?? "Denkt na"}…
                </p>
              ) : (
                <div className={m.status === "error" ? "rounded-md bg-red-50 p-2 text-red-800" : ""}>
                  <Rich text={m.content} />
                </div>
              )}
              {(m.cards ?? []).map((c: Card, i) => (
                <IvarCard key={`${m.id}-${i}`} card={c} ctx={ctx} />
              ))}
              {(m.status === "error" || m.status === "stopped") && m.id === last?.id && (
                <button type="button" onClick={() => void data.retryReply(m.id).then(props.reload, (e) => props.setError(e.message))} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Opnieuw proberen (zelfde vraag, geen dubbele kosten)
                </button>
              )}
            </div>
          ),
        )}
        {waitedLong && <p className="my-1 text-xs text-slate-500">Nog geen reactie van de werker op de pc. Staat hij aan? Ivar antwoordt zodra hij het bericht oppakt.</p>}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>
      <form
        className="border-t border-slate-200 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void sendText(text);
        }}
      >
        <label htmlFor="ivar-input" className="sr-only">
          Bericht aan Ivar
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="ivar-input"
            ref={props.inputRef}
            value={text}
            rows={Math.min(6, Math.max(1, text.split("\n").length))}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void sendText(text);
              }
            }}
            placeholder={conv || props.messages.length ? "Vraag of opdracht…" : `Vraag iets over ${scopeTrail(scope).slice(0, 2).join(" → ")}…`}
            className="min-h-10 flex-1 resize-none rounded-lg border border-slate-200 bg-surface px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 sm:text-sm"
          />
          {waitingReply ? (
            <button
              type="button"
              disabled={busyStop}
              onClick={() => {
                setBusyStop(true);
                void data
                  .stopReply(waitingReply.id)
                  .then(props.reload, (e) => props.setError(e.message))
                  .finally(() => setBusyStop(false));
              }}
              aria-label="Antwoord stoppen (stopt geen render of analyse)"
              title="Antwoord stoppen (stopt geen render of analyse)"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" disabled={sending || !text.trim()} aria-label="Versturen" className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          )}
        </div>
        <p className="mt-1 px-1 text-[11px] text-slate-400">Enter verstuurt · Shift+Enter nieuwe regel · ± 1 cent per antwoord (Gemini, binnen het maandplafond)</p>
      </form>
    </>
  );
}

function HistoryView({ studioId, channels, currentChannel, active, onOpen, onDeleted }: { studioId: string; channels: ChannelInfo[]; currentChannel: string | null; active: string | null; onOpen: (id: string) => void; onDeleted: (id: string) => void }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [q, setQ] = useState("");
  const [onlyChannel, setOnlyChannel] = useState(!!currentChannel);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => data.listConversations(studioId, q).then(setList, (e) => setError(e.message)), [studioId, q]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);
  const shown = (list ?? []).filter((c) => !onlyChannel || c.channel_id === currentChannel);
  const name = (id: string | null) => channels.find((c) => c.id === id)?.name ?? "Hele studio";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Zoek in gesprekken</span>
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op titel" className="w-full rounded-md border border-slate-200 bg-surface py-1.5 pl-8 pr-2 text-sm" />
        </label>
        {currentChannel && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={onlyChannel} onChange={(e) => setOnlyChannel(e.target.checked)} /> Dit kanaal
          </label>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {list === null ? (
        <p className="mt-3 text-sm text-slate-500">Laden…</p>
      ) : !shown.length ? (
        <p className="mt-3 text-sm text-slate-500">Nog geen gesprekken{onlyChannel ? " in dit kanaal" : ""}.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {shown.map((c) => (
            <li key={c.id} className={`flex items-center gap-1 py-1.5 ${c.id === active ? "font-medium" : ""}`}>
              {editing === c.id ? (
                <form
                  className="flex flex-1 gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void data.renameConversation(c.id, title).then(() => (setEditing(null), load()), (er) => setError(er.message));
                  }}
                >
                  <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="flex-1 rounded border border-slate-200 bg-surface px-2 py-1 text-sm" aria-label="Nieuwe titel" />
                  <button type="submit" className="text-xs text-violet-700">
                    Opslaan
                  </button>
                </form>
              ) : (
                <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 flex-1 rounded px-1 py-1 text-left hover:bg-slate-50">
                  <span className="block truncate text-sm text-slate-800">{c.title}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {name(c.channel_id)}
                    {c.project_label ? ` → ${c.project_label}` : ""} · {new Date(c.last_message_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                  </span>
                </button>
              )}
              <IconButton label="Hernoemen" onClick={() => (setEditing(c.id), setTitle(c.title))}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Gesprek verwijderen"
                onClick={() => {
                  if (!window.confirm(`Gesprek "${c.title}" verwijderen? Dit kan niet ongedaan worden. Taken die Ivar startte lopen gewoon door.`)) return;
                  void data.deleteConversation(c.id).then(() => (onDeleted(c.id), load()), (er) => setError(er.message));
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemoryView({ studioId, channels, scope }: { studioId: string; channels: ChannelInfo[]; scope: Scope }) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [where, setWhere] = useState<"studio" | "channel" | "project">(scope.channelId ? "channel" : "studio");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const load = useCallback(() => data.loadMemory(studioId).then(setItems, (e) => setError(e.message)), [studioId]);
  useEffect(() => void load(), [load]);
  const label = (m: MemoryItem) => (m.scope === "studio" ? "Hele studio" : `${channels.find((c) => c.id === m.channel_id)?.name ?? "Kanaal"}${m.scope === "project" ? " → project" : ""}`);
  const groups = (items ?? []).reduce<Record<string, MemoryItem[]>>((acc, m) => ((acc[label(m)] ??= []).push(m), acc), {});
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
      <p className="text-xs text-slate-600">Wat Ivar onthoudt: vaste voorkeuren en afspraken per studio, kanaal of project. Een idee uit een brainstorm komt hier niet vanzelf in.</p>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <form
        className="mt-2 space-y-1.5 rounded-md border border-slate-200 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void data
            .addMemory(studioId, text, { channelId: where === "studio" ? null : scope.channelId, projectKind: where === "project" ? scope.projectKind : null, projectId: where === "project" ? scope.projectId : null })
            .then(() => (setText(""), load()), (er) => setError(er.message));
        }}
      >
        <label className="block text-xs font-medium text-slate-600" htmlFor="ivar-mem">
          Nieuwe voorkeur
        </label>
        <textarea id="ivar-mem" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={2} className="w-full rounded border border-slate-200 bg-surface px-2 py-1 text-sm" placeholder="Bijv. Engelse voice-over, enthousiast maar niet schreeuwerig" />
        <div className="flex flex-wrap items-center gap-2">
          <select value={where} onChange={(e) => setWhere(e.target.value as typeof where)} className="rounded border border-slate-200 bg-surface px-2 py-1 text-xs" aria-label="Geldt voor">
            <option value="studio">Hele studio</option>
            {scope.channelId && <option value="channel">Kanaal {scope.channelName ?? ""}</option>}
            {scope.projectId && <option value="project">Dit project</option>}
          </select>
          <button type="submit" className="rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700">
            Onthouden
          </button>
        </div>
      </form>
      {items === null ? (
        <p className="mt-3 text-slate-500">Laden…</p>
      ) : !items.length ? (
        <p className="mt-3 text-slate-500">Nog niets vastgelegd.</p>
      ) : (
        Object.entries(groups).map(([g, list]) => (
          <div key={g} className="mt-3">
            <p className="text-xs font-medium text-slate-500">{g}</p>
            <ul className="mt-1 space-y-1">
              {list.map((m) => (
                <li key={m.id} className="flex items-start gap-1 rounded border border-slate-100 p-1.5">
                  {editing?.id === m.id ? (
                    <form
                      className="flex flex-1 gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void data.updateMemory(m.id, editing.text).then(() => (setEditing(null), load()), (er) => setError(er.message));
                      }}
                    >
                      <input autoFocus value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} maxLength={500} className="flex-1 rounded border border-slate-200 bg-surface px-2 py-0.5 text-sm" aria-label="Voorkeur aanpassen" />
                      <button type="submit" className="text-xs text-violet-700">
                        Opslaan
                      </button>
                    </form>
                  ) : (
                    <p className="flex-1 text-slate-800">
                      {m.content}
                      {m.source === "ivar" && <span className="ml-1 text-xs text-slate-400">(op jouw verzoek door Ivar)</span>}
                    </p>
                  )}
                  <IconButton label="Aanpassen" onClick={() => setEditing({ id: m.id, text: m.content })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton label="Wissen" onClick={() => void data.deleteMemory(m.id).then(load, (er) => setError(er.message))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

function ScopeView({ studioId, channels, scope, locked, onPick }: { studioId: string; channels: ChannelInfo[]; scope: Scope; locked: boolean; onPick: (s: Scope) => void }) {
  const [channelId, setChannelId] = useState<string | null>(scope.channelId);
  const [options, setOptions] = useState<data.ProjectOption[] | null>(null);
  const channel = channels.find((c) => c.id === channelId) ?? null;
  useEffect(() => {
    setOptions(null);
    if (channel) void data.projectOptions(studioId, channel.id, isDreamnestChannel(channel)).then(setOptions);
  }, [studioId, channel]);
  const item = "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <p className="text-xs text-slate-600">Waar gaat dit gesprek over? Een andere scope geldt voor nieuwe berichten; lopende taken blijven bij hun eigen project.</p>
      {locked && <p className="mt-1 text-xs text-amber-800">Wacht tot Ivar klaar is met het huidige antwoord.</p>}
      <p className="mt-3 text-xs font-medium text-slate-500">Kanaal</p>
      <div className="mt-1 space-y-0.5">
        <button type="button" disabled={locked} className={`${item} ${!channelId ? "bg-violet-50 font-medium" : ""}`} onClick={() => onPick({ channelId: null })}>
          Hele studio
        </button>
        {channels.map((c) => (
          <button key={c.id} type="button" disabled={locked} className={`${item} ${c.id === channelId ? "bg-violet-50 font-medium" : ""}`} onClick={() => setChannelId(c.id)}>
            {c.name}
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
          </button>
        ))}
      </div>
      {channel && (
        <>
          <p className="mt-3 text-xs font-medium text-slate-500">Project in {channel.name}</p>
          <div className="mt-1 space-y-0.5">
            <button type="button" disabled={locked} className={item} onClick={() => onPick({ channelId: channel.id, channelName: channel.name })}>
              Het hele kanaal
            </button>
            {options === null ? (
              <p className="px-2 py-1 text-xs text-slate-500">Laden…</p>
            ) : (
              options.map((o) => (
                <button key={o.id} type="button" disabled={locked} className={`${item} ${o.id === scope.projectId ? "bg-violet-50 font-medium" : ""}`} onClick={() => onPick({ channelId: channel.id, channelName: channel.name, projectKind: o.kind, projectId: o.id, projectLabel: o.label })}>
                  <span className="truncate">{o.label}</span>
                  <span className="ml-2 shrink-0 text-xs text-slate-500">{o.sub}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
