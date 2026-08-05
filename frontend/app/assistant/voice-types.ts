export type VoiceDevice = "webgpu" | "wasm";

export type VoiceErrorCode =
  | "model_load"
  | "inference"
  | "empty_speech";

export type VoiceWorkerRequest =
  | { type: "load" }
  | { type: "transcribe"; audio: Float32Array };

export type VoiceWorkerResponse =
  | {
      type: "loading";
      detail: string;
      progress?: number;
      device: VoiceDevice;
    }
  | { type: "ready"; device: VoiceDevice }
  | { type: "transcribing"; device: VoiceDevice }
  | { type: "complete"; text: string; device: VoiceDevice }
  | {
      type: "error";
      code: VoiceErrorCode;
      message: string;
    };
