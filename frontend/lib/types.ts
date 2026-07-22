export interface HealthResponse {
  status: "ok";
  mode: string;
  version: string;
}

export interface RateLimitItem {
  action: "parse" | "summarize" | "qa" | "transcribe" | string;
  limit: number;
  used: number;
  remaining: number;
  reset_at: string;
}

export interface RateLimitStatusResponse {
  success: true;
  items: RateLimitItem[];
}

export interface ApiError {
  success: false;
  error_code: string;
  message: string;
}

export interface VideoFormat {
  format_id: string;
  ext: string;
  resolution: string;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  label: string;
}

export interface FormatDiagnostics {
  raw_format_count: number;
  max_height?: number | null;
  has_cookie_config: boolean;
  is_bilibili: boolean;
}

export interface VideoInfo {
  video_id: string;
  platform: string;
  url: string;
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  has_transcript: boolean;
  media_type?: string | null;
  text_source_type?: string | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

export interface TranscribeSpeakerProfile {
  name?: string | null;
  role?: string | null;
  description?: string | null;
}

export interface TranscribeContextSettings {
  program_structure: "auto" | "solo" | "interview" | "roundtable" | string;
  content_tags: string[];
  speakers: TranscribeSpeakerProfile[];
}

export interface TranscriptAsrMeta {
  engine: string;
  model: string;
  device: string;
  compute_type: string;
  language?: string | null;
  correction_status: "corrected" | "skipped" | "failed" | string;
  correction_model?: string | null;
  glossary_term_count: number;
  program_structure?: string | null;
  content_tags?: string[];
  speaker_profiles?: TranscribeSpeakerProfile[];
  speaker_label_status?: "disabled" | "inferred" | "partial" | "failed" | string | null;
}

export interface TranscriptPayload {
  segments: TranscriptSegment[];
  plain_text: string;
  raw_segments?: TranscriptSegment[] | null;
  raw_plain_text?: string | null;
  asr_meta?: TranscriptAsrMeta | null;
}

export interface TimelineItem {
  time: string;
  content: string;
}

export interface SummaryHighlight {
  id: string;
  text: string;
  start?: number | null;
  end?: number | null;
  reason?: string | null;
  tags: string[];
  source: string;
  source_type?: string | null;
  created_at?: string | null;
}

export interface NoteDraft {
  highlights: SummaryHighlight[];
  updated_at?: string | null;
}

export interface VideoSummary {
  draft_version?: string;
  content_type?: string | null;
  topics?: string[];
  tldr: string;
  key_points: string[];
  timeline: TimelineItem[];
  structured_analysis_markdown: string;
  takeaways: string[];
  highlights?: SummaryHighlight[];
  content_keywords?: string[];
  application_clues?: string[];
  content_boundaries?: string[];
  // 旧个性化草稿字段仅用于兼容历史记录，新版通用总结不再生成。
  reason_for_saving?: string | null;
  personal_relevance?: string[];
  transformation_ideas?: string[];
  search_keywords?: string[];
  related_wikilinks?: string[];
  to_confirm?: string[];
}

export type SummaryDisplayState = "empty" | "demo" | "generated";

export interface MindmapMeta {
  layout: "tree" | string;
  content_category: string;
  template_id: string;
  media_type?: string | null;
  text_source_type?: string | null;
}

export interface DemoItem {
  demo_id: string;
  title: string;
  description: string;
  thumbnail: string;
}

export interface DemoListResponse {
  success: true;
  demos: DemoItem[];
}

export interface LibraryItem {
  video_id: string;
  source_url: string;
  title: string;
  author: string;
  platform: string;
  thumbnail: string;
  duration: number;
  has_transcript: boolean;
  summary_status: "none" | "local_fallback" | "ai_generated" | string;
  summary_model: string | null;
  media_type?: string | null;
  text_source_type?: string | null;
  updated_at: string;
}

export interface LibraryListResponse {
  success: true;
  items: LibraryItem[];
}

export interface LibraryStatsResponse {
  success: true;
  total_items: number;
  with_transcript_count: number;
  no_transcript_count: number;
  summarized_count: number;
  ai_summary_count: number;
  fallback_summary_count: number;
}

export interface LibraryDeleteResponse {
  success: true;
  deleted_video_id: string;
}

export interface LibraryClearResponse {
  success: true;
  deleted_count: number;
}

export interface DemoDetail {
  success: true;
  video: VideoInfo;
  formats: VideoFormat[];
  format_diagnostics?: FormatDiagnostics | null;
  transcript: TranscriptPayload;
  summary: VideoSummary;
  mindmap_markdown: string;
  mindmap_meta?: MindmapMeta | null;
  note_draft?: NoteDraft | null;
  transcription_source_url?: string | null;
}

export interface ParseResponse extends DemoDetail {
  source_url: string;
  is_placeholder: boolean;
  is_from_cache?: boolean;
  library_summary_status?: string | null;
  library_summary_model?: string | null;
}

export interface SummarizeRequest {
  transcript_plain_text: string;
  transcript_segments?: TranscriptSegment[];
  source_url?: string;
  video_title?: string;
  video_author?: string;
  media_type?: string;
  text_source_type?: string;
}

export interface SummarizeResponse {
  success: true;
  summary: VideoSummary;
  mindmap_markdown: string;
  mindmap_meta?: MindmapMeta | null;
  is_ai_generated: boolean;
  model: string;
  fallback_reason?: string | null;
  is_cached?: boolean;
}

export type QaMode = "fast" | "thinking";

export interface QaRequest {
  question: string;
  transcript_plain_text: string;
  source_url?: string;
  video_title?: string;
  video_author?: string;
  media_type?: string | null;
  text_source_type?: string | null;
  mode?: QaMode;
  summary_tldr?: string;
  timeline?: TimelineItem[];
}

export interface QaReference {
  time: string | null;
  text: string;
}

export interface QaResponse {
  success: true;
  answer: string;
  references: QaReference[];
  is_ai_generated: boolean;
  model: string;
}

export interface TranscribeRequest {
  url: string;
  video_id?: string | null;
  context_settings?: TranscribeContextSettings | null;
}

export interface TranscribeResponse {
  success: true;
  source_url: string;
  video_id?: string | null;
  transcript: TranscriptPayload;
  message: string;
}

export type TranscribeTaskStatus = "running" | "success" | "error";

export interface ParseTask {
  id: string;
  kind: "parse";
  sourceUrl: string;
  title: string;
  status: TranscribeTaskStatus;
  startedAt: number;
  finishedAt?: number;
  message?: string;
  errorMessage?: string;
}

export interface TranscribeTask {
  id: string;
  sourceUrl: string;
  videoId: string;
  title: string;
  status: TranscribeTaskStatus;
  startedAt: number;
  finishedAt?: number;
  message?: string;
  errorMessage?: string;
}

export interface SummaryTask {
  id: string;
  kind: "summary";
  sourceUrl: string;
  videoId: string;
  title: string;
  status: TranscribeTaskStatus;
  startedAt: number;
  finishedAt?: number;
  message?: string;
  errorMessage?: string;
}

export interface DownloadResponse {
  success: true;
  filename: string;
  file_path: string;
  format_selector: string;
  message: string;
}

export interface NoteDraftUpdateRequest {
  source_url: string;
  highlights: SummaryHighlight[];
}

export interface NoteDraftUpdateResponse {
  success: true;
  note_draft: NoteDraft;
}

export interface ObsidianNoteExportRequest {
  source_url: string;
  include_full_text?: boolean;
}

export interface ObsidianNoteExportResponse {
  success: true;
  filename: string;
  written_to_vault: boolean;
  file_path?: string | null;
  markdown: string;
  message: string;
}

export interface SummaryGenerationMeta {
  isAiGenerated: boolean;
  model: string;
}

export type LibraryFilter = "all" | "ready" | "summarized" | "noTranscript";

export type AppStatus = "idle" | "loading" | "parsed" | "error";
