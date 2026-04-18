export interface ShortcutAction {
  id: string;
  label: string;
  defaultKey: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "play_pause",       label: "Spela/pausa",           defaultKey: " " },
  { id: "seek_back_5",      label: "Hoppa 5 sek bakåt",     defaultKey: "ArrowLeft" },
  { id: "seek_forward_5",   label: "Hoppa 5 sek framåt",    defaultKey: "ArrowRight" },
  { id: "seek_back_30",     label: "Hoppa 30 sek bakåt",    defaultKey: "Shift+ArrowLeft" },
  { id: "seek_forward_30",  label: "Hoppa 30 sek framåt",   defaultKey: "Shift+ArrowRight" },
  { id: "toggle_excluded",  label: "Toggla exkluderad",     defaultKey: "e" },
  { id: "rename_segment",   label: "Namnge segment",        defaultKey: "n" },
  { id: "mark_as_ad",       label: "Markera som reklam",    defaultKey: "a" },
  { id: "split_here",       label: "Dela segment här",      defaultKey: "s" },
];

export type ActionId =
  | "play_pause"
  | "seek_back_5"
  | "seek_forward_5"
  | "seek_back_30"
  | "seek_forward_30"
  | "toggle_excluded"
  | "rename_segment"
  | "mark_as_ad"
  | "split_here";

export type ResolvedShortcuts = Record<ActionId, string>;

export function resolveShortcuts(overrides: Record<string, string>): ResolvedShortcuts {
  const result = {} as ResolvedShortcuts;
  for (const action of SHORTCUT_ACTIONS) {
    result[action.id as ActionId] = overrides[action.id] ?? action.defaultKey;
  }
  return result;
}

export function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1];
  const needsShift = parts.includes("Shift");
  const needsCtrl = parts.includes("Ctrl");
  const needsAlt = parts.includes("Alt");
  return (
    e.key === key &&
    e.shiftKey === needsShift &&
    e.ctrlKey === needsCtrl &&
    e.altKey === needsAlt
  );
}

export function formatShortcutDisplay(shortcut: string): string {
  return shortcut === " " ? "Space" : shortcut;
}

export function eventToShortcutString(e: KeyboardEvent): string | null {
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key);
  return parts.join("+");
}
