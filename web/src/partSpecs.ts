// Procedural stand-ins for the 30 Odyssey parts, keyed by part position (1 to 30).
// When real art exists, load the .glb at parts.glb_key instead and keep these as the ghost proxies.

export type Shape = "box" | "sphere" | "cylinder" | "cone" | "torus";
export interface PartSpec {
  shape: Shape;
  pos: [number, number, number];
  size: [number, number, number]; // box: w,h,d  sphere: r  cylinder: r,h  cone: r,h  torus: r,tube
  rot?: [number, number, number];
  color?: string; // overrides the template color, so a ship can be wood, crimson and gold
}

export const PART_SPECS: Record<number, PartSpec> = {
  1: { shape: "sphere", pos: [0, 1.88, 0], size: [0.27, 0, 0] },
  2: { shape: "cone", pos: [0, 2.2, 0], size: [0.09, 0.42, 0] },
  3: { shape: "box", pos: [0, 1.82, 0.22], size: [0.36, 0.08, 0.08] },
  4: { shape: "cylinder", pos: [0, 1.6, 0], size: [0.17, 0.12, 0] },
  5: { shape: "sphere", pos: [-0.46, 1.45, 0], size: [0.16, 0, 0] },
  6: { shape: "sphere", pos: [0.46, 1.45, 0], size: [0.16, 0, 0] },
  7: { shape: "box", pos: [0, 1.2, 0.04], size: [0.6, 0.6, 0.3] },
  8: { shape: "box", pos: [0, 1.05, -0.22], size: [0.62, 1.0, 0.04] },
  9: { shape: "box", pos: [0, 0.84, 0], size: [0.58, 0.08, 0.32] },
  10: { shape: "cylinder", pos: [-0.64, 0.85, 0], size: [0.09, 0.22, 0] },
  11: { shape: "cylinder", pos: [0.64, 0.85, 0], size: [0.09, 0.22, 0] },
  12: { shape: "cylinder", pos: [-0.16, 0.34, 0], size: [0.1, 0.36, 0] },
  13: { shape: "cylinder", pos: [0.16, 0.34, 0], size: [0.1, 0.36, 0] },
  14: { shape: "box", pos: [0, 0.05, 0.08], size: [0.52, 0.08, 0.3] },
  15: { shape: "cylinder", pos: [0.85, 1.1, 0], size: [0.025, 2.2, 0] },
  16: { shape: "cylinder", pos: [-0.8, 1.1, 0.12], size: [0.36, 0.05, 0], rot: [Math.PI / 2, 0, 0] },
  17: { shape: "box", pos: [0.34, 0.74, -0.1], size: [0.06, 0.7, 0.06], rot: [0, 0, 0.6] },
  18: { shape: "cylinder", pos: [-0.16, 1.3, -0.3], size: [0.07, 0.5, 0], rot: [0, 0, 0.2] },
  19: { shape: "torus", pos: [0.58, 1.2, -0.2], size: [0.3, 0.02, 0] },
  20: { shape: "cone", pos: [-1.0, 2.05, 0], size: [0.12, 0.4, 0] },
  21: { shape: "sphere", pos: [0.36, 0.7, 0.2], size: [0.09, 0, 0] },
  22: { shape: "torus", pos: [0, 1.46, 0.18], size: [0.2, 0.015, 0], rot: [Math.PI / 2, 0, 0] },
  23: { shape: "sphere", pos: [0, 1.36, 0.22], size: [0.05, 0, 0] },
  24: { shape: "sphere", pos: [0, 1.2, 0.2], size: [0.08, 0, 0] },
  25: { shape: "box", pos: [1.1, 0.25, 0.1], size: [0.18, 0.18, 0.18] },
  26: { shape: "box", pos: [-1.1, 1.7, 0], size: [0.02, 0.5, 0.4] },
  27: { shape: "cylinder", pos: [1.3, 0.95, -0.1], size: [0.025, 1.6, 0], rot: [0, 0, 0.3] },
  28: { shape: "torus", pos: [-0.5, 0.75, 0.25], size: [0.08, 0.02, 0] },
  29: { shape: "box", pos: [0, 1.5, -0.1], size: [0.95, 0.1, 0.4] },
  30: { shape: "cone", pos: [0, 2.7, 0], size: [0.16, 0.32, 0], rot: [Math.PI, 0, 0] },
};

