// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Saved settings: a person's preferences for how figures look and are laid out, by name, kept in the browser
 * and exported to or imported from a small JSON file. They hold no structure: not the cells shown, the bond or
 * angle rules, the distortion modes or the view of a particular file.
 */

/** Version of the settings file format; a file of a later version is refused rather than half read. */
export const SETTINGS_VERSION = 1;

export interface SavedSettings {
  readonly name: string;
  /** Setting name -> value, as the page's own state holds it. */
  readonly values: Readonly<Record<string, unknown>>;
}

/** One setting of the page: its current value, how to set it, and which values it accepts. */
export interface SettingField {
  readonly value: unknown;
  readonly set: (value: never) => void;
  readonly valid: (value: unknown) => boolean;
}

export const isBool = (v: unknown): boolean => typeof v === "boolean";
export const isText = (v: unknown): boolean => typeof v === "string" && v.length <= 200;
export const isNumber = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
export const oneOf = (...allowed: readonly unknown[]) => (v: unknown): boolean => allowed.includes(v);
export const isColour = (v: unknown): boolean => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
export const textsOf = (n: number) => (v: unknown): boolean => Array.isArray(v) && v.length === n && v.every(isText);
export const coloursOf = (n: number) => (v: unknown): boolean => Array.isArray(v) && v.length === n && v.every(isColour);
export const textRecord = (keys: readonly string[]) => (v: unknown): boolean =>
  typeof v === "object" && v !== null && !Array.isArray(v) && keys.every((k) => isText((v as Record<string, unknown>)[k]));

/** The current values of the fields, ready to save. */
export function collect(fields: Readonly<Record<string, SettingField>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value]));
}

/**
 * Set every field the saved values name and accept. Returns the names that were left out: unknown to this
 * version of the page, or with a value it does not accept. Nothing else changes.
 */
export function apply(fields: Readonly<Record<string, SettingField>>, values: Readonly<Record<string, unknown>>): string[] {
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const field = fields[key];
    if (field && field.valid(value)) (field.set as (v: unknown) => void)(value);
    else skipped.push(key);
  }
  return skipped;
}

/** The settings as the text of a file. */
export function settingsFileText(s: SavedSettings): string {
  return `${JSON.stringify({ motif: "settings", version: SETTINGS_VERSION, name: s.name, values: s.values }, null, 1)}\n`;
}

/** Settings from the text of a file. Throws a plain-language Error when it is not a MOTIF settings file. */
export function readSettingsFile(text: string): SavedSettings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This is not a MOTIF settings file (it is not JSON).");
  }
  const d = data as { motif?: unknown; version?: unknown; name?: unknown; values?: unknown };
  if (typeof data !== "object" || data === null || d.motif !== "settings") throw new Error("This is not a MOTIF settings file.");
  if (typeof d.version !== "number" || d.version > SETTINGS_VERSION) {
    throw new Error(`These settings were written by a newer MOTIF (format ${String(d.version)}); this page reads format ${SETTINGS_VERSION}.`);
  }
  if (typeof d.values !== "object" || d.values === null || Array.isArray(d.values)) throw new Error("The settings file holds no settings.");
  const name = typeof d.name === "string" && d.name.trim() !== "" ? d.name.trim().slice(0, 60) : "Imported";
  return { name, values: d.values as Record<string, unknown> };
}

const LIST_KEY = "motif.settings";
const DEFAULT_KEY = "motif.settings.default";

/** The settings kept in this browser (empty when there are none or the browser keeps nothing). */
export function storedSettings(): SavedSettings[] {
  try {
    const list = JSON.parse(localStorage.getItem(LIST_KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((s): s is SavedSettings => typeof s?.name === "string" && typeof s?.values === "object" && s.values !== null) : [];
  } catch {
    return [];
  }
}

/** Keep the list in this browser; false when the browser refuses (private window, storage full). */
export function storeSettings(list: readonly SavedSettings[]): boolean {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** The name of the settings the page opens with, or "" for none. */
export function defaultSettingsName(): string {
  try {
    return localStorage.getItem(DEFAULT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setDefaultSettingsName(name: string): void {
  try {
    if (name) localStorage.setItem(DEFAULT_KEY, name);
    else localStorage.removeItem(DEFAULT_KEY);
  } catch {
    // The choice holds for this visit only.
  }
}
