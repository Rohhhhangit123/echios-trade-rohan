"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Cpu,
  Database,
  Lightbulb,
  Loader2,
  Mic,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  User,
} from "lucide-react";
import clsx from "clsx";

import { api } from "@/lib/api";
import type {
  AssistantCitation,
  AssistantChatResponse,
  AssistantHistoryMessage,
} from "@/lib/types";
import type {
  VoiceDevice,
  VoiceWorkerRequest,
  VoiceWorkerResponse,
} from "./voice-types";

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
  "Give me investment recommendations for my portfolio.",
];

const WHISPER_SAMPLE_RATE = 16_000;
const MAX_RECORDING_SECONDS = 30;
const MAX_AUDIO_SAMPLES = WHISPER_SAMPLE_RATE * MAX_RECORDING_SECONDS;

type ModelStatus = "idle" | "loading" | "ready" | "error";

function historyText(message: ChatMessage): string {
  if (!message.reply) return message.content;
  return [
    message.reply.summary.text,
    ...message.reply.insights.map((claim) => claim.text),
    ...message.reply.suggestions.map((claim) => claim.text),
  ].join("\n");
}

function preferredRecordingMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone access was denied. Allow microphone access in your browser and try again.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found on this device.";
    }
    if (error.name === "NotReadableError") {
      return "The microphone is already in use by another application.";
    }
  }
  return "The microphone could not be started. Check your browser permissions and try again.";
}

function recordingTime(seconds: number): string {
  return `0:${String(seconds).padStart(2, "0")}`;
}

function hasAudibleSpeech(audio: Float32Array): boolean {
  if (audio.length < WHISPER_SAMPLE_RATE / 4) return false;
  let energy = 0;
  for (let index = 0; index < audio.length; index += 1) {
    energy += audio[index] * audio[index];
  }
  return Math.sqrt(energy / audio.length) >= 0.002;
}

