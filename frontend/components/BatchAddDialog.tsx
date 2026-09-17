"use client";

import { useEffect, useMemo, useState } from "react";
import { ModalDialog } from "@/components/ModalDialog";
import { parseBatchInput } from "@/lib/batch-input";
import type { AsrEngine, BatchTarget } from "@/lib/types";

interface BatchAddDialogProps {
  errorMessage: string | null;
  initialValue?: string;
  isOpen: boolean;
  isSubmitting: boolean;
  sensevoiceAvailable?: boolean;
  onClose: () => void;
  onSubmit: (urls: string[], target: BatchTarget, asrEngine: AsrEngine) => Promise<void>;
}

export function BatchAddDialog({
  errorMessage,
  initialValue = "",
  isOpen,
  isSubmitting,
  sensevoiceAvailable = false,
  onClose,
  onSubmit
}: BatchAddDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [target, setTarget] = useState<BatchTarget>("analyze");
  const [asrEngine, setAsrEngine] = useState<AsrEngine>("local_whisper");
  useEffect(() => {
    if (isOpen && !value.trim() && initialValue.trim()) setValue(initialValue);
  }, [initialValue, isOpen, value]);
  const result = useMemo(() => parseBatchInput(value), [value]);
  const canSubmit = result.urls.length > 0 && !result.isTooLong && !result.isTooMany && result.invalidLines.length === 0;
  const handleSubmit = async () => {
    try {
      await onSubmit(result.urls, target, asrEngine);
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
      size="wide"
      title="批量添加"
      onClose={onClose}
    >
      <label className="block text-sm font-semibold text-[var(--ink)]" htmlFor="batch-input">
        视频链接
      </label>
      <textarea
        className="mt-2 min-h-52 w-full resize-y border-2 border-[var(--line-ink)] bg-[var(--paper)] p-3 text-sm leading-6 outline-none focus:border-[var(--accent)]"
        data-dialog-initial-focus
        id="batch-input"
        placeholder="每行一条，或直接粘贴多行分享文案"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
        <span>有效 {result.urls.length} 条</span>
        {result.duplicateCount ? <span>重复 {result.duplicateCount} 条（已折叠）</span> : null}
        {result.invalidLines.length ? <span className="text-[var(--accent-deep)]">无法识别 {result.invalidLines.length} 行，请移除后提交</span> : null}
        {result.isTooMany ? <span className="text-[var(--accent-deep)]">超过 49 条上限</span> : null}
        {result.isTooLong ? <span className="text-[var(--accent-deep)]">输入内容过长</span> : null}
      </div>
      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-[var(--ink)]">处理目标</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className={`cursor-pointer border-2 p-3 ${target === "analyze" ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line-ink)]"}`}>
            <input checked={target === "analyze"} className="mr-2" name="batch-target" type="radio" onChange={() => setTarget("analyze")} />
            <span className="font-semibold">提取并分析</span>
            <span className="mt-1 block text-xs text-[var(--muted)]">补齐逐字稿并生成总结；已有结果会复用。</span>
          </label>
          <label className={`cursor-pointer border-2 p-3 ${target === "parse_only" ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line-ink)]"}`}>
            <input checked={target === "parse_only"} className="mr-2" name="batch-target" type="radio" onChange={() => setTarget("parse_only")} />
            <span className="font-semibold">仅提取</span>
            <span className="mt-1 block text-xs text-[var(--muted)]">只保存平台已有的元数据和内容文本。</span>
          </label>
        </div>
      </fieldset>
      {target === "analyze" ? (
        <label className="mt-5 block text-sm font-semibold text-[var(--ink)]">
          缺少逐字稿时使用
          <select
            className="mt-2 block h-10 w-full border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] px-3 text-sm font-normal"
            value={asrEngine}
            onChange={(event) => setAsrEngine(event.target.value as AsrEngine)}
          >
            <option value="local_whisper">本地 Whisper</option>
            <option disabled={!sensevoiceAvailable} value="sensevoice_small">SenseVoiceSmall{sensevoiceAvailable ? "" : "（当前不可用）"}</option>
          </select>
        </label>
      ) : null}
      {errorMessage ? <p className="mt-4 border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">{errorMessage}</p> : null}
    </ModalDialog>
  );
}
