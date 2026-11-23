// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { describe, expect, it } from "vitest";
import { apply, collect, coloursOf, isBool, isColour, oneOf, readSettingsFile, settingsFileText, SETTINGS_VERSION, type SettingField } from "../src/ui/settings";

/** Fields backed by a plain object, as the page's state would be. */
function fakeFields(state: Record<string, unknown>): Record<string, SettingField> {
  const make = (key: string, valid: (v: unknown) => boolean): SettingField => ({ value: state[key], set: ((v: unknown) => (state[key] = v)) as (v: never) => void, valid });
  return {
    atomMaterial: make("atomMaterial", oneOf("soft", "flat", "glass")),
    showLegend: make("showLegend", isBool),
    momentColour: make("momentColour", isColour),
    axesColours: make("axesColours", coloursOf(3)),
  };
}

describe("saved settings", () => {
  it("round trip: settings saved to a file and read back set every field to what it was", () => {
    const before = { atomMaterial: "glass", showLegend: false, momentColour: "#123abc", axesColours: ["#ff0000", "#00ff00", "#0000ff"] };
    const text = settingsFileText({ name: "Paper, single column", values: collect(fakeFields({ ...before })) });
    const read = readSettingsFile(text);
    expect(read.name).toBe("Paper, single column");
    const after: Record<string, unknown> = { atomMaterial: "soft", showLegend: true, momentColour: "#000000", axesColours: ["#111111", "#222222", "#333333"] };
    expect(apply(fakeFields(after), read.values)).toEqual([]);
    expect(after).toEqual(before);
  });

  it("a value the page does not accept, or a setting it does not know, is left out and named; the rest is applied", () => {
    const state: Record<string, unknown> = { atomMaterial: "soft", showLegend: true, momentColour: "#000000", axesColours: ["#111111", "#222222", "#333333"] };
    const skipped = apply(fakeFields(state), { atomMaterial: "plastic", showLegend: false, momentColour: "red", axesColours: ["#ff0000"], futureThing: 3 });
    expect(skipped.sort()).toEqual(["atomMaterial", "axesColours", "futureThing", "momentColour"]);
    expect(state).toEqual({ atomMaterial: "soft", showLegend: false, momentColour: "#000000", axesColours: ["#111111", "#222222", "#333333"] });
  });

  it("refuses what is not a MOTIF settings file, and a file of a newer format", () => {
    expect(() => readSettingsFile("not json")).toThrow(/not a MOTIF settings file/);
    expect(() => readSettingsFile(JSON.stringify({ hello: 1 }))).toThrow(/not a MOTIF settings file/);
    expect(() => readSettingsFile(JSON.stringify({ motif: "settings", version: SETTINGS_VERSION + 1, values: {} }))).toThrow(/newer MOTIF/);
    expect(() => readSettingsFile(JSON.stringify({ motif: "settings", version: 1 }))).toThrow(/holds no settings/);
    expect(readSettingsFile(JSON.stringify({ motif: "settings", version: 1, values: {} })).name).toBe("Imported");
  });
});
