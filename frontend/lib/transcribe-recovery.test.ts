import assert from "node:assert/strict";
import test from "node:test";
import { pollForRecoveredValue } from "./transcribe-recovery";

test("转写恢复会在截止时刻执行最后一次查询", async () => {
  let currentTime = 0;
  let fetchCount = 0;
  const waits: number[] = [];

  const result = await pollForRecoveredValue({
    fetchValue: async () => {
      fetchCount += 1;
      return fetchCount === 2 ? "ready" : "pending";
    },
    intervalMs: 5_000,
    isRecovered: (value) => value === "ready",
    now: () => currentTime,
    timeoutMs: 5_000,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    }
  });

  assert.equal(result, "ready");
  assert.equal(fetchCount, 2);
  assert.deepEqual(waits, [5_000]);
});

test("转写恢复到期后返回空结果且不额外等待", async () => {
  let currentTime = 0;
  let fetchCount = 0;
  const waits: number[] = [];

  const result = await pollForRecoveredValue({
    fetchValue: async () => {
      fetchCount += 1;
      return "pending";
    },
    intervalMs: 5_000,
    isRecovered: () => false,
    now: () => currentTime,
    timeoutMs: 5_000,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    }
  });

  assert.equal(result, null);
  assert.equal(fetchCount, 2);
  assert.deepEqual(waits, [5_000]);
});