// ---- the free build: a Greek war galley. Bow points along +x. ----
const WOOD = "#8a5a30";
const DARK = "#5a3a1c";
const GOLD = "#d9a441";
const CRIMSON = "#b3202f";
export const SHIP_SPECS: Record<number, PartSpec> = {
  1: { shape: "box", pos: [0, -0.25, 0], size: [4.4, 0.14, 0.3], color: DARK },
  2: { shape: "box", pos: [0, 0.22, -0.45], size: [4.2, 0.8, 0.08], color: WOOD },
  3: { shape: "box", pos: [0, 0.22, 0.45], size: [4.2, 0.8, 0.08], color: WOOD },
  4: { shape: "box", pos: [0, 0.58, 0], size: [4.0, 0.06, 0.9], color: "#a9793f" },
  5: { shape: "sphere", pos: [2.45, 0.8, 0], size: [0.17, 0, 0], color: GOLD },
  6: { shape: "cone", pos: [2.6, 0.0, 0], size: [0.13, 0.55, 0], rot: [0, 0, -Math.PI / 2], color: "#b08d57" },
  7: { shape: "cone", pos: [-2.25, 0.85, 0], size: [0.1, 0.8, 0], rot: [0, 0, 0.25], color: WOOD },
  8: { shape: "cylinder", pos: [0, 1.75, 0], size: [0.06, 2.7, 0], color: DARK },
  9: { shape: "cylinder", pos: [0, 2.85, 0], size: [0.045, 2.3, 0], rot: [Math.PI / 2, 0, 0], color: DARK },
  10: { shape: "box", pos: [0.08, 1.95, 0], size: [0.04, 1.6, 2.0], color: CRIMSON },
  11: { shape: "cylinder", pos: [0.11, 1.95, 0], size: [0.3, 0.03, 0], rot: [0, 0, Math.PI / 2], color: "#f0cf8a" },
  12: { shape: "cylinder", pos: [1.2, 1.82, 0], size: [0.012, 3.2, 0], rot: [0, 0, 0.85], color: "#c9b88a" },
  13: { shape: "cylinder", pos: [-1.1, 1.8, 0], size: [0.012, 3.1, 0], rot: [0, 0, -0.79], color: "#c9b88a" },
  14: { shape: "torus", pos: [1.7, 0.55, 0.52], size: [0.13, 0.03, 0], color: "#b08d57" },
  15: { shape: "cylinder", pos: [-2.0, 0.25, -1.1], size: [0.03, 1.3, 0], rot: [-1.97, 0, 0], color: "#a9793f" },
  16: { shape: "cylinder", pos: [-2.0, 0.25, 1.1], size: [0.03, 1.3, 0], rot: [1.97, 0, 0], color: "#a9793f" },
  17: { shape: "cylinder", pos: [-0.9, 0.07, -1.31], size: [0.02, 1.8, 0], rot: [-2.07, 0, 0], color: "#a9793f" },
  18: { shape: "cylinder", pos: [0.5, 0.07, -1.31], size: [0.02, 1.8, 0], rot: [-2.07, 0, 0], color: "#a9793f" },
  19: { shape: "cylinder", pos: [-0.9, 0.07, 1.31], size: [0.02, 1.8, 0], rot: [2.07, 0, 0], color: "#a9793f" },
  20: { shape: "cylinder", pos: [0.5, 0.07, 1.31], size: [0.02, 1.8, 0], rot: [2.07, 0, 0], color: "#a9793f" },
  21: { shape: "box", pos: [0, 0.78, -0.5], size: [3.4, 0.22, 0.03], color: CRIMSON },
  22: { shape: "box", pos: [0, 0.78, 0.5], size: [3.4, 0.22, 0.03], color: CRIMSON },
  23: { shape: "box", pos: [0, 0.64, -0.5], size: [4.3, 0.05, 0.06], color: GOLD },
  24: { shape: "box", pos: [0, 0.64, 0.5], size: [4.3, 0.05, 0.06], color: GOLD },
  25: { shape: "sphere", pos: [-2.1, 1.15, 0], size: [0.09, 0, 0], color: "#ffd89a" },
  26: { shape: "cylinder", pos: [0.9, 0.78, 0.2], size: [0.1, 0.28, 0], color: "#b5651d" },
  27: { shape: "box", pos: [-0.9, 0.8, -0.15], size: [0.35, 0.3, 0.35], color: "#7a5a30" },
  28: { shape: "torus", pos: [-1.5, 0.75, 0.25], size: [0.1, 0.022, 0], rot: [Math.PI / 2, 0, 0], color: GOLD },
  29: { shape: "box", pos: [0.03, 3.15, 0.35], size: [0.02, 0.38, 0.6], color: CRIMSON },
  30: { shape: "cone", pos: [0, 3.35, 0], size: [0.12, 0.3, 0], color: GOLD },
};
