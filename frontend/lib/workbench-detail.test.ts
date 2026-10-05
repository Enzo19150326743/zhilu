import assert from "node:assert/strict";
import test from "node:test";
import { getRecommendedLocalAsrEngine } from "./workbench-detail";
import type { AsrStatusResponse } from "./types";

test("未收到能力状态时仍以 SenseVoice 为默认转写引擎", () => {
  assert.equal(getRecommendedLocalAsrEngine(null), "sensevoice_small");
});

test("SenseVoice 暂不可用时不静默改用 Whisper", () => {
  const status: AsrStatusResponse = {
    success: true,
    recommended_engine: "sensevoice_small",
    whisper_model: "large-v3-turbo",
    sensevoice_available: false,
    sensevoice_model: "iic/SenseVoiceSmall",
    correction_available: false
  };

  assert.equal(getRecommendedLocalAsrEngine(status), "sensevoice_small");
});
