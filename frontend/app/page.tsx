"use client";

import { Header } from "@/components/Header";
import { ConfirmDialog } from "@/components/ModalDialog";
import { TranscribeSettingsDialog } from "@/components/TranscribeSettingsDialog";
import { TranscribeTaskToasts } from "@/components/TranscribeTaskToasts";
import { BatchAddDialog } from "@/components/BatchAddDialog";
import { BatchWorkspace } from "@/components/BatchWorkspace";
import {
  HomeWorkspace,
  WorkbenchWorkspace
} from "@/components/WorkspaceViews";
import { useWorkbenchController } from "@/hooks/use-workbench-controller";

export default function HomePage() {
  const {
    activeDetail,
    activeTaskCount,
    batchDialogProps,
    confirmDialogProps,
    homeWorkspaceProps,
    isHomeWorkspaceReady,
    isTaskWorkspaceOpen,
    onHomeClick,
    onTasksClick,
    taskWorkspaceProps,
    transcribeSettingsDialogProps,
    transcribeTaskToastsProps,
    workbenchWorkspaceProps
  } = useWorkbenchController();

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <Header activeTaskCount={activeTaskCount} onHomeClick={onHomeClick} onTasksClick={onTasksClick} />
      {isTaskWorkspaceOpen && taskWorkspaceProps ? (
        <BatchWorkspace {...taskWorkspaceProps} />
      ) : activeDetail && workbenchWorkspaceProps ? (
        <WorkbenchWorkspace {...workbenchWorkspaceProps} />
      ) : isHomeWorkspaceReady ? (
        <HomeWorkspace {...homeWorkspaceProps} />
      ) : (
        <section
          aria-label="正在准备首页内容"
          className="min-h-[calc(100vh-96px)] bg-[var(--paper)]"
        />
      )}
      <ConfirmDialog {...confirmDialogProps} />
      <BatchAddDialog {...batchDialogProps} />
      <TranscribeSettingsDialog {...transcribeSettingsDialogProps} />
      <TranscribeTaskToasts {...transcribeTaskToastsProps} />
    </main>
  );
}
