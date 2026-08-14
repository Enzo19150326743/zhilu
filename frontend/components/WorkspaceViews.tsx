import type { ComponentProps } from "react";
import { AiTabs } from "./AiTabs";
import { FormatSelector } from "./FormatSelector";
import { LandingHero } from "./LandingHero";
import { RecentLibrary } from "./RecentLibrary";
import { UrlInput } from "./UrlInput";
import { VideoPreviewCard } from "./VideoPreviewCard";
import { isParseResponse } from "@/lib/workbench-detail";
import type { DemoDetail, ParseResponse } from "@/lib/types";

interface HomeWorkspaceProps {
  heroProps: ComponentProps<typeof LandingHero>;
  libraryProps: ComponentProps<typeof RecentLibrary>;
}

export function HomeWorkspace({
  heroProps,
  libraryProps
}: HomeWorkspaceProps) {
  return (
    <>
      <LandingHero {...heroProps} />
      <RecentLibrary {...libraryProps} />
    </>
  );
}

interface WorkbenchWorkspaceProps {
  aiTabsProps: ComponentProps<typeof AiTabs>;
  detail: DemoDetail | ParseResponse;
  urlInputProps: ComponentProps<typeof UrlInput>;
}

export function WorkbenchWorkspace({
  aiTabsProps,
  detail,
  urlInputProps
}: WorkbenchWorkspaceProps) {
  const isTranscriptWorkspace = aiTabsProps.activeTab === "transcript";

  return (
    <>
      <UrlInput {...urlInputProps} />
      <section
        className={`mx-auto grid min-w-0 max-w-[90rem] grid-cols-[minmax(0,1fr)] gap-8 px-4 pb-14 pt-6 sm:px-6 lg:px-10 ${
          isTranscriptWorkspace
            ? ""
            : "lg:grid-cols-[300px_minmax(0,1fr)]"
        }`}
      >
        <aside
          className={
            isTranscriptWorkspace
              ? "hidden"
              : "contents lg:sticky lg:top-[6.25rem] lg:block lg:self-start"
          }
        >
          <VideoPreviewCard video={detail.video} />
          {isParseResponse(detail) ? (
            <div className="order-3 lg:mt-5">
              <FormatSelector
                formatDiagnostics={detail.format_diagnostics ?? null}
                formats={detail.formats ?? []}
                isFromCache={Boolean(detail.is_from_cache)}
                sourceUrl={!detail.is_placeholder ? detail.source_url : null}
              />
            </div>
          ) : null}
        </aside>

        <div className="order-2 min-w-0 lg:order-none">
          <AiTabs {...aiTabsProps} />
        </div>
      </section>
    </>
  );
}
