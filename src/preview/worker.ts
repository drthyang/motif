// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The GPU preview, run in a worker so that drawing never holds up the page's handling of the pointer.
 * It owns an OffscreenCanvas laid over the figure and draws with WebGL 2: spheres as shaded discs with
 * their true depth (so atoms and bonds hide one another correctly without sorting), bonds and the other
 * lines as bars. See data.ts for what it is given and for the placement formula, repeated here.
 */
import { LINE_STRIDE, SPHERE_STRIDE, type PreviewFrame } from "./data";

type Message =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "scene"; spheres: Float32Array; lines: Float32Array; centre: [number, number, number]; reach: number }
  | { type: "frame"; frame: PreviewFrame; pixelWidth: number; pixelHeight: number; id: number };

// Shared by both programs: where a point of the structure goes on the canvas. The same lines as previewScreen in data.ts.
const PLACE = `
uniform mat3 uView;      // rows of the view matrix (sent transposed, as GLSL stores columns)
uniform vec3 uCentre;    // the point of the structure kept at the middle of the drawing, angstrom
uniform vec3 uFit;       // px per angstrom, then where the centre lands (canvas px)
uniform vec2 uSize;      // canvas width and height, px
uniform float uReach;    // half the depth range, angstrom
vec3 place(vec3 point) {
  vec3 p = uView * (point - uCentre);
  return vec3(uFit.y + p.x * uFit.x, uFit.z - p.y * uFit.x, p.z);
}
vec4 toClip(vec2 px, float depth) {
  return vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, -depth / uReach, 1.0);
}`;

const SPHERE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSphere;   // centre and radius, angstrom
layout(location = 2) in vec3 aColour;
layout(location = 3) in vec3 aWedge;    // from and to (fractions of a turn, clockwise from the top), and 1 for a pie
${PLACE}
out vec3 vWedge;
out vec2 vAt;        // position on the disc: -1..1, y down as on the canvas
out vec3 vColour;
out float vDepth;    // depth of the sphere's centre, angstrom
out float vRadius;   // angstrom
out float vRadiusPx;
void main() {
  vec3 c = place(aSphere.xyz);
  vAt = aCorner;
  vWedge = aWedge;
  vColour = aColour;
  vDepth = c.z;
  vRadius = aSphere.w;
  // The SVG's 2 px outline is centred on the circle, so the disc reaches 1 px beyond the atom's radius.
  vRadiusPx = aSphere.w * uFit.x + 1.0;
  gl_Position = toClip(c.xy + aCorner * vRadiusPx, c.z);
}`;

// The shading repeats the SVG's radial gradient: centre up and to the left, light to base colour to dark,
// and a darker rim for the outline.
const SPHERE_FS = `#version 300 es
precision highp float;
uniform float uReach;
uniform float uPxPerCanvasPx;
in vec2 vAt;
in vec3 vWedge;
in vec3 vColour;
in float vDepth;
in float vRadius;
in float vRadiusPx;
out vec4 colour;
void main() {
  float d2 = dot(vAt, vAt);
  if (d2 > 1.0) discard;
  float t = length(vAt - vec2(-0.28, -0.40)) / 1.44;
  float rim = 1.0 - 2.0 / max(vRadiusPx, 2.0);   // the outline: the outer 2 px
  vec3 c;
  if (vWedge.z > 0.5) {
    // A wedge of a pie: only its part of the turn (clockwise from the top; y runs down on the canvas).
    float turn = fract(atan(vAt.x, -vAt.y) / 6.283185307179586);
    if (turn < vWedge.x || turn >= vWedge.y) discard;
    // Flat colour under the SVG's pie shading: a highlight fading out by half way, a shadow growing to the rim.
    c = t < 0.5 ? mix(vColour, vec3(1.0), 0.55 * (1.0 - t / 0.5)) : mix(vColour, vec3(0.0), 0.28 * clamp((t - 0.5) / 0.5, 0.0, 1.0));
    if (d2 > rim * rim) c = vec3(0.29, 0.31, 0.333);   // the pie outline, #4a4f55
  } else {
    vec3 light = mix(vColour, vec3(1.0), 0.65);
    vec3 dark = mix(vColour, vec3(0.0), 0.35);
    c = t < 0.55 ? mix(light, vColour, t / 0.55) : mix(vColour, dark, clamp((t - 0.55) / 0.45, 0.0, 1.0));
    if (d2 > rim * rim) c = dark;
  }
  colour = vec4(c, 1.0);
  // The true surface of the sphere: nearer the viewer in the middle of the disc.
  float depth = vDepth + sqrt(1.0 - d2) * vRadius;
  gl_FragDepth = 0.5 - 0.5 * depth / uReach;
}`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;   // x: 0 at one end, 1 at the other; y: -1 or 1 across the line
layout(location = 1) in vec3 aFrom;
layout(location = 2) in vec3 aTo;
layout(location = 3) in float aWidth;   // angstrom if positive, canvas px if negative
layout(location = 4) in vec3 aColour;
${PLACE}
out vec3 vColour;
out float vDepth;
void main() {
  vec3 a = place(aFrom);
  vec3 b = place(aTo);
  vec2 along = b.xy - a.xy;
  float len = length(along);
  vec2 across = len > 1e-6 ? vec2(-along.y, along.x) / len : vec2(0.0, 1.0);
  float halfWidth = (aWidth > 0.0 ? aWidth * uFit.x : -aWidth) * 0.5;
  vec2 px = mix(a.xy, b.xy, aCorner.x) + across * aCorner.y * halfWidth;
  vColour = aColour;
  vDepth = mix(a.z, b.z, aCorner.x) - 0.1;   // just behind an atom at the same depth, as in the SVG
  gl_Position = toClip(px, vDepth);
}`;

