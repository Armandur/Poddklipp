export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export const JINGLE_KIND_LABELS: Record<string, string> = {
  intro: "Intro",
  outro: "Outro",
  chapter: "Kapitel-stinger",
  ad_marker: "Reklam-jingel",
  custom: "Egen",
};

export const SEGMENT_KIND_LABELS: Record<string, string> = {
  pre: "Pre-roll",
  intro: "Introduktion",
  chapter: "Kapitel",
  ad: "Reklam",
  content: "Innehåll",
  outro: "Outro",
  post: "Post-roll",
};

export const SEGMENT_KIND_COLORS: Record<string, string> = {
  pre: "#7a7a88",
  intro: "#6bd186",
  chapter: "#6b9bd1",
  ad: "#d16b6b",
  content: "#9a9aa8",
  outro: "#d16bb5",
  post: "#7a7a88",
};
