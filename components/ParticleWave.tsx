'use client';

import { useEffect, useRef } from 'react';

// Aurora-like, subtle particle veil for the start page.
// Uses a soft gradient veil plus a sparse, slow-moving dot grid.
export default function ParticleWave() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { alpha: true })!;
    let mounted = true;

    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const resize = () => {
      if (!mounted) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const spacing = 30; // pixels between dots (screen space)
    const amplitude = 6; // vertical displacement
    const speed = 0.12; // animation speed (slower for elegance)

    const draw = (tMs: number) => {
      const t = tMs * 0.001 * speed;
      const { width, height } = canvas;
      // Soft aurora veil
      ctx.clearRect(0, 0, width, height);
      const veil = ctx.createLinearGradient(0, height * 0.2, 0, height);
      veil.addColorStop(0.0, 'rgba(12, 14, 24, 0.00)');
      veil.addColorStop(0.6, 'rgba(17, 20, 34, 0.25)');
      veil.addColorStop(1.0, 'rgba(20, 24, 40, 0.38)');
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // Color gradient purple → magenta
      const colorA = [99, 102, 241];  // indigo-500
      const colorB = [236, 72, 153];  // pink-500

      const cols = Math.ceil((width / dpr) / spacing) + 2;
      const rows = Math.ceil((height / dpr) / spacing) + 2;
      const phaseY = t * 2.0;

      for (let y = 0; y < rows; y++) {
        const rowY = y * spacing + 6;
        const v = y / Math.max(1, rows - 1);
        const r = Math.round(colorA[0] + (colorB[0] - colorA[0]) * v);
        const g2 = Math.round(colorA[1] + (colorB[1] - colorA[1]) * v);
        const b = Math.round(colorA[2] + (colorB[2] - colorA[2]) * v);
        ctx.fillStyle = `rgba(${r},${g2},${b},0.35)`;

        for (let x = 0; x < cols; x++) {
          const colX = x * spacing + 6;
          // Two-phase gentle wave
          const dy = Math.sin(x * 0.6 + phaseY) * amplitude + Math.cos(y * 0.8 + t * 1.3) * (amplitude * 0.6);
          ctx.beginPath();
          ctx.arc(colX, rowY + dy, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[40vh]">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}


