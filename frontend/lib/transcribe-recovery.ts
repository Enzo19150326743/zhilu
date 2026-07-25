interface PollForRecoveredValueOptions<T> {
  fetchValue: () => Promise<T>;
  intervalMs: number;
  isRecovered: (value: T) => boolean;
  now?: () => number;
  timeoutMs: number;
  wait?: (milliseconds: number) => Promise<void>;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function pollForRecoveredValue<T>({
  fetchValue,
  intervalMs,
  isRecovered,
  now = Date.now,
  timeoutMs,
  wait = defaultWait
}: PollForRecoveredValueOptions<T>): Promise<T | null> {
  const deadline = now() + timeoutMs;

  while (true) {
    try {
      const value = await fetchValue();
      if (isRecovered(value)) {
        return value;
      }
    } catch {
      // NOTE: 后端长任务写库或重载期间允许短暂查询失败，下一轮继续恢复。
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      return null;
    }

    await wait(Math.min(intervalMs, remainingMs));
  }
}