async function decodeAndResampleAudio(blob: Blob): Promise<Float32Array> {
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.length || !decoded.duration) {
      throw new Error("empty_audio");
    }

    const mono = audioContext.createBuffer(
      1,
      decoded.length,
      decoded.sampleRate,
    );
    const monoData = mono.getChannelData(0);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const channelData = decoded.getChannelData(channel);
      for (let index = 0; index < channelData.length; index += 1) {
        monoData[index] += channelData[index] / decoded.numberOfChannels;
      }
    }

    const frameCount = Math.min(
      MAX_AUDIO_SAMPLES,
      Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE),
    );
    const offlineContext = new OfflineAudioContext(
      1,
      frameCount,
      WHISPER_SAMPLE_RATE,
    );
    const source = offlineContext.createBufferSource();
    source.buffer = mono;
    source.connect(offlineContext.destination);
    source.start();

    const rendered = await offlineContext.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  } finally {
    await audioContext.close();
  }
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
  const [chatError, setChatError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [modelDetail, setModelDetail] = useState("");
  const [voiceDevice, setVoiceDevice] = useState<VoiceDevice | null>(null);
  const [clientName, setClientName] = useState("Portfolio account");
  const endRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const mountedRef = useRef(false);

  const voiceBusy = isRecording || isTranscribing;

  useEffect(() => {
    mountedRef.current = true;
    const worker = new Worker(
      new URL("./transcription.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    const handleWorkerMessage = (
      event: MessageEvent<VoiceWorkerResponse>,
    ) => {
      const message = event.data;
      switch (message.type) {
        case "loading":
          setModelStatus("loading");
          setModelDetail(message.detail);
          setModelProgress(message.progress ?? null);
          setVoiceDevice(message.device);
          break;
        case "ready":
          setModelStatus("ready");
          setModelProgress(null);
          setModelDetail("");
          setVoiceDevice(message.device);
          break;
        case "transcribing":
          setModelStatus("ready");
          setModelProgress(null);
          setVoiceDevice(message.device);
          setIsTranscribing(true);
          break;
        case "complete":
          setModelStatus("ready");
          setVoiceDevice(message.device);
          setIsTranscribing(false);
          setVoiceError(null);
          setDraft((current) => {
            const combined = current.trim()
              ? `${current.trimEnd()} ${message.text}`
              : message.text;
            return combined.slice(0, 2000);
          });
          break;
        case "error":
          if (message.code === "model_load") setModelStatus("error");
          setIsTranscribing(false);
          setVoiceError(message.message);
          break;
      }
    };

    const handleWorkerError = (event: ErrorEvent) => {
      event.preventDefault();
      setModelStatus("error");
      setIsTranscribing(false);
      setVoiceError(
        "The local transcription worker stopped unexpectedly. Reload the page and try again.",
      );
    };

    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", handleWorkerError);

    return () => {
      mountedRef.current = false;
      clearRecordingTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      recorderRef.current = null;
      releaseMicrophone();
      worker.removeEventListener("message", handleWorkerMessage);
      worker.removeEventListener("error", handleWorkerError);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

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

  function clearRecordingTimers() {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }

  function releaseMicrophone() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function processRecording(blob: Blob) {
    if (!blob.size) {
      setVoiceError("No audio was captured. Please record the question again.");
      return;
    }

    setIsTranscribing(true);
    setVoiceError(null);
    try {
      const audio = await decodeAndResampleAudio(blob);
      if (!mountedRef.current) return;
      if (!hasAudibleSpeech(audio)) {
        setIsTranscribing(false);
        setVoiceError(
          "No speech was detected. Try speaking a little closer to the microphone.",
        );
        return;
      }

      const worker = workerRef.current;
      if (!worker) throw new Error("worker_unavailable");
      const message: VoiceWorkerRequest = { type: "transcribe", audio };
      worker.postMessage(message, [audio.buffer]);
    } catch {
      if (!mountedRef.current) return;
      setIsTranscribing(false);
      setVoiceError(
        "The recording could not be decoded. Please record the question again.",
      );
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    clearRecordingTimers();
    setIsRecording(false);
    setRecordedSeconds(0);
    recorder.stop();
    releaseMicrophone();
  }

  async function startRecording() {
    if (loading || voiceBusy) return;
    setVoiceError(null);

    if (!window.isSecureContext) {
      setVoiceError(
        "Voice input requires HTTPS or localhost so the browser can access the microphone.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
      setVoiceError("This browser does not support microphone recording.");
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = preferredRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType,
        });
        chunksRef.current = [];
        if (recorderRef.current === recorder) recorderRef.current = null;
        if (mountedRef.current) void processRecording(audioBlob);
      };

      const loadMessage: VoiceWorkerRequest = { type: "load" };
      workerRef.current?.postMessage(loadMessage);
      recorder.start(250);
      recordingStartedAtRef.current = Date.now();
      setRecordedSeconds(0);
      setIsRecording(true);

      recordingIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() - recordingStartedAtRef.current) / 1000,
        );
        setRecordedSeconds(Math.min(MAX_RECORDING_SECONDS, elapsed));
      }, 250);
      recordingTimeoutRef.current = setTimeout(
        stopRecording,
        MAX_RECORDING_SECONDS * 1000,
      );
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop());
      releaseMicrophone();
      setIsRecording(false);
      setVoiceError(microphoneErrorMessage(caught));
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const question = draft.trim();
    if (!question || loading || voiceBusy) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: question,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setChatError(null);
    setLoading(true);

    try {
      const reply = await api.assistantChat(question, apiHistory);
      setClientName(reply.client_name);
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: reply.summary.text,
          reply,
        },
      ]);
    } catch (caught) {
      setChatError(caught instanceof Error ? caught.message : String(caught));
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
            Account-aware portfolio intelligence with semantic market retrieval.
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
          detail="Server-scoped access to the active account"
        />
        <InfoPill
          icon={<Sparkles className="h-4 w-4" />}
          title="Market intelligence"
          detail="Semantic retrieval across portfolio market data"
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
                  {message.content}{" "}
                  {message.reply && (
                    <CitationMarkers
                      citationIds={message.reply.summary.citation_ids}
                      citations={message.reply.citations}
                    />
                  )}
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
          {chatError && (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
            >
              {chatError}
            </div>
          )}
          {voiceError && (
            <div
              role="alert"
              className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
            >
              <Mic className="h-3.5 w-3.5 shrink-0" />
              {voiceError}
            </div>
          )}
          <form onSubmit={submit} className="flex items-end gap-2">
            <button
              type="button"
              data-testid="voice-input-button"
              onClick={() => {
                if (isRecording) stopRecording();
                else void startRecording();
              }}
              disabled={loading || isTranscribing}
              aria-label={
                isRecording
                  ? "Stop voice recording"
                  : isTranscribing
                    ? "Transcribing voice"
                    : "Start voice input"
              }
              aria-pressed={isRecording}
              title={
                isRecording
                  ? "Stop recording"
                  : "Record a question locally with Whisper"
              }
              className={clsx(
                "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border text-white transition disabled:cursor-not-allowed disabled:opacity-40",
                isRecording
                  ? "animate-pulse border-rose-400 bg-rose-600 hover:bg-rose-500"
                  : "border-slate-700 bg-slate-900 hover:border-violet-500/60 hover:bg-slate-800",
              )}
            >
              {isRecording ? (
                <Square className="h-4 w-4 fill-current" />
              ) : isTranscribing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </button>
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
              disabled={loading || voiceBusy || draft.trim().length < 2}
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
          {(isRecording ||
            isTranscribing ||
            modelStatus === "loading" ||
            (modelStatus === "ready" && voiceDevice)) && (
            <div
              aria-live="polite"
              className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[10px] text-slate-500"
            >
              {isRecording ? (
                <>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
                  <span className="text-rose-300">
                    Recording {recordingTime(recordedSeconds)} / 0:30
                  </span>
                  {modelStatus === "loading" && (
                    <span>
                      · preparing Whisper
                      {modelProgress !== null
                        ? ` ${Math.round(modelProgress)}%`
                        : ""}
                    </span>
                  )}
                </>
              ) : modelStatus === "loading" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>
                    {modelDetail || "Loading the local speech model"}
                    {modelProgress !== null
                      ? ` · ${Math.round(modelProgress)}%`
                      : ""}
                  </span>
                </>
              ) : isTranscribing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>
                    Transcribing locally with {voiceDevice === "wasm" ? "CPU" : "WebGPU"}
                  </span>
                </>
              ) : (
                <>
                  {voiceDevice === "wasm" ? (
                    <Cpu className="h-3 w-3" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  <span>
                    Local voice ready · {voiceDevice === "wasm" ? "CPU fallback" : "WebGPU"}
                  </span>
                </>
              )}
            </div>
          )}
          <p className="mt-2 text-center text-[10px] text-slate-600">
            Voice processing stays on this device
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
                key={`${insight.text}-${insight.citation_ids.join("-")}`}
                className="flex gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-slate-300"
              >
                <span className="font-bold text-violet-400">•</span>
                <span>
                  {insight.text}{" "}
                  <CitationMarkers
                    citationIds={insight.citation_ids}
                    citations={reply.citations}
                  />
                </span>
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
              <li
                key={`${suggestion.text}-${suggestion.citation_ids.join("-")}`}
                className="flex gap-2"
              >
                <span className="text-amber-400">•</span>
                <span>
                  {suggestion.text}{" "}
                  <CitationMarkers
                    citationIds={suggestion.citation_ids}
                    citations={reply.citations}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-[10px] text-slate-500">
        <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">
          {reply.citations.length} cited record
          {reply.citations.length === 1 ? "" : "s"}
        </summary>
        <div className="mt-2 space-y-1.5 pl-1">
          {reply.citations.map((citation, index) => (
            <div key={citation.id} className="flex gap-2">
              <Database className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <span className="text-violet-300">[{index + 1}]</span>{" "}
                <span className="text-slate-400">{citation.label}:</span>{" "}
                {citation.detail}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function CitationMarkers({
  citationIds,
  citations,
}: {
  citationIds: string[];
  citations: AssistantCitation[];
}) {
  const cited = citationIds
    .map((id) => {
      const index = citations.findIndex((citation) => citation.id === id);
      return index >= 0 ? { citation: citations[index], index } : null;
    })
    .filter(
      (item): item is { citation: AssistantCitation; index: number } => item !== null,
    )
    .filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.index === item.index) === index,
    )
    .sort((left, right) => left.index - right.index);

  if (cited.length === 0) return null;
  const groups = cited.reduce<Array<typeof cited>>((current, item) => {
    const group = current[current.length - 1];
    if (group && item.index === group[group.length - 1].index + 1) {
      group.push(item);
    } else {
      current.push([item]);
    }
    return current;
  }, []);

  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {groups.map((group) => {
        const first = group[0].index + 1;
        const last = group[group.length - 1].index + 1;
        const label = first === last ? `[${first}]` : `[${first}–${last}]`;
        return (
          <span
            key={group.map(({ citation }) => citation.id).join("-")}
            title={group
              .map(({ citation }) => `${citation.label}: ${citation.detail}`)
              .join("\n")}
            className="rounded border border-violet-500/30 bg-violet-500/10 px-1 py-0.5 text-[9px] font-semibold leading-none text-violet-300"
          >
            {label}
          </span>
        );
      })}
    </span>
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
