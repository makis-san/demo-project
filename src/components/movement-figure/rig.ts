/**
 * The math behind the movement figure. No React and no DOM, so it can run on the server and be read on its own.
 *
 * One skeleton has 7 segments and 7 joint angles. An angle is the direction a segment points, in degrees clockwise
 * from straight up, with the athlete facing right. A movement picks a root joint to pin in place (the ankle for a
 * squat, the hand for a pull-up) and forward kinematics places every other joint from it. A movement stores two or
 * three key poses, and a Catmull-Rom curve runs through them, so the motion has the right order: hips back before
 * the knees bend in a squat, the head moving out of the bar's way in an overhead press.
 */
import type { MuscleGroup } from "@/lib/muscles";

export type Segment = "foot" | "shin" | "thigh" | "torso" | "neck" | "upper" | "fore";
export type Pose = Record<Segment, number>;
export type RootJoint = "ankle" | "hip" | "wrist" | "toe";
export type JointName = "knee" | "hip" | "elbow" | "shoulder" | "ankle";
export type PhaseKind = "setup" | "ecc" | "conc" | "hold" | "reset";
export type Point = [number, number];

/** The gear drawn with the figure. The bench goes behind it, the rest is held or stood on. */
export type FigureGear = "barbell" | "pullbar" | "dipbars" | "step" | "none";

export type FigureDef = {
  root: RootJoint;
  /** Where the root joint sits, in metres: x along the floor, y up from it. */
  at: Point;
  gear: FigureGear;
  bench?: boolean;
  /** Joint angles shown live while it moves. */
  read: JointName[];
  /** What the dashed line follows. The hands unless told otherwise. */
  path?: "body" | "heel";
  /** Whether the first half of the rep is lowering (eccentric) or lifting (concentric). */
  first: "ecc" | "conc";
  /** Two or three key poses, start to far end. */
  poses: Pose[];
};

/** A pose from seven angles, in the order of `Segment`, so the catalog stays one short line per pose. */
export const P = (
  foot: number,
  shin: number,
  thigh: number,
  torso: number,
  neck: number,
  upper: number,
  fore: number,
): Pose => ({ foot, shin, thigh, torso, neck, upper, fore });

/** Segment lengths in metres. */
const LEN: Record<Segment, number> = {
  foot: 0.2,
  shin: 0.43,
  thigh: 0.45,
  torso: 0.52,
  neck: 0.21,
  upper: 0.31,
  fore: 0.28,
};

type Joint = "ankle" | "toe" | "knee" | "hip" | "shoulder" | "head" | "elbow" | "wrist";
const EDGES: [Joint, Joint, Segment][] = [
  ["ankle", "toe", "foot"],
  ["ankle", "knee", "shin"],
  ["knee", "hip", "thigh"],
  ["hip", "shoulder", "torso"],
  ["shoulder", "head", "neck"],
  ["shoulder", "elbow", "upper"],
  ["elbow", "wrist", "fore"],
];

/** The joint each segment hangs from: where its drawing is placed and rotated. */
export const segmentJoint: Record<Segment, Joint> = {
  foot: "ankle",
  shin: "ankle",
  thigh: "knee",
  torso: "hip",
  neck: "shoulder",
  upper: "shoulder",
  fore: "elbow",
};

export type Joints = Record<Joint | "hand", Point>;

