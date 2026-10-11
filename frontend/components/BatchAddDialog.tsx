"use client";

import { useEffect, useMemo, useState } from "react";
import { ModalDialog } from "@/components/ModalDialog";
import { TranscribeSettingsPanel } from "@/components/TranscribeSettingsPanel";
import { parseBatchInput } from "@/lib/batch-input";
import { getDefaultTranscribeSettings } from "@/lib/transcribe-settings";
import type { TranscribeContextSettings } from "@/lib/types";

interface BatchAddDialogProps {
  errorMessage: string | null;
  initialValue?: string;
  isOpen: boolean;
  isSubmitting: boolean;
  correctionAvailable?: boolean;
  onClose: () => void;
  onSubmit: (
    urls: string[],
    contextSettings: TranscribeContextSettings | null
  ) => Promise<void>;
}

export function BatchAddDialog({
  errorMessage,
  initialValue = "",
  isOpen,
  isSubmitting,
  correctionAvailable = false,
  onClose,
  onSubmit
}: BatchAddDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [contextSettings, setContextSettings] = useState<TranscribeContextSettings>(
    () => getDefaultTranscribeSettings(null)
  );
  useEffect(() => {
    if (isOpen && !value.trim() && initialValue.trim()) setValue(initialValue);
  }, [initialValue, isOpen, value]);
  const result = useMemo(() => parseBatchInput(value), [value]);
  const canSubmit = result.urls.length > 0 && !result.isTooLong && !result.isTooMany && result.invalidLines.length === 0;
  const handleSubmit = async () => {
    try {
      await onSubmit(result.urls, contextSettings);
      setValue("");
    } catch {
      // 错误由弹窗内的 errorMessage 就近显示，保留当前输入供用户重试。
    }
  };

  return (
    <ModalDialog
      description="粘贴多条公开视频链接或分享文案。每批最多 49 条。"
      footer={
        <button
          className="inline-flex h-10 items-center justify-center border-2 border-[var(--line-ink)] bg-[var(--accent)] px-5 text-sm font-bold text-[var(--paper-raised)] shadow-[2px_2px_0_0_var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canSubmit || isSubmitting}
          type="button"
          onClick={() => void handleSubmit()}
        >
          {isSubmitting ? "正在提交…" : `开始处理 ${result.urls.length} 条`}
        </button>
      }
      isBusy={isSubmitting}
      isOpen={isOpen}
      size="form"
      title="批量添加"
      onClose={onClose}
    >
      <label className="block text-sm font-semibold text-[var(--ink)]" htmlFor="batch-input">
        视频链接
      </label>
      <textarea
        aria-describedby="batch-input-help"
        className="focus-subtle mt-2 max-h-48 min-h-32 w-full resize-y border-2 border-[var(--line-ink)] bg-[var(--paper)] p-3 text-sm leading-6 focus:border-[var(--accent)]"
        data-dialog-initial-focus
        id="batch-input"
        placeholder="多条链接用换行、空格或分号分隔，也可直接粘贴分享文案"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]" id="batch-input-help">
        不必每条换行；用换行、空格或分号隔开，系统会自动提取链接并去重。
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
        <span>有效 {result.urls.length} 条</span>
        {result.duplicateCount ? <span>重复 {result.duplicateCount} 条（已折叠）</span> : null}
        {result.invalidLines.length ? <span className="text-[var(--accent-deep)]">无法识别 {result.invalidLines.length} 行，请移除后提交</span> : null}
        {result.isTooMany ? <span className="text-[var(--accent-deep)]">超过 49 条上限</span> : null}
        {result.isTooLong ? <span className="text-[var(--accent-deep)]">输入内容过长</span> : null}
      </div>
      <details className="mt-4 border border-[var(--line)] bg-[var(--paper)] p-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
          处理设置（可选）
        </summary>
        <div className="mt-4">
          <TranscribeSettingsPanel
            correctionAvailable={correctionAvailable}
            disabled={isSubmitting}
            isAlwaysOpen
            settings={contextSettings}
            onChange={setContextSettings}
          />
        </div>
      </details>
      {errorMessage ? <p className="mt-4 border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">{errorMessage}</p> : null}
    </ModalDialog>
  );
}