const LINE_FS = `#version 300 es
precision highp float;
uniform float uReach;
in vec3 vColour;
in float vDepth;
out vec4 colour;
void main() {
  colour = vec4(vColour, 1.0);
  gl_FragDepth = 0.5 - 0.5 * vDepth / uReach;
}`;

let gl: WebGL2RenderingContext | null = null;
let canvas: OffscreenCanvas | null = null;
let sphereProgram: WebGLProgram | null = null;
let lineProgram: WebGLProgram | null = null;
let sphereVao: WebGLVertexArrayObject | null = null;
let lineVao: WebGLVertexArrayObject | null = null;
let sphereBuffer: WebGLBuffer | null = null;
let lineBuffer: WebGLBuffer | null = null;
let sphereCount = 0;
let lineCount = 0;
let centre: [number, number, number] = [0, 0, 0];
let reach = 1;

function program(context: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, source: string): WebGLShader => {
    const shader = context.createShader(type)!;
    context.shaderSource(shader, source);
    context.compileShader(shader);
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error(context.getShaderInfoLog(shader) ?? "shader failed");
    return shader;
  };
  const p = context.createProgram()!;
  context.attachShader(p, compile(context.VERTEX_SHADER, vs));
  context.attachShader(p, compile(context.FRAGMENT_SHADER, fs));
  context.linkProgram(p);
  if (!context.getProgramParameter(p, context.LINK_STATUS)) throw new Error(context.getProgramInfoLog(p) ?? "program failed");
  return p;
}

/** Read back the next frame drawn, to check that this browser's preview paints at all (see the frame message). */
let checkNext = false;

