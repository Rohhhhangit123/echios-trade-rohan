/// <reference lib="webworker" />

import {
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";

import type {
  VoiceDevice,
  VoiceWorkerRequest,
  VoiceWorkerResponse,
} from "./voice-types";

const MODEL_ID = "onnx-community/whisper-base.en";
const workerScope = self as unknown as DedicatedWorkerGlobalScope;

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let activeDevice: VoiceDevice | null = null;
let modelPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let webGpuDisabledForSession = false;
let processing = false;

function post(message: VoiceWorkerResponse) {
  workerScope.postMessage(message);
}

function progressCallback(device: VoiceDevice) {
  return (progress: ProgressInfo) => {
    if (progress.status === "ready") return;

    const percentage =
      "progress" in progress && Number.isFinite(progress.progress)
        ? Math.max(0, Math.min(100, progress.progress))
        : undefined;
    const file = "file" in progress ? progress.file : undefined;

    post({
      type: "loading",
      device,
      progress: percentage,
      detail: file ? `Downloading ${file}` : "Loading the local speech model",
    });
  };
}

async function createTranscriber(
  device: VoiceDevice,
): Promise<AutomaticSpeechRecognitionPipeline> {
  post({
    type: "loading",
    device,
    detail:
      device === "webgpu"
        ? "Loading the local speech model with WebGPU"
        : "Loading the local speech model with CPU fallback",
  });

  const instance = await pipeline(
    "automatic-speech-recognition",
    MODEL_ID,
    device === "webgpu"
      ? {
          device: "webgpu",
          dtype: {
            encoder_model: "fp32",
            decoder_model_merged: "q4",
          },
          progress_callback: progressCallback(device),
        }
      : {
          device: "wasm",
          dtype: {
            encoder_model: "q8",
            decoder_model_merged: "q4",
          },
          progress_callback: progressCallback(device),
        },
  );

  transcriber = instance;
  activeDevice = device;
  post({ type: "ready", device });
  return instance;
}

async function loadForDevice(
  device: VoiceDevice,
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (transcriber && activeDevice === device) return transcriber;

  modelPromise = createTranscriber(device);
  try {
    return await modelPromise;
  } finally {
    modelPromise = null;
  }
}

async function ensureTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (transcriber) return transcriber;
  if (modelPromise) return modelPromise;

  const gpu = (
    workerScope.navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown | null> };
    }
  ).gpu;
  let supportsWebGpu = false;
  if (gpu && !webGpuDisabledForSession) {
    try {
      supportsWebGpu = Boolean(await gpu.requestAdapter());
    } catch {
      supportsWebGpu = false;
    }
  }
  if (supportsWebGpu && !webGpuDisabledForSession) {
    try {
      return await loadForDevice("webgpu");
    } catch {
      webGpuDisabledForSession = true;
      transcriber = null;
      activeDevice = null;
    }
  }

  return loadForDevice("wasm");
}

async function switchToWasm() {
  webGpuDisabledForSession = true;
  if (transcriber) {
    try {
      await transcriber.dispose();
    } catch {
      // A failed WebGPU session may already be partially disposed.
    }
  }
  transcriber = null;
  activeDevice = null;
  modelPromise = null;
  return loadForDevice("wasm");
}

async function transcribe(audio: Float32Array) {
  if (processing) return;
  processing = true;

  try {
    let model: AutomaticSpeechRecognitionPipeline;
    try {
      model = await ensureTranscriber();
    } catch {
      post({
        type: "error",
        code: "model_load",
        message:
          "The speech model could not be loaded. Check your connection and try again.",
      });
      return;
    }

    post({ type: "transcribing", device: activeDevice ?? "wasm" });

    let result;
    try {
      result = await model(audio);
    } catch {
      if (activeDevice !== "webgpu") throw new Error("inference_failed");
      try {
        model = await switchToWasm();
        post({ type: "transcribing", device: "wasm" });
        result = await model(audio);
      } catch {
        throw new Error("inference_failed");
      }
    }

    const text = Array.isArray(result)
      ? result.map((item) => item.text).join(" ").trim()
      : result.text.trim();

    if (!text) {
      post({
        type: "error",
        code: "empty_speech",
        message: "No speech was recognized. Try speaking a little closer to the microphone.",
      });
      return;
    }

    post({ type: "complete", text, device: activeDevice ?? "wasm" });
  } catch {
    post({
      type: "error",
      code: "inference",
      message: "Local transcription failed. Please record the question again.",
    });
  } finally {
    processing = false;
  }
}

workerScope.addEventListener("message", (event: MessageEvent<VoiceWorkerRequest>) => {
  if (event.data.type === "load") {
    void ensureTranscriber().catch(() => {
      post({
        type: "error",
        code: "model_load",
        message:
          "The speech model could not be loaded. Check your connection and try again.",
      });
    });
    return;
  }

  void transcribe(event.data.audio);
});
