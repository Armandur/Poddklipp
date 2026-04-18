import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { Region } from "wavesurfer.js/dist/plugins/regions.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.js";
import { Detection, Episode, Segment, getWaveformPeaks } from "../lib/tauri";
import {
  formatDuration,
  JINGLE_KIND_LABELS,
  SEGMENT_KIND_COLORS,
  SEGMENT_KIND_LABELS,
} from "../lib/format";

export interface TimelineApi {
  seekMs: (ms: number) => void;
  isPlaying: () => boolean;
  play: () => void;
}

interface TimelineProps {
  episode: Episode;
  detections: Detection[];
  segments: Segment[];
  activeSegmentId?: number | null;
  onSegmentBoundaryChange: (segmentId: number, startMs: number, endMs: number) => void;
  onReady?: (api: TimelineApi) => void;
  onTimeUpdate?: (ms: number) => void;
}

const KIND_COLORS: Record<string, string> = {
  intro: "#6bd186",
  outro: "#d16bb5",
  chapter: "#6b9bd1",
  ad_marker: "#d1b66b",
  custom: "#9a9aa8",
};

export default function Timeline({
  episode,
  detections,
  segments,
  activeSegmentId,
  onSegmentBoundaryChange,
  onReady,
  onTimeUpdate,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  // id → region-referens så vi kan uppdatera/ta bort utan att rita om allt.
  const segmentRegionsRef = useRef<Map<number, Region>>(new Map());
  const detectionRegionsRef = useRef<Region[]>([]);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Zoomnivå i px/sekund. `null` = fit-to-window (beräknas vid ready/resize).
  const [zoomPxPerSec, setZoomPxPerSec] = useState<number | null>(null);
  const durationSec = episode.duration_ms / 1000;

  const fitZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container || durationSec <= 0) return 1;
    const w = container.clientWidth;
    return Math.max(1, w / durationSec);
  }, [durationSec]);

  const applyZoom = useCallback(
    (pxPerSec: number) => {
      const ws = wavesurferRef.current;
      if (!ws) return;
      const fit = fitZoom();
      const clamped = Math.max(fit, Math.min(800, pxPerSec));
      ws.zoom(clamped);
      setZoomPxPerSec(clamped);
    },
    [fitZoom],
  );

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    async function setup() {
      if (!containerRef.current) return;

      try {
        const peaks = await getWaveformPeaks(episode.id);
        if (cancelled || !containerRef.current) return;

        wavesurferRef.current?.destroy();

        const regions = RegionsPlugin.create();
        regionsRef.current = regions;

        const ws = WaveSurfer.create({
          container: containerRef.current,
          waveColor: "#4a4a5a",
          progressColor: "#6b9bd1",
          cursorColor: "#e6e6ea",
          cursorWidth: 2,
          height: 96,
          barWidth: 1,
          barGap: 1,
          normalize: true,
          interact: true,
          url: convertFileSrc(episode.source_path),
          peaks: [peaks.maxs],
          duration: peaks.duration_ms / 1000,
          plugins: [regions, TimelinePlugin.create()],
        });
        wavesurferRef.current = ws;

        ws.on("ready", () => {
          if (cancelled) return;
          setReady(true);
          onReady?.({
            seekMs: (ms: number) => {
              const duration = ws.getDuration();
              if (duration > 0) {
                ws.seekTo(Math.max(0, Math.min(1, ms / 1000 / duration)));
              }
            },
            isPlaying: () => ws.isPlaying(),
            play: () => {
              ws.play();
            },
          });
        });
        ws.on("play", () => setPlaying(true));
        ws.on("pause", () => setPlaying(false));
        ws.on("finish", () => setPlaying(false));
        ws.on("timeupdate", (t) => {
          const ms = Math.floor(t * 1000);
          setCurrentMs(ms);
          onTimeUpdate?.(ms);
        });
        ws.on("error", (err) => {
          console.error("wavesurfer error", err);
          setError(String(err));
        });

        regions.on("region-updated", (region) => {
          const segmentId = segmentIdFromRegionId(region.id);
          if (segmentId == null) return;
          onSegmentBoundaryChange(
            segmentId,
            Math.round(region.start * 1000),
            Math.round(region.end * 1000),
          );
        });
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    setup();
    return () => {
      cancelled = true;
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
      regionsRef.current = null;
      segmentRegionsRef.current.clear();
      detectionRegionsRef.current = [];
    };
  }, [episode.id, episode.source_path, onSegmentBoundaryChange]);

  // Rita om alla regions när detektioner eller segment ändras.
  // Segment ligger som bakgrunds-band (draggable), detektioner som tunna markers ovanpå.
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !ready) return;

    regions.clearRegions();
    segmentRegionsRef.current.clear();
    detectionRegionsRef.current = [];

    for (const seg of segments) {
      const color = SEGMENT_KIND_COLORS[seg.kind] ?? "#9a9aa8";
      const isActive = seg.id === activeSegmentId;
      const alpha = seg.excluded ? 0.12 : isActive ? 0.55 : 0.28;
      const region = regions.addRegion({
        id: `seg-${seg.id}`,
        start: seg.start_ms / 1000,
        end: seg.end_ms / 1000,
        color: hexWithAlpha(color, alpha),
        drag: false,
        resize: true,
        content: makeRegionLabel(seg.label ?? SEGMENT_KIND_LABELS[seg.kind] ?? ""),
      });
      segmentRegionsRef.current.set(seg.id, region);
    }

    for (const det of detections) {
      const t = det.offset_ms / 1000;
      const region = regions.addRegion({
        start: t,
        end: t + 0.05,
        color: hexWithAlpha(KIND_COLORS[det.jingle_kind] ?? "#9a9aa8", 0.95),
        drag: false,
        resize: false,
        content: JINGLE_KIND_LABELS[det.jingle_kind] ?? det.jingle_kind,
      });
      detectionRegionsRef.current.push(region);
    }
  }, [detections, segments, activeSegmentId, ready]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ws = wavesurferRef.current;
      if (!ws || !ready) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        ws.playPause();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        ws.skip(e.shiftKey ? -30 : -5);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        ws.skip(e.shiftKey ? 30 : 5);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        applyZoom((zoomPxPerSec ?? fitZoom()) * 1.5);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        applyZoom((zoomPxPerSec ?? fitZoom()) / 1.5);
      } else if (e.key === "0") {
        e.preventDefault();
        applyZoom(fitZoom());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, applyZoom, fitZoom, zoomPxPerSec]);

  // Scroll-hantering på waveformen:
  //   Ctrl+scroll  → zoom centrerat på muspekaren
  //   Scroll       → panorera vänster/höger
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !ready) return;

    const el: HTMLElement = container;

    // WaveSurfer lägger sin scrollbara wrapper som första child i containern.
    // getWrapper() returnerar ett inner-element; scrollcontainern är dess parent.
    function getScrollEl(): HTMLElement {
      const ws = wavesurferRef.current;
      if (!ws) return el;
      const inner = ws.getWrapper();
      const parent = inner.parentElement;
      return (parent === el ? inner : parent ?? inner) as HTMLElement;
    }
    function onWheel(e: WheelEvent) {
      const ws = wavesurferRef.current;
      if (!ws) return;
      e.preventDefault();

      const scrollEl = getScrollEl();

      if (e.ctrlKey) {
        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const currentZoom = zoomPxPerSec ?? fitZoom();
        const scrollBefore = scrollEl.scrollLeft;
        // Tidpunkt (sekunder) under muspekaren innan zoom
        const timeAtMouse = (scrollBefore + mouseX) / currentZoom;

        const factor = e.deltaY < 0 ? 1.25 : 0.8;
        const fit = fitZoom();
        const newZoom = Math.max(fit, Math.min(800, currentZoom * factor));
        ws.zoom(newZoom);
        setZoomPxPerSec(newZoom);

        // WaveSurfer kör ett eget rAF internt som scrollar till playheaden.
        // Dubbelt rAF garanterar att vi kör efter det.
        const target = Math.max(0, timeAtMouse * newZoom - mouseX);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            getScrollEl().scrollLeft = target;
          });
        });
      } else {
        // Panorera: horisontell gest (deltaX) eller mushjul (deltaY)
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        scrollEl.scrollLeft += delta;
      }
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [ready, fitZoom, zoomPxPerSec]);

  // Sätt initial fit-zoom när wavesurfer blir ready eller avsnittet byts.
  useEffect(() => {
    if (!ready) return;
    applyZoom(fitZoom());
  }, [ready, applyZoom, fitZoom]);

  function togglePlay() {
    wavesurferRef.current?.playPause();
  }

  return (
    <div className="timeline">
      {error && <div className="error">Timeline-fel: {error}</div>}
      <div ref={containerRef} className="timeline-wave" />
      <div className="timeline-controls">
        <button onClick={togglePlay} disabled={!ready}>
          {playing ? "Paus" : "Spela"}
        </button>
        <span className="timeline-time">
          {formatDuration(currentMs)} / {formatDuration(episode.duration_ms)}
        </span>
        <div className="timeline-zoom">
          <button
            className="secondary"
            onClick={() => applyZoom(fitZoom())}
            disabled={!ready}
            title="Zooma ut till fullt avsnitt (0)"
          >
            Fit
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            disabled={!ready}
            value={zoomSliderValue(zoomPxPerSec, fitZoom())}
            onChange={(e) => {
              const pct = Number(e.target.value);
              const fit = fitZoom();
              // Logaritmisk skala mellan fit och 800 px/sek.
              const max = 800;
              const factor = Math.pow(max / fit, pct / 100);
              applyZoom(fit * factor);
            }}
            title="Zoom (ctrl+wheel eller +/- på tangentbordet)"
          />
        </div>
        {!ready && <span className="text-muted">Laddar ljud…</span>}
      </div>
    </div>
  );
}

function makeRegionLabel(text: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText =
    "overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100%;font-size:0.75rem;padding:2px 4px;pointer-events:none;";
  return el;
}

function segmentIdFromRegionId(id: string): number | null {
  const m = id.match(/^seg-(\d+)$/);
  return m ? Number(m[1]) : null;
}

function zoomSliderValue(current: number | null, fit: number): number {
  if (current == null || current <= fit) return 0;
  const max = 800;
  if (current >= max) return 100;
  return Math.round((Math.log(current / fit) / Math.log(max / fit)) * 100);
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