function init(offscreen: OffscreenCanvas): void {
  canvas = offscreen;
  gl = offscreen.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true, depth: true });
  if (!gl) throw new Error("WebGL 2 is not available");
  // A browser may take the graphics context away (memory, sleep): say so, and the page draws the SVG instead.
  offscreen.addEventListener("webglcontextlost", () => self.postMessage({ type: "error", message: "The graphics card dropped the preview." }));
  sphereProgram = program(gl, SPHERE_VS, SPHERE_FS);
  lineProgram = program(gl, LINE_VS, LINE_FS);
  // One square per sphere, one rectangle per line, each drawn many times (instancing).
  const quad = (corners: number[]): WebGLBuffer => {
    const buffer = gl!.createBuffer()!;
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(corners), gl!.STATIC_DRAW);
    return buffer;
  };
  const instanced = (buffer: WebGLBuffer, location: number, size: number, stride: number, offset: number): void => {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    gl!.enableVertexAttribArray(location);
    gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, stride * 4, offset * 4);
    gl!.vertexAttribDivisor(location, 1);
  };
  sphereVao = gl.createVertexArray();
  gl.bindVertexArray(sphereVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad([-1, -1, 1, -1, -1, 1, 1, 1]));
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  sphereBuffer = gl.createBuffer()!;
  instanced(sphereBuffer, 1, 4, SPHERE_STRIDE, 0);
  instanced(sphereBuffer, 2, 3, SPHERE_STRIDE, 4);
  instanced(sphereBuffer, 3, 3, SPHERE_STRIDE, 7);
  lineVao = gl.createVertexArray();
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad([0, -1, 1, -1, 0, 1, 1, 1]));
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  lineBuffer = gl.createBuffer()!;
  instanced(lineBuffer, 1, 3, LINE_STRIDE, 0);
  instanced(lineBuffer, 2, 3, LINE_STRIDE, 3);
  instanced(lineBuffer, 3, 1, LINE_STRIDE, 6);
  instanced(lineBuffer, 4, 3, LINE_STRIDE, 7);
  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
}

function draw(frame: PreviewFrame, pixelWidth: number, pixelHeight: number): void {
  if (!gl || !canvas || !sphereProgram || !lineProgram) return;
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  gl.viewport(0, 0, pixelWidth, pixelHeight);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const v = frame.view;
  for (const [p, vao, count] of [[lineProgram, lineVao, lineCount], [sphereProgram, sphereVao, sphereCount]] as const) {
    if (count === 0) continue;
    gl.useProgram(p);
    // GLSL stores matrices by column; giving the rows as columns and asking for no transpose would turn the
    // view round, so the rows are written out as the transpose here.
    gl.uniformMatrix3fv(gl.getUniformLocation(p, "uView"), false, [v[0]!, v[3]!, v[6]!, v[1]!, v[4]!, v[7]!, v[2]!, v[5]!, v[8]!]);
    gl.uniform3f(gl.getUniformLocation(p, "uCentre"), centre[0], centre[1], centre[2]);
    gl.uniform3f(gl.getUniformLocation(p, "uFit"), frame.scale, frame.x, frame.y);
    gl.uniform2f(gl.getUniformLocation(p, "uSize"), frame.width, frame.height);
    gl.uniform1f(gl.getUniformLocation(p, "uReach"), reach);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }
  gl.bindVertexArray(null);
}

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      init(message.canvas);
      self.postMessage({ type: "ready" });
    } else if (message.type === "scene" && gl) {
      gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, message.spheres, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, message.lines, gl.STATIC_DRAW);
      sphereCount = message.spheres.length / SPHERE_STRIDE;
      lineCount = message.lines.length / LINE_STRIDE;
      centre = message.centre;
      reach = message.reach;
      checkNext = true;
    } else if (message.type === "frame") {
      if (gl?.isContextLost()) throw new Error("The graphics card dropped the preview.");
      draw(message.frame, message.pixelWidth, message.pixelHeight);
      // The first frame of each structure (the page draws one, fitted, unseen, as soon as the structure is loaded)
      // is read back: if not one pixel was painted, this browser's preview does not work, and the page is told so
      // rather than showing an empty canvas while the structure moves.
      if (checkNext && gl && sphereCount + lineCount > 0) {
        checkNext = false;
        const pixels = new Uint8Array(message.pixelWidth * message.pixelHeight * 4);
        gl.readPixels(0, 0, message.pixelWidth, message.pixelHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let painted = false;
        for (let i = 3; i < pixels.length; i += 4 * 7) if (pixels[i]! > 0) { painted = true; break; }
        if (!painted) throw new Error("The preview drew nothing on this computer.");
      }
      self.postMessage({ type: "drawn", id: message.id });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
