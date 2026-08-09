"use client";

import { Header } from "@/components/Header";
import { ConfirmDialog } from "@/components/ModalDialog";
import { TranscribeSettingsDialog } from "@/components/TranscribeSettingsDialog";
import { TranscribeTaskToasts } from "@/components/TranscribeTaskToasts";
import {
  HomeWorkspace,
  WorkbenchWorkspace
} from "@/components/WorkspaceViews";
import { useWorkbenchController } from "@/hooks/use-workbench-controller";

export default function HomePage() {
  const {
    activeDetail,
    confirmDialogProps,
    homeWorkspaceProps,
    onHomeClick,
    transcribeSettingsDialogProps,
    transcribeTaskToastsProps,
    workbenchWorkspaceProps
  } = useWorkbenchController();

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <Header onHomeClick={onHomeClick} />
      {activeDetail && workbenchWorkspaceProps ? (
        <WorkbenchWorkspace {...workbenchWorkspaceProps} />
      ) : (
        <HomeWorkspace {...homeWorkspaceProps} />
      )}
      <ConfirmDialog {...confirmDialogProps} />
      <TranscribeSettingsDialog {...transcribeSettingsDialogProps} />
      <TranscribeTaskToasts {...transcribeTaskToastsProps} />
    </main>
  );
}
