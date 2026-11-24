// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Every setting the assistant may change, with where it lives on the page and what it takes. The names are those
 * of the page's saved settings (App.tsx), so the assistant changes exactly what a person changes by hand, through
 * the same checks. `place` is what the assistant tells the user ("Visual › Bonds"), so they learn where the knob is.
 * A test holds this list to the page's own (every setting described, none invented).
 */

export interface Knob {
  readonly name: string;
  /** Tab › section on the page; "Top bar" for the bar above the figure. */
  readonly place: string;
  /** What it does, in a few plain words. */
  readonly says: string;
  /** The values it takes, as the assistant must write them. */
  readonly values: string;
}

const MATERIALS = '"soft", "flat", "glossy", "metal" or "glass"';
const BOOL = "true or false";
const COLOUR = 'a colour "#rrggbb"';

export const KNOBS: readonly Knob[] = [
  { name: "atomMaterial", place: "Visual › Shading and outlines", says: "surface of the atoms", values: MATERIALS },
  { name: "bondMaterial", place: "Visual › Shading and outlines", says: "surface of the bonds", values: MATERIALS },
  { name: "arrowMaterial", place: "Visual › Shading and outlines", says: "surface of the moment, displacement and axis arrows", values: MATERIALS },
  { name: "glassOpacity", place: "Visual › Shading and outlines", says: "how solid glass surfaces are", values: "a number from 0.05 (clear) to 1 (solid)" },
  { name: "bondOutline", place: "Visual › Shading and outlines", says: "thin darker outline on the bonds", values: BOOL },
  { name: "momentOutline", place: "Visual › Moment arrows", says: "thin darker outline on the moment arrows", values: BOOL },
  { name: "axesOutline", place: "Visual › Shading and outlines", says: "thin darker outline on the a, b, c axis arrows", values: BOOL },
  { name: "showVacancy", place: "Visual › Atoms", says: "show a vacant share of a site as an empty wedge", values: BOOL },
  { name: "momentColour", place: "Visual › Moment arrows", says: "colour of the magnetic moment arrows", values: COLOUR },
  { name: "momentLength", place: "Visual › Moment arrows", says: "length of the largest moment arrow, in angstrom", values: 'a number as text, e.g. "3"' },
  { name: "momentTail", place: "Visual › Moment arrows", says: "share of the arrow on the tail side of the atom, in percent (100 = centred)", values: 'a number as text, e.g. "80"' },
  { name: "momentThickness", place: "Visual › Moment arrows", says: "thickness of the moment arrows' rods, in angstrom", values: 'a number as text, e.g. "0.16"' },
  { name: "arrowHead", place: "Visual › Moment arrows", says: "size of the arrow heads, as a multiple of the usual", values: 'a number as text, e.g. "1.2"' },
  { name: "displacementLength", place: "Visual › Displacement arrows", says: "length of the largest displacement arrow, in angstrom", values: 'a number as text, e.g. "1.5"' },
  { name: "displacementColour", place: "Visual › Displacement arrows", says: "colour of the displacement arrows", values: COLOUR },
  { name: "displacementThickness", place: "Visual › Displacement arrows", says: "thickness of the displacement arrows, in angstrom", values: 'a number as text' },
  { name: "showCell", place: "Visual › Unit cell", says: "draw the unit cell outline", values: BOOL },
  { name: "cellStyle", place: "Visual › Unit cell", says: "how the cell edges are drawn", values: '"depth" (near solid, far dashed), "dashed" or "solid"' },
  { name: "cellWidth", place: "Visual › Unit cell", says: "width of the cell lines, in px", values: 'a number as text, e.g. "3"' },
  { name: "showLegend", place: "Visual › Legend", says: "draw the legend (a sphere and name per element)", values: BOOL },
  { name: "legendFollows", place: "Visual › Legend", says: "legend spheres as large as the atoms drawn", values: BOOL },
  { name: "legendSize", place: "Visual › Legend", says: "size of the whole legend drawing, as a multiple of the usual (not the text size in pt: that is textSizes)", values: 'a number as text, e.g. "0.8"' },
  { name: "showAxes", place: "Visual › Axes", says: "draw the a, b, c axis arrows", values: BOOL },
  { name: "axesSize", place: "Visual › Axes", says: "size of the axis arrows drawing, as a multiple of the usual (not the text size in pt: that is textSizes)", values: 'a number as text' },
  { name: "axesHead", place: "Visual › Axes", says: "size of the axis arrows' cones, as a multiple of the usual", values: 'a number as text' },
  { name: "axesReadable", place: "Visual › Axes", says: "draw an axis pointing into the page long enough to read", values: BOOL },
  { name: "axesColoured", place: "Visual › Axes", says: "a, b, c arrows each in its own colour (else all grey)", values: BOOL },
  { name: "axesColours", place: "Visual › Axes", says: "the colours of the a, b and c arrows", values: 'a list of three colours ["#rrggbb", "#rrggbb", "#rrggbb"]' },
  { name: "fontFamily", place: "Visual › Lettering", says: "font of the legend, axis letters and angle labels", values: 'a font name, e.g. "Open Sans", "Helvetica Neue", "Arial"' },
  { name: "customFont", place: "Visual › Lettering", says: "the font is typed by name rather than chosen from the list", values: BOOL },
  { name: "letterWeight", place: "Visual › Lettering", says: "weight of the lettering", values: "400 (regular), 500 (medium) or 800 (heavy)" },
  { name: "textSizes", place: "Visual › Lettering", says: "text sizes (font size) in pt of the legend, axis letters and angle labels", values: '{"legend": "7", "axes": "7", "angle": "7"} (text; "" for automatic)' },
  { name: "canvasFixed", place: "Layout › Canvas", says: "the figure has a size on paper (else it fits the frame)", values: BOOL },
  { name: "canvasUnit", place: "Layout › Canvas", says: "unit of the size on paper", values: '"cm" or "in"' },
  { name: "canvasSize", place: "Layout › Canvas", says: "width and height on paper", values: '["8.9", "6.675"] (text, in canvasUnit)' },
  { name: "aspect", place: "Layout › Canvas", says: "shape of the figure, width : height", values: '"free", "1:1", "5:4", "4:3", "3:2", "A" (paper, √2:1), "16:10", "16:9" or "2:1"' },
  { name: "portrait", place: "Layout › Canvas", says: "turn the shape upright", values: BOOL },
  { name: "dpi", place: "Top bar", says: "resolution of the saved PNG", values: 'a number as text, e.g. "300"' },
  { name: "transparent", place: "Top bar", says: "saved figure without a background", values: BOOL },
  { name: "pngWidth", place: "Top bar", says: "width of the PNG in px, when the figure has no size on paper", values: "a number from 100 to 16000" },
  { name: "saveZoomed", place: "Layout › Scale", says: "the saved figure shows the zoom as on screen", values: BOOL },
  { name: "scaleMode", place: "Layout › Scale", says: "how the structure is scaled as it turns", values: '"outline" (fit each view), "steady" or "fixed"' },
  { name: "fixedScale", place: "Layout › Scale", says: "px per angstrom with the fixed scale", values: 'a number as text, e.g. "60"' },
  { name: "dragMode", place: "Layout › Dragging", says: "how a drag turns the structure", values: '"turntable" or "free"' },
  { name: "snap", place: "Layout › Dragging", says: "snap to a nearby crystal direction on release", values: BOOL },
  { name: "animate", place: "Layout › Dragging", says: "animate turns to a chosen view", values: BOOL },
  { name: "keepView", place: "Layout › Direction", says: "keep the view when another file is opened", values: BOOL },
  { name: "smooth", place: "Layout › Large structures", says: "simplified drawing while a large structure moves", values: BOOL },
  { name: "previewFrom", place: "Layout › Large structures", says: "from how many atoms and bonds the simplified drawing is used", values: 'a number as text' },
  { name: "showControls", place: "Under the figure", says: "the line of mouse and key controls under the figure", values: BOOL },
  { name: "repeatBoundary", place: "Structure › Cells shown", says: "draw an atom on the edge of the range at both ends", values: BOOL },
  { name: "autoBonds", place: "Structure › Bonds", says: "suggest bonds when a file is opened", values: BOOL },
];

/** Settings the page keeps that the assistant does not change (they belong to other tools or are lists of views). */
export const NOT_FOR_ASSISTANT: readonly string[] = ["elementLooks", "savedViews"];

export const knob = (name: string): Knob | undefined => KNOBS.find((k) => k.name === name);
