"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Database,
  Lightbulb,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import clsx from "clsx";

import { api } from "@/lib/api";
import type {
  AssistantChatResponse,
  AssistantHistoryMessage,
} from "@/lib/types";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  reply?: AssistantChatResponse;
  welcome?: boolean;
};

const STARTERS = [
  "Which of my trades is currently most profitable?",
  "Summarize my portfolio risk using the simulated prices.",
  "What simulated news may affect my holdings?",
  "Give me educational investment considerations for my portfolio.",
];

function historyText(message: ChatMessage): string {
  if (!message.reply) return message.content;
  return [
    message.reply.summary,
    ...message.reply.insights,
    ...message.reply.suggestions,
  ].join("\n");
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      welcome: true,
      content:
        "Ask about P&L, risk, trades, exceptions, cash, or simulated news.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("Current client (auth stub)");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const apiHistory = useMemo<AssistantHistoryMessage[]>(
    () =>
      messages
        .filter((message) => !message.welcome)
        .slice(-8)
        .map((message) => ({
          role: message.role,
          content: historyText(message),
        })),
    [messages],
  );

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const question = draft.trim();
    if (!question || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: question,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError(null);
    setLoading(true);

    try {
      const reply = await api.assistantChat(question, apiHistory);
      setClientName(reply.client_name);
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: reply.summary,
          reply,
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <Bot className="h-7 w-7 text-violet-400" />
            AI Portfolio Assistant
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Supabase account context with repository-only simulated market retrieval.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span>{clientName}</span>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <InfoPill
          icon={<Database className="h-4 w-4" />}
          title="Private account data"
          detail="Server-filtered to the current client stub"
        />
        <InfoPill
          icon={<Sparkles className="h-4 w-4" />}
          title="Simulated market context"
          detail="Prices and news from the data folder only"
        />
        <InfoPill
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Session-only history"
          detail="Clears when this page reloads"
        />
      </div>

      <section className="flex min-h-[470px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 shadow-2xl shadow-black/20">
        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={clsx(
                "flex gap-3",
                message.role === "user" && "flex-row-reverse",
              )}
            >
              <div
                className={clsx(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  message.role === "user"
                    ? "bg-indigo-500/20 text-indigo-300"
                    : "bg-violet-500/20 text-violet-300",
                )}
              >
                {message.role === "user" ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>
              <div
                className={clsx(
                  "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6",
                  message.role === "user"
                    ? "rounded-tr-sm bg-indigo-600 text-white"
                    : "rounded-tl-sm border border-slate-800 bg-slate-950/80 text-slate-200",
                )}
              >
                <p className={clsx(message.reply && "font-medium text-white")}>
                  {message.content}
                </p>
                {message.reply && <AssistantDetails reply={message.reply} />}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
                <Bot className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin" />
                Retrieving account and simulation context…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-slate-800 bg-slate-950/60 p-4">
          {messages.length === 1 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => setDraft(starter)}
                  className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-left text-xs text-slate-300 transition hover:border-violet-500/60 hover:text-white"
                >
                  {starter}
                </button>
              ))}
            </div>
          )}
          {error && (
            <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
          <form onSubmit={submit} className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder="Ask about your trades, P&L, risk, or simulated news…"
              className="min-h-[52px] flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
            />
            <button
              type="submit"
              disabled={loading || draft.trim().length < 2}
              aria-label="Send question"
              className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-violet-600 text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </form>
          <p className="mt-2 text-center text-[10px] text-slate-600">
            Simulated data only · Educational analysis · Not financial advice
          </p>
        </div>
      </section>
    </div>
  );
}

function AssistantDetails({ reply }: { reply: AssistantChatResponse }) {
  return (
    <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
      {reply.insights.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-violet-300">
            <Sparkles className="h-3.5 w-3.5" /> Key points
          </h3>
          <ul className="grid gap-2 text-xs leading-5 sm:grid-cols-2">
            {reply.insights.map((insight) => (
              <li
                key={insight}
                className="flex gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-slate-300"
              >
                <span className="font-bold text-violet-400">•</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {reply.suggestions.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
            <Lightbulb className="h-3.5 w-3.5" /> Next steps
          </h3>
          <ul className="space-y-1 text-xs leading-5 text-slate-300">
            {reply.suggestions.map((suggestion) => (
              <li key={suggestion} className="flex gap-2">
                <span className="text-amber-400">•</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-[10px] text-slate-500">
        <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">
          {reply.sources.length} data source{reply.sources.length === 1 ? "" : "s"}
        </summary>
        <div className="mt-2 space-y-1.5 pl-1">
          {reply.sources.map((source) => (
            <div key={`${source.label}-${source.detail}`} className="flex gap-2">
              <Database className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <span className="text-slate-400">{source.label}:</span> {source.detail}
              </span>
            </div>
          ))}
        </div>
      </details>
      <p className="text-[9px] leading-4 text-slate-600">{reply.disclaimer}</p>
    </div>
  );
}

function InfoPill({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="text-violet-400">{icon}</div>
      <div>
        <p className="text-xs font-medium text-slate-200">{title}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">{detail}</p>
      </div>
    </div>
  );
}
