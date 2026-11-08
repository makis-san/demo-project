import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { centreOf, drawnMuscles, outlines } from "./anatomy";
import {
  cycleSeconds,
  frameOf,
  jointAngle,
  joints,
  levelsFor,
  momentAt,
  phaseLabels,
  phasesOf,
  poseAt,
  SCALE,
  segmentJoint,
  tempoText,
  type FigureDef,
  type JointName,
  type Joints,
  type PhaseKind,
  type Pose,
  type Segment,
} from "./rig";
import { muscleGroups, type MuscleGroup } from "@/lib/muscles";
import { cn } from "@/lib/utils";

/**
 * The animated side view of a movement: a neutral anatomical body whose muscles swell and glow as it moves.
 *
 * React draws the SVG once, in the first pose, so the server sends a complete picture before any script runs. After
 * that a requestAnimationFrame loop moves it by writing attributes straight to the SVG nodes it collected. The frame
 * rate never goes through React state: only the things that change a few times a rep (the step, the play button) do.
 */

type Rgb = [number, number, number];
const COLOR = {
  body: [52, 45, 48] as Rgb,
  bodyFar: [35, 30, 32] as Rgb,
  muscle: [86, 73, 77] as Rgb,
  muscleFar: [58, 50, 53] as Rgb,
  hot: [224, 38, 42] as Rgb,
};
const mix = (a: Rgb, b: Rgb, t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
const rgb = (c: Rgb) => mix(c, c, 0);

/** The far arm and leg are drawn a little behind and to the side, so the body reads as having two of each. */
const FAR: [number, number] = [-0.035, 0.014];
/** Back to front. The second number is 1 for the limb on the far side. */
const DRAW_ORDER: [Segment, 0 | 1][] = [
  ["upper", 1],
  ["fore", 1],
  ["thigh", 1],
  ["shin", 1],
  ["foot", 1],
  ["shin", 0],
  ["foot", 0],
  ["thigh", 0],
  ["torso", 0],
  ["neck", 0],
  ["upper", 0],
  ["fore", 0],
];
const GHOST_PARTS: Segment[] = ["thigh", "shin", "foot", "torso", "neck", "upper", "fore"];
const SWELL_FROM = 0.35;

const num = (n: number, digits = 2) => n.toFixed(digits);

function partTransform(j: Joints, pose: Pose, seg: Segment, offset: [number, number]) {
  const at = j[segmentJoint[seg]];
  return `translate(${num((at[0] + offset[0]) * SCALE)} ${num(-(at[1] + offset[1]) * SCALE)}) rotate(${num(pose[seg] - 90)})`;
}

/** How a muscle looks at an activity level: its colour, and the transform that makes it swell across its width. */
function muscleLook(far: boolean, group: MuscleGroup | null, level: number, centre: [number, number]) {
  const a = group ? level : 0;
  const fill = far ? mix(COLOR.muscleFar, COLOR.hot, a * 0.55) : mix(COLOR.muscle, COLOR.hot, a);
  const swell = group && !far ? 1 + 0.16 * Math.max(0, a - SWELL_FROM) : 1;
  const shorten = 1 - 0.03 * Math.max(0, a - SWELL_FROM);
  const transform =
    swell === 1
      ? ""
      : `translate(${centre[0]} ${centre[1]}) scale(${shorten.toFixed(3)} ${swell.toFixed(3)}) translate(${-centre[0]} ${-centre[1]})`;
  return { fill, transform, active: !far && !!group && a > SWELL_FROM };
}

type GearPositions = {
  plate?: [number, number];
  mount?: [number, number];
  rail?: { x: number; y: number };
  post?: { x: number; y: number; height: number };
};
function equipmentAt(j: Joints): GearPositions {
  const hx = j.hand[0] * SCALE;
  const hy = -j.hand[1] * SCALE;
  return {
    plate: [hx, hy],
    mount: [hx - 1.5, hy - 400],
    rail: { x: hx - 40, y: hy + 3 },
    post: { x: hx - 36, y: hy + 5, height: Math.max(0, -hy - 5) },
  };
}

/* ------------------------------------------------------------------------------------------------------------ */

function FigureSvg({
  name,
  figure,
  primary,
  secondary,
  showPath,
  showRange,
}: {
  name: string;
  figure: FigureDef;
  primary: readonly MuscleGroup[];
  secondary: readonly MuscleGroup[];
  showPath: boolean;
  showRange: boolean;
}) {
  const frame = frameOf(figure);
  const start = poseAt(figure.poses, 0);
  const j0 = joints(start, figure.root, figure.at);
  const farJoints = joints(frame.farPose, figure.root, figure.at);
  const setup = levelsFor("setup", primary, secondary);
  const eq = equipmentAt(j0);
  const { gear } = figure;
  const trailD = "M" + frame.trail.map((p) => `${num(p[0], 1)},${num(p[1], 1)}`).join("L");
  const trailEnds = [frame.trail[0], frame.trail[frame.trail.length - 1]];

  return (
    <svg
      viewBox={frame.viewBox}
      role="img"
      aria-label={`Side view of ${name}`}
      preserveAspectRatio="xMidYMid meet"
      data-figure>
      <defs>
        <linearGradient id="fg-sheen" gradientUnits="userSpaceOnUse" x1="0" y1="-13" x2="0" y2="13">
          <stop offset="0" stopColor="#000" stopOpacity="0.35" />
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="fg-sheen-arm" gradientUnits="userSpaceOnUse" x1="0" y1="-13" x2="0" y2="13">
          <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.35" />
        </linearGradient>
        {(Object.keys(outlines) as (keyof typeof outlines)[]).map((k) => (
          <path key={k} id={`fg-${k}`} d={outlines[k]} />
        ))}
        <filter id="fg-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="fg-shadow">
          <stop offset="0" stopColor="black" stopOpacity="0.5" />
          <stop offset="1" stopColor="black" stopOpacity="0" />
        </radialGradient>
      </defs>

      <line className="fg-floor" x1={(frame.minX - 100).toFixed(1)} x2={(frame.maxX + 100).toFixed(1)} y1="0" y2="0" />
      <ellipse
        data-eq="shadow"
        fill="url(#fg-shadow)"
        cx={num(((j0.ankle[0] + j0.toe[0]) / 2) * SCALE, 1)}
        cy="0"
        rx="42"
        ry="3.6"
      />

      {/* The range of motion: the far end of the movement as a faint outline. */}
      <g data-eq="range" style={{ display: showRange ? undefined : "none" }}>
        {GHOST_PARTS.map((seg) => (
          <g key={seg} transform={partTransform(farJoints, frame.farPose, seg, [0, 0])}>
            <use href={`#fg-${seg}`} className="fg-ghost" />
            {seg === "neck" && <use href="#fg-head" className="fg-ghost" />}
          </g>
        ))}
      </g>

      {figure.bench && (
        <>
          <rect className="fg-eq-dim" x="-66" y="-40" width="5" height="40" />
          <rect className="fg-eq-dim" x="-4" y="-40" width="5" height="40" />
          <rect className="fg-pad" x="-84" y="-47.5" width="96" height="8" rx="3" />
        </>
      )}
      {gear === "step" && <rect className="fg-eq-dim" x="-8" y="-20" width="48" height="20" rx="2" />}
      {gear === "pullbar" && (
        <rect
          data-eq="mount"
          className="fg-eq-dim"
          width="3"
          height="400"
          x={num(eq.mount![0], 1)}
          y={num(eq.mount![1], 1)}
        />
      )}
      {gear === "dipbars" && (
        <rect
          data-eq="post"
          className="fg-eq-dim"
          width="4"
          x={num(eq.post!.x, 1)}
          y={num(eq.post!.y, 1)}
          height={num(eq.post!.height, 1)}
        />
      )}

      {DRAW_ORDER.map(([seg, far]) => (
        <g
          key={`${seg}-${far}`}
          data-part={seg}
          data-far={far}
          transform={partTransform(j0, start, seg, far ? FAR : [0, 0])}>
          <use href={`#fg-${seg}`} fill={rgb(far ? COLOR.bodyFar : COLOR.body)} />
          {seg === "neck" && <use href="#fg-head" fill={rgb(far ? COLOR.bodyFar : COLOR.body)} />}
          {drawnMuscles[seg].map(([group, outline, fibres], i) => {
            const centre = centreOf(outline);
            const look = muscleLook(!!far, group, group ? (setup[group] ?? 0) : 0, centre);
            return (
              <g
                key={i}
                data-muscle={group ?? undefined}
                data-far={far}
                data-primary={group && primary.includes(group) ? "true" : undefined}
                data-secondary={group && secondary.includes(group) ? "true" : undefined}
                data-active={look.active ? "true" : "false"}
                data-cx={centre[0]}
                data-cy={centre[1]}
                transform={look.transform || undefined}>
                <path d={outline} className="fg-mp" fill={look.fill} />
                {!far && fibres.map((d) => <path key={d} d={d} className="fg-fib" />)}
              </g>
            );
          })}
          {seg === "fore" && <use href="#fg-hand" fill={rgb(far ? COLOR.bodyFar : COLOR.body)} />}
          {seg === "neck" && <use href="#fg-head" fill="url(#fg-sheen)" />}
          {seg !== "foot" && seg !== "neck" && (
            <use
              href={`#fg-${seg}`}
              fill={seg === "upper" || seg === "fore" ? "url(#fg-sheen-arm)" : "url(#fg-sheen)"}
              pointerEvents="none"
            />
          )}
        </g>
      ))}

      {/* The bar path, hands, body or heel, drawn over the body and under the plate. */}
      <g data-eq="trail" style={{ display: showPath ? undefined : "none" }}>
        <path className="fg-trail" d={trailD} />
        {trailEnds.map((p, i) => (
          <circle key={i} className="fg-trail-end" cx={num(p[0], 1)} cy={num(p[1], 1)} r="1.4" />
        ))}
      </g>

      {gear === "barbell" && (
        <>
          <circle data-eq="plate" className="fg-plate" r="22.5" cx={num(eq.plate![0])} cy={num(eq.plate![1])} />
          <circle data-eq="hub" className="fg-eq" r="2.8" cx={num(eq.plate![0])} cy={num(eq.plate![1])} />
        </>
      )}
      {gear === "pullbar" && (
        <circle data-eq="bar" className="fg-eq" r="2.6" cx={num(eq.plate![0])} cy={num(eq.plate![1])} />
      )}
      {gear === "dipbars" && (
        <rect
          data-eq="rail"
          className="fg-eq"
          width="80"
          height="3.4"
          rx="1.7"
          x={num(eq.rail!.x, 1)}
          y={num(eq.rail!.y, 1)}
        />
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------------------------------------------------ */

const toggleClass = (on: boolean) =>
  cn(
    "press h-9 rounded-full border px-3.5 text-xs font-semibold",
    on
      ? "border-line-strong bg-raised text-chalk shadow-[inset_0_0_0_1px_oklch(74%_0.15_15/0.35)]"
      : "border-line bg-well text-muted hover:text-chalk",
  );

export function MovementFigure({
  name,
  figure,
  primary,
  secondary,
  onStepChange,
}: {
  name: string;
  figure: FigureDef;
  primary: readonly MuscleGroup[];
  secondary: readonly MuscleGroup[];
  /** The step of the movement the animation is in: 0 set up, 1 the first half, 2 the second. */
  onStepChange?: (step: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  const [half, setHalf] = useState(false);
  const [showPath, setShowPath] = useState(true);
  const [showRange, setShowRange] = useState(true);
  // Read by the animation loop, which must not restart when the controls change.
  const control = useRef({ playing: true, speed: 1, t: 0, seek: null as null | ((fraction: number) => void) });
  const onStep = useRef(onStepChange);
  onStep.current = onStepChange;
  control.current.playing = playing;
  control.current.speed = half ? 0.5 : 1;

  useEffect(() => {
    // Someone who asked for less motion gets a paused figure, and can still play it.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const svg = host.querySelector<SVGSVGElement>("svg[data-figure]")!;
    const phasePill = host.querySelector<HTMLElement>("[data-testid='figure-phase']")!;
    const phaseText = phasePill.querySelector("span")!;
    const repText = host.querySelector<HTMLElement>("[data-testid='figure-rep']")!;
    const scrub = host.querySelector<HTMLInputElement>("input[type='range']")!;
    const angleEls = [...host.querySelectorAll<HTMLElement>("[data-angle]")];

    const parts = [...svg.querySelectorAll<SVGGElement>("[data-part]")].map((el) => ({
      el,
      seg: el.dataset.part as Segment,
      far: el.dataset.far === "1",
      muscles: [...el.querySelectorAll<SVGGElement>(":scope > g[data-far]")].map((g) => ({
        g,
        path: g.querySelector("path")!,
        group: (g.dataset.muscle as MuscleGroup | undefined) ?? null,
        centre: [Number(g.dataset.cx), Number(g.dataset.cy)] as [number, number],
        glow: false,
      })),
    }));
    const one = (key: string) => svg.querySelector<SVGElement>(`[data-eq='${key}']`);
    const plate = one("plate");
    const hub = one("hub");
    const bar = one("bar");
    const mount = one("mount");
    const rail = one("rail");
    const post = one("post");
    const shadow = one("shadow")!;

    const phases = phasesOf(figure.first);
    const cycle = cycleSeconds(phases);
    const activity: Partial<Record<MuscleGroup, number>> = { ...levelsFor("setup", primary, secondary) };
    let target = levelsFor("setup", primary, secondary);
    let working = new Set<MuscleGroup>();
    let lastKind: PhaseKind = "setup";
    let lastStep = 0;

    const draw = (pose: Pose, dt: number | null) => {
      const j = joints(pose, figure.root, figure.at);
      const k = dt === null ? 1 : Math.min(1, dt * 7);
      // Muscles ease toward their level, so they fade up and down instead of switching.
      for (const m of muscleGroups) activity[m] = (activity[m] ?? 0) + ((target[m] ?? 0) - (activity[m] ?? 0)) * k;
      for (const part of parts) {
        part.el.setAttribute("transform", partTransform(j, pose, part.seg, part.far ? FAR : [0, 0]));
        for (const m of part.muscles) {
          const level = m.group ? (activity[m.group] ?? 0) : 0;
          const look = muscleLook(part.far, m.group, level, m.centre);
          m.path.setAttribute("fill", look.fill);
          if (look.transform) m.g.setAttribute("transform", look.transform);
          else m.g.removeAttribute("transform");
          m.g.dataset.active = String(look.active);
          const glow = !part.far && !!m.group && working.has(m.group) && level > 0.8;
          if (glow !== m.glow) {
            m.glow = glow;
            if (glow) m.path.setAttribute("filter", "url(#fg-glow)");
            else m.path.removeAttribute("filter");
          }
        }
      }
      const lift = Math.max(0, Math.min(j.ankle[1], j.toe[1]) - 0.1);
      shadow.setAttribute("cx", num(((j.ankle[0] + j.toe[0]) / 2) * SCALE, 1));
      shadow.setAttribute("opacity", Math.max(0.25, 1 - lift * 0.6).toFixed(2));
      const eq = equipmentAt(j);
      for (const el of [plate, hub, bar]) {
        el?.setAttribute("cx", num(eq.plate![0]));
        el?.setAttribute("cy", num(eq.plate![1]));
      }
      mount?.setAttribute("x", num(eq.mount![0], 1));
      mount?.setAttribute("y", num(eq.mount![1], 1));
      rail?.setAttribute("x", num(eq.rail!.x, 1));
      rail?.setAttribute("y", num(eq.rail!.y, 1));
      post?.setAttribute("x", num(eq.post!.x, 1));
      post?.setAttribute("y", num(eq.post!.y, 1));
      post?.setAttribute("height", num(eq.post!.height, 1));
      return j;
    };

    const render = (force: boolean, dt: number | null) => {
      const moment = momentAt(phases, control.current.t);
      const kind = moment.phase.kind;
      if (force || kind !== lastKind) {
        lastKind = kind;
        phasePill.dataset.phase = kind;
        phaseText.textContent = phaseLabels[kind];
        target = levelsFor(kind, primary, secondary);
        working = new Set(kind === "conc" ? primary : []);
      }
      if (force || moment.phase.step !== lastStep) {
        lastStep = moment.phase.step;
        onStep.current?.(lastStep);
      }
      repText.textContent = `Rep ${moment.rep}`;
      if (document.activeElement !== scrub) scrub.value = String(Math.round(moment.fraction * 1000));
      const j = draw(poseAt(figure.poses, moment.u), dt);
      angleEls.forEach((el) => {
        el.querySelector("b")!.textContent = `${jointAngle(j, el.dataset.angle as JointName).degrees}°`;
      });
    };

    control.current.seek = (fraction) => {
      const rep = Math.floor(control.current.t / cycle);
      control.current.t = rep * cycle + fraction * cycle * 0.9999;
      render(false, null);
    };

    render(true, null);
    let frameId = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (control.current.playing) {
        control.current.t += dt * control.current.speed;
        render(false, dt);
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [figure, primary, secondary]);

  const start = poseAt(figure.poses, 0);
  const j0 = joints(start, figure.root, figure.at);
  const pathLabel = figure.path === "heel" ? "Heel path" : figure.path === "body" ? "Body path" : "Bar path";

  return (
    <div ref={root} className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Overlays">
          <button
            type="button"
            aria-pressed={showPath}
            onClick={() => setShowPath((v) => !v)}
            className={toggleClass(showPath)}>
            {pathLabel}
          </button>
          <button
            type="button"
            aria-pressed={showRange}
            onClick={() => setShowRange((v) => !v)}
            className={toggleClass(showRange)}>
            Range of motion
          </button>
        </div>
        <span className="text-xs text-faint">{tempoText(figure.first)}</span>
      </div>

      <div className="figure-stage">
        <FigureSvg
          name={name}
          figure={figure}
          primary={primary}
          secondary={secondary}
          showPath={showPath}
          showRange={showRange}
        />
        <div className="figure-phase" data-testid="figure-phase" data-phase="setup">
          <i />
          <span>{phaseLabels.setup}</span>
        </div>
        <div className="figure-rep num" data-testid="figure-rep">
          Rep 1
        </div>
        <div className="figure-angles num">
          {figure.read.map((joint) => {
            const { label, degrees } = jointAngle(j0, joint);
            return (
              <span key={joint} data-angle={joint}>
                {label} <b>{degrees}°</b>
              </span>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((v) => !v)}
          aria-label={playing ? "Pause" : "Play"}
          className="press grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-ink">
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          defaultValue={0}
          aria-label="Position in the rep"
          className="w-full accent-[#e0262a]"
          onInput={(e) => {
            setPlaying(false);
            control.current.playing = false;
            control.current.seek?.(Number(e.currentTarget.value) / 1000);
          }}
        />
        <div className="flex gap-0.5 rounded-full border border-line bg-well p-[3px]" role="group" aria-label="Speed">
          {[
            ["0.5×", true],
            ["1×", false],
          ].map(([label, isHalf]) => (
            <button
              key={String(label)}
              type="button"
              aria-pressed={half === isHalf}
              onClick={() => setHalf(isHalf as boolean)}
              className={cn(
                "press h-8 rounded-full px-3 text-xs font-semibold",
                half === isHalf ? "bg-raised text-chalk shadow-[0_0_0_1px_var(--color-line-strong)]" : "text-muted",
              )}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