const dir = (angle: number): Point => {
  const r = (angle * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
};

/** Forward kinematics: every joint's position, in metres, from the pinned root joint. */
export function joints(pose: Pose, root: RootJoint, at: Point): Joints {
  const placed: Partial<Record<Joint, Point>> = { [root]: [...at] as Point };
  const queue: Joint[] = [root];
  while (queue.length) {
    const j = queue.shift()!;
    for (const [a, b, seg] of EDGES) {
      const d = dir(pose[seg]);
      const length = LEN[seg];
      if (a === j && !placed[b]) {
        const from = placed[a]!;
        placed[b] = [from[0] + d[0] * length, from[1] + d[1] * length];
        queue.push(b);
      } else if (b === j && !placed[a]) {
        const from = placed[b]!;
        placed[a] = [from[0] - d[0] * length, from[1] - d[1] * length];
        queue.push(a);
      }
    }
  }
  const all = placed as Record<Joint, Point>;
  const f = dir(pose.fore);
  return { ...all, hand: [all.wrist[0] + f[0] * 0.045, all.wrist[1] + f[1] * 0.045] };
}

/** The pose at `u` (0 to 1) along the curve through the key poses. */
export function poseAt(poses: Pose[], u: number): Pose {
  const n = poses.length - 1;
  const s = Math.max(0, Math.min(1, u)) * n;
  const i = Math.min(n - 1, Math.floor(s));
  const t = s - i;
  const p0 = poses[Math.max(0, i - 1)];
  const p1 = poses[i];
  const p2 = poses[i + 1];
  const p3 = poses[Math.min(n, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  const out = {} as Pose;
  for (const k of Object.keys(p1) as Segment[]) {
    out[k] =
      0.5 *
      (2 * p1[k] +
        (-p0[k] + p2[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  }
  return out;
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

const JOINT_ANGLES: Record<JointName, { at: Joint; a: Joint; b: Joint; label: string }> = {
  knee: { at: "knee", a: "hip", b: "ankle", label: "Knee" },
  hip: { at: "hip", a: "shoulder", b: "knee", label: "Hip" },
  elbow: { at: "elbow", a: "shoulder", b: "wrist", label: "Elbow" },
  shoulder: { at: "shoulder", a: "hip", b: "elbow", label: "Shoulder" },
  ankle: { at: "ankle", a: "knee", b: "toe", label: "Ankle" },
};

/** The angle at a joint, in whole degrees: 180 is straight. */
export function jointAngle(j: Joints, name: JointName): { label: string; degrees: number } {
  const { at, a, b, label } = JOINT_ANGLES[name];
  const c = j[at];
  const v1 = [j[a][0] - c[0], j[a][1] - c[1]];
  const v2 = [j[b][0] - c[0], j[b][1] - c[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]));
  return { label, degrees: Math.round((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI) };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Timeline: set up, the first half of the rep, a pause, the second half, a reset. */

/** Seconds: lowering is slower than lifting. */
export const phaseSeconds: Record<PhaseKind, number> = { setup: 0.7, ecc: 2.0, conc: 1.2, hold: 0.45, reset: 0.35 };

export type Phase = { kind: PhaseKind; seconds: number; from: number; to: number; step: number };

export function phasesOf(first: FigureDef["first"]): Phase[] {
  const second = first === "ecc" ? "conc" : "ecc";
  return [
    { kind: "setup", seconds: phaseSeconds.setup, from: 0, to: 0, step: 0 },
    { kind: first, seconds: phaseSeconds[first], from: 0, to: 1, step: 1 },
    { kind: "hold", seconds: phaseSeconds.hold, from: 1, to: 1, step: 1 },
    { kind: second, seconds: phaseSeconds[second], from: 1, to: 0, step: 2 },
    { kind: "reset", seconds: phaseSeconds.reset, from: 0, to: 0, step: 2 },
  ];
}

export const cycleSeconds = (phases: Phase[]) => phases.reduce((sum, p) => sum + p.seconds, 0);

export type Moment = { phase: Phase; u: number; rep: number; fraction: number };

/** Where `t` seconds from the start falls in the repeating cycle. */
export function momentAt(phases: Phase[], t: number): Moment {
  const cycle = cycleSeconds(phases);
  let r = ((t % cycle) + cycle) % cycle;
  const fraction = r / cycle;
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    if (r < phase.seconds || i === phases.length - 1) {
      const e = ease(Math.min(1, r / phase.seconds));
      return { phase, u: phase.from + (phase.to - phase.from) * e, rep: Math.floor(t / cycle) + 1, fraction };
    }
    r -= phase.seconds;
  }
  throw new Error("unreachable");
}

export const phaseLabels: Record<PhaseKind, string> = {
  setup: "Set up",
  hold: "Pause",
  reset: "Reset",
  conc: "Lifting · concentric",
  ecc: "Lowering · eccentric",
};

/** How hard the muscles work in each phase: [primary, secondary], 0 to 1. Lifting is brighter than lowering. */
export const phaseLevels: Record<PhaseKind, [number, number]> = {
  setup: [0.45, 0.2],
  hold: [0.62, 0.3],
  reset: [0.45, 0.2],
  conc: [1, 0.55],
  ecc: [0.76, 0.38],
};

/** Per muscle group, how worked it is in this phase. */
export function levelsFor(
  kind: PhaseKind,
  primary: readonly MuscleGroup[],
  secondary: readonly MuscleGroup[],
): Partial<Record<MuscleGroup, number>> {
  const [p, s] = phaseLevels[kind];
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const m of secondary) out[m] = s;
  for (const m of primary) out[m] = p;
  return out;
}

/* ------------------------------------------------------------------------------------------------------------ */

/** What the camera frames: the whole rep, so nothing leaves the picture. Metres in, SVG units (1 px = 1 cm) out. */
export const SCALE = 100;
const STAGE_RATIO = 4 / 3.3;

export type Frame = {
  viewBox: string;
  minX: number;
  maxX: number;
  /** The dashed path of the bar, hands, body or heel through the whole rep, in SVG units. */
  trail: Point[];
  /** The pose at the far end, for the faint outline of the range of motion. */
  farPose: Pose;
};

export function frameOf(def: FigureDef): Frame {
  const pts: Point[] = [];
  const trail: Point[] = [];
  for (let s = 0; s <= 40; s++) {
    const j = joints(poseAt(def.poses, s / 40), def.root, def.at);
    for (const p of Object.values(j)) pts.push(p);
    pts.push([j.head[0], j.head[1] + 0.13], [j.head[0], j.head[1] - 0.13], [j.head[0] + 0.13, j.head[1]]);
    if (def.gear === "barbell") pts.push([j.hand[0], j.hand[1] + 0.24], [j.hand[0], j.hand[1] - 0.24]);
    const tracked =
      def.path === "heel" ? ([j.ankle[0] - 0.05, j.ankle[1]] as Point) : def.path === "body" ? j.shoulder : j.hand;
    trail.push([tracked[0] * SCALE, -tracked[1] * SCALE]);
  }
  pts.push([0, 0]);
  if (def.gear === "pullbar") pts.push([0, def.at[1] + 0.12]);

  let minX = Math.min(...pts.map((p) => p[0])) - 0.16;
  let maxX = Math.max(...pts.map((p) => p[0])) + 0.16;
  let minY = -0.07;
  let maxY = Math.max(...pts.map((p) => p[1])) + 0.1;
  let w = maxX - minX;
  let h = maxY - minY;
  if (w / h < STAGE_RATIO) {
    const nw = h * STAGE_RATIO;
    minX -= (nw - w) / 2;
    w = nw;
  } else {
    const nh = w / STAGE_RATIO;
    maxY += (nh - h) * 0.6;
    minY -= (nh - h) * 0.4;
    h = nh;
  }
  const viewBox = [minX * SCALE, -maxY * SCALE, w * SCALE, h * SCALE].map((v) => v.toFixed(1)).join(" ");
  return { viewBox, minX: minX * SCALE, maxX: (minX + w) * SCALE, trail, farPose: def.poses[def.poses.length - 1] };
}

/** The tempo line under the figure, for example "Tempo 2 s down, 1.2 s up". */
export function tempoText(first: FigureDef["first"]) {
  const down = `${phaseSeconds.ecc} s down`;
  const up = `${phaseSeconds.conc} s up`;
  return `Tempo ${first === "ecc" ? `${down}, ${up}` : `${up}, ${down}`}`;
}
