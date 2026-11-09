import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "@/components/start-countdown";

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  tilt: number;
  color: string;
};

const colors = ["#e0262a", "#ff6b6b", "#ffb4a8", "#f4ecec", "#5fd0d6", "#9be6ea"];
const lifeMs = 3200;
const fadeMs = 900;
const gravity = 1100;

const between = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * A burst of confetti when a workout ends: two cannons at the bottom corners fire up and inward, and the pieces tumble down
 * and fade. It is a canvas drawn by a short animation loop that removes itself, so it costs nothing afterwards. It never
 * takes a tap (it does not catch pointer events), and a person who asked for less motion does not get it.
 */
export function Confetti({ onDone }: { onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const finished = useRef(onDone);
  finished.current = onDone;

  useEffect(() => {
    const el = canvas.current;
    if (!el || prefersReducedMotion()) {
      finished.current();
      return;
    }
    const ctx = el.getContext("2d")!;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    el.width = w * ratio;
    el.height = h * ratio;
    ctx.scale(ratio, ratio);

    const pieces: Piece[] = [];
    // Two cannons, one at each bottom corner, and a few from the top for the middle of the screen.
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 70; i++) {
        // Angle above the floor, 55 to 82 degrees: steep, so the pieces climb before they fall.
        const angle = (between(55, 82) * Math.PI) / 180;
        const speed = between(700, 1500) * Math.min(1.2, h / 800 + 0.3);
        pieces.push({
          x: side === -1 ? 0 : w,
          y: h,
          // The left cannon fires to the right and the right one to the left.
          vx: Math.cos(angle) * speed * (side === -1 ? 1 : -1),
          vy: -Math.sin(angle) * speed,
          size: between(6, 11),
          rotation: between(0, Math.PI * 2),
          spin: between(-9, 9),
          tilt: between(0, Math.PI * 2),
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    }
    for (let i = 0; i < 40; i++) {
      pieces.push({
        x: between(w * 0.2, w * 0.8),
        y: between(-40, h * 0.1),
        vx: between(-120, 120),
        vy: between(50, 260),
        size: between(6, 10),
        rotation: between(0, Math.PI * 2),
        spin: between(-7, 7),
        tilt: between(0, Math.PI * 2),
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    const start = performance.now();
    let last = start;
    let frame = 0;
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const age = now - start;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = age > lifeMs - fadeMs ? Math.max(0, (lifeMs - age) / fadeMs) : 1;
      for (const p of pieces) {
        p.vy += gravity * dt;
        // Air drag, so the pieces slow down and flutter instead of falling like stones.
        p.vx *= 1 - 1.6 * dt;
        p.vy *= 1 - 0.9 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;
        p.tilt += 6 * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        // Scaling one side makes it look like a flat piece turning over.
        ctx.scale(1, Math.cos(p.tilt));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (age < lifeMs) frame = requestAnimationFrame(draw);
      else finished.current();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return createPortal(
    <canvas
      ref={canvas}
      data-testid="confetti"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70] h-full w-full"
    />,
    document.body,
  );
}
