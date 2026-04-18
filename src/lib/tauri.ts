// Tunt wrapper runt Tauri invoke — typade wrappers för våra commands.
import { invoke } from "@tauri-apps/api/core";

export interface Jingle {
  id: number;
  name: string;
  kind: "intro" | "outro" | "chapter" | "ad_marker" | "custom";
  file_path: string;
  duration_ms: number;
  sample_rate: number;
  created_at: string;
}

export interface AddJingleInput {
  source_path: string;
  name: string;
  kind: Jingle["kind"];
}

export async function addJingle(input: AddJingleInput): Promise<Jingle> {
  return invoke<Jingle>("add_jingle", { input });
}

export async function listJingles(): Promise<Jingle[]> {
  return invoke<Jingle[]>("list_jingles");
}

export async function deleteJingle(id: number): Promise<void> {
  return invoke("delete_jingle", { id });
}

export async function getJinglePath(id: number): Promise<string> {
  return invoke<string>("get_jingle_path", { id });
}

export async function createJingleFromClip(
  episodeId: number,
  startMs: number,
  endMs: number,
  name: string,
  kind: Jingle["kind"],
): Promise<Jingle> {
  return invoke<Jingle>("create_jingle_from_clip", { episodeId, startMs, endMs, name, kind });
}

// ── Episodes ────────────────────────────────────────────────────────────────

export interface Episode {
  id: number;
  source_path: string;
  display_name: string;
  duration_ms: number;
  sample_rate: number;
  waveform_peaks_path: string | null;
  analyzed_at: string | null;
  created_at: string;
  file_missing: boolean;
}

export interface AddEpisodeInput {
  source_path: string;
  display_name?: string;
}

export async function addEpisode(input: AddEpisodeInput): Promise<Episode> {
  return invoke<Episode>("add_episode", { input });
}

export async function scanFolder(folderPath: string): Promise<string[]> {
  return invoke<string[]>("scan_folder", { folderPath });
}

export async function listEpisodes(): Promise<Episode[]> {
  return invoke<Episode[]>("list_episodes");
}

export async function deleteEpisode(id: number): Promise<void> {
  return invoke("delete_episode", { id });
}

export async function relinkEpisode(id: number, newPath: string): Promise<Episode> {
  return invoke<Episode>("relink_episode", { id, newPath });
}

// ── Analysis ────────────────────────────────────────────────────────────────

export interface Detection {
  id: number;
  episode_id: number;
  jingle_id: number;
  jingle_kind: "intro" | "outro" | "chapter" | "ad_marker" | "custom";
  jingle_name: string;
  offset_ms: number;
  confidence: number;
}

export interface AnalysisResult {
  detections: Detection[];
  waveform_peaks_path: string;
  analyzed_at: string;
}

// Beräknar bara vågform (utan analys). Resultatet kommer via `waveform-ready`-event.
export async function computeWaveform(episodeId: number): Promise<void> {
  return invoke("compute_waveform", { episodeId });
}

// Startar analys i bakgrunden. Resultatet kommer via `analysis-complete`-event.
// Preflight-fel (inga jinglar, okänt avsnitt) kastas direkt.
export async function analyzeEpisode(
  episodeId: number,
  threshold?: number,
): Promise<void> {
  return invoke("analyze_episode", { episodeId, threshold });
}

export async function listDetections(episodeId: number): Promise<Detection[]> {
  return invoke<Detection[]>("list_detections", { episodeId });
}

export interface WaveformPeaks {
  mins: number[];
  maxs: number[];
  duration_ms: number;
}

export async function getWaveformPeaks(episodeId: number): Promise<WaveformPeaks> {
  return invoke<WaveformPeaks>("get_waveform_peaks", { episodeId });
}

export async function getWaveformPeaksHi(episodeId: number): Promise<WaveformPeaks> {
  return invoke<WaveformPeaks>("get_waveform_peaks_hi", { episodeId });
}

// ── Segments ────────────────────────────────────────────────────────────────

export type SegmentKind =
  | "pre"
  | "intro"
  | "chapter"
  | "ad"
  | "content"
  | "outro"
  | "post";

export interface Segment {
  id: number;
  episode_id: number;
  start_ms: number;
  end_ms: number;
  label: string | null;
  kind: SegmentKind;
  excluded: boolean;
  sort_order: number;
}

export async function generateSegments(episodeId: number): Promise<Segment[]> {
  return invoke<Segment[]>("generate_segments", { episodeId });
}

export async function listSegments(episodeId: number): Promise<Segment[]> {
  return invoke<Segment[]>("list_segments", { episodeId });
}

export interface UpdateSegmentInput {
  id: number;
  start_ms?: number;
  end_ms?: number;
  label?: string;
  kind?: SegmentKind;
  excluded?: boolean;
}

export async function updateSegment(input: UpdateSegmentInput): Promise<Segment> {
  const { id, ...rest } = input;
  return invoke<Segment>("update_segment", { id, ...rest });
}

export async function splitSegmentAt(episodeId: number, atMs: number): Promise<Segment[]> {
  return invoke<Segment[]>("split_segment_at", { episodeId, atMs });
}

export async function deleteSegment(id: number): Promise<void> {
  return invoke("delete_segment", { id });
}

// ── Segment kind settings ────────────────────────────────────────────────────

export interface SegmentKindSetting {
  slug: SegmentKind;
  label: string;
  default_excluded: boolean;
  sort_order: number;
}

export async function listSegmentKinds(): Promise<SegmentKindSetting[]> {
  return invoke<SegmentKindSetting[]>("list_segment_kinds");
}

export async function updateSegmentKind(
  slug: SegmentKind,
  label: string,
  defaultExcluded: boolean,
): Promise<SegmentKindSetting> {
  return invoke<SegmentKindSetting>("update_segment_kind", {
    slug,
    label,
    defaultExcluded,
  });
}

// ── App config ───────────────────────────────────────────────────────────────

export interface AppConfig {
  analysis_threshold: number;
  export_default_format: string;
  export_default_folder: string | null;
  export_loudness_normalize: boolean;
  confirm_delete_segment: boolean;
  shortcuts: Record<string, string>;
}

export async function getAppConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_app_config");
}

export async function setAppConfig(config: AppConfig): Promise<void> {
  return invoke("set_app_config", { newConfig: config });
}

// ── Storage settings ─────────────────────────────────────────────────────────

export async function getDataDir(): Promise<string> {
  return invoke<string>("get_data_dir");
}

export async function setDataDir(newPath: string, copyFiles: boolean): Promise<void> {
  return invoke("set_data_dir", { newPath, copyFiles });
}

// ── Export ───────────────────────────────────────────────────────────────────

export type ExportFormat = "clean_mp3" | "chapters" | "m4b_chapters" | "json";

export async function exportEpisode(
  episodeId: number,
  format: ExportFormat,
  outputPath: string,
): Promise<void> {
  return invoke("export_episode", { episodeId, format, outputPath });
}
