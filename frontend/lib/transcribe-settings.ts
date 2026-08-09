import type {
  TranscribeContextSettings,
  TranscribeSpeakerProfile,
  VideoInfo
} from "./types";

export const PROGRAM_STRUCTURE_OPTIONS: Array<{
  value: "auto" | "solo" | "interview" | "roundtable";
  label: string;
}> = [
  { value: "auto", label: "自动判断" },
  { value: "solo", label: "单人口播" },
  { value: "interview", label: "双人访谈" },
  { value: "roundtable", label: "多人聊天 / 圆桌" }
];

export const CONTENT_TAG_OPTIONS: Array<{
  value: string;
  label: string;
}> = [
  { value: "ai_tech", label: "AI / 科技" },
  { value: "product_business", label: "产品 / 商业" },
  { value: "tutorial_method", label: "教程 / 方法" },
  { value: "opinion_observation", label: "观点 / 现象" },
  { value: "case_review", label: "案例 / 复盘" },
  { value: "career_startup", label: "职场 / 创业" },
  { value: "psychology_growth", label: "心理 / 成长" },
  { value: "life_story", label: "生活 / 故事" },
  { value: "casual_chat", label: "闲聊 / 泛谈" }
];

const MAX_SPEAKER_COUNT = 6;

export function getDefaultTranscribeSettings(
  video: Pick<VideoInfo, "platform" | "media_type"> | null | undefined
): TranscribeContextSettings {
  const platform = video?.platform?.trim().toLowerCase() ?? "";
  const mediaType = video?.media_type?.trim().toLowerCase() ?? "";
  const platformProgramStructure =
    platform === "douyin" || platform === "抖音" ? "solo" : "auto";
  const programStructure =
    mediaType === "podcast" ? "auto" : platformProgramStructure;

  return {
    program_structure: programStructure,
    content_tags: [],
    speakers: buildDefaultSpeakers(programStructure),
    correction_terms: []
  };
}

export function normalizeTranscribeSettings(
  settings: Partial<TranscribeContextSettings> | null | undefined,
  fallback?: TranscribeContextSettings
): TranscribeContextSettings {
  const fallbackSettings = fallback ?? getDefaultTranscribeSettings(null);
  const programStructure =
    settings?.program_structure || fallbackSettings.program_structure || "auto";
  const contentTags = Array.isArray(settings?.content_tags)
    ? settings.content_tags
    : fallbackSettings.content_tags;
  const speakers = Array.isArray(settings?.speakers)
    ? settings.speakers
    : fallbackSettings.speakers;
  const correctionTerms = Array.isArray(settings?.correction_terms)
    ? settings.correction_terms
    : fallbackSettings.correction_terms;

  return {
    program_structure: programStructure,
    content_tags: contentTags,
    speakers,
    correction_terms: correctionTerms
  };
}

export function buildDefaultSpeakers(
  programStructure: string
): TranscribeSpeakerProfile[] {
  if (programStructure === "solo") {
    return [{ name: "讲者", role: "讲者", description: "" }];
  }
  if (programStructure === "interview") {
    return [
      { name: "主持人", role: "主持人", description: "主要负责提问和串场" },
      { name: "嘉宾", role: "嘉宾", description: "主要回答观点和经验" }
    ];
  }
  if (programStructure === "roundtable") {
    return [
      { name: "主持人", role: "主持人", description: "负责串场和追问" },
      { name: "嘉宾 A", role: "嘉宾", description: "" },
      { name: "嘉宾 B", role: "嘉宾", description: "" }
    ];
  }

  return [];
}

export function updateSpeakersForProgramStructure(
  currentProgramStructure: string,
  currentSpeakers: TranscribeSpeakerProfile[],
  nextProgramStructure: string
): TranscribeSpeakerProfile[] {
  const currentDefaults = buildDefaultSpeakers(currentProgramStructure);
  const nextDefaults = buildDefaultSpeakers(nextProgramStructure);
  const isStillUsingDefaults =
    currentSpeakers.length === currentDefaults.length &&
    currentSpeakers.every((speaker, index) =>
      areSpeakerProfilesEqual(speaker, currentDefaults[index])
    );

  if (isStillUsingDefaults) {
    return nextDefaults;
  }

  // 已经填写的姓名和身份属于用户输入，节目结构切换不能静默覆盖它们。
  const preservedSpeakers = currentSpeakers.map((speaker) => ({ ...speaker }));
  if (preservedSpeakers.length >= nextDefaults.length) {
    return preservedSpeakers;
  }

  return [
    ...preservedSpeakers,
    ...nextDefaults.slice(preservedSpeakers.length)
  ];
}

function areSpeakerProfilesEqual(
  left: TranscribeSpeakerProfile | undefined,
  right: TranscribeSpeakerProfile | undefined
): boolean {
  return (
    (left?.name ?? "") === (right?.name ?? "") &&
    (left?.role ?? "") === (right?.role ?? "") &&
    (left?.description ?? "") === (right?.description ?? "")
  );
}

export function addEmptySpeaker(
  speakers: TranscribeSpeakerProfile[]
): TranscribeSpeakerProfile[] {
  if (speakers.length >= MAX_SPEAKER_COUNT) {
    return speakers;
  }

  return [...speakers, { name: "", role: "", description: "" }];
}

export function getMaxSpeakerCount(): number {
  return MAX_SPEAKER_COUNT;
}
