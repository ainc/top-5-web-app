// Confetti for the first-place podium card. The canvas covers the ranking
// panel and ignores the pointer, so names under the burst still open.
// Particles launch from the middle of that card. canvas-confetti draws on
// the main thread here so the burst stays inside this canvas.
import confetti from "canvas-confetti";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const COLORS = ["#c12029", "#ed3742", "#fde8ea", "#f5c518", "#ffffff"];

export type WinnerConfettiHandle = {
  burst: (particleCount: number) => void;
};

export const WinnerConfetti = forwardRef<WinnerConfettiHandle, { winnerKey: string }>(function WinnerConfetti({ winnerKey }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fireRef = useRef<confetti.CreateTypes | null>(null);
  const lastBurst = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fire = confetti.create(canvas, { resize: true, useWorker: false });
    fireRef.current = fire;
    return () => {
      fire.reset();
      fireRef.current = null;
    };
  }, []);

  const burst = (particleCount: number) => {
    const canvas = canvasRef.current;
    const fire = fireRef.current;
    if (!canvas || !fire) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tile = canvas.parentElement?.querySelector<HTMLElement>('.podium-card[data-place="1"]');
    if (!tile) return;
    const host = canvas.getBoundingClientRect();
    const box = tile.getBoundingClientRect();
    if (host.width === 0 || host.height === 0 || box.width === 0) return;
    lastBurst.current = Date.now();
    void fire({
      particleCount,
      angle: 90,
      spread: 78,
      startVelocity: 28,
      gravity: 0.9,
      ticks: 200,
      scalar: 0.9,
      origin: {
        x: (box.left + box.width / 2 - host.left) / host.width,
        y: (box.top + box.height * 0.42 - host.top) / host.height,
      },
      colors: COLORS,
      disableForReducedMotion: true,
    });
  };

  useImperativeHandle(ref, () => ({
    burst: (particleCount: number) => {
      if (Date.now() - lastBurst.current < 800) return;
      burst(particleCount);
    },
  }));

  useEffect(() => {
    if (!winnerKey) return;
    const frame = requestAnimationFrame(() => burst(80));
    return () => cancelAnimationFrame(frame);
  }, [winnerKey]);

  return <canvas ref={canvasRef} className="winner-confetti" aria-hidden="true" />;
});
