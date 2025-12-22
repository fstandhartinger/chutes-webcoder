'use client';

import React, { useCallback, useEffect, useRef } from 'react';

type ParticleWaveProps = {
  className?: string;
  /**
   * Pixel ratio cap to keep CPU/GPU work predictable. Defaults to 1.5
   */
  maxDevicePixelRatio?: number;
};

/**
 * A highly optimized, subtle particle-wave animation rendered on a 2D canvas.
 *
 * Design goals:
 * - Elegantly evoke a 3D undulating grid using small dots
 * - Aurora-like deep purple → magenta with hints of blue
 * - Covers lower area; non-interactive; pointer-events disabled
 * - Prioritize performance: capped DPR, adaptive grid density, pauses when offscreen/hidden,
 *   respects prefers-reduced-motion, and minimal allocations per frame
 */
export default function ParticleWave({ className, maxDevicePixelRatio = 1.5 }: ParticleWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const runningRef = useRef<boolean>(false);
  const reduceMotionRef = useRef<boolean>(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Precomputed grid data
  const gridRef = useRef<{
    positions: Float32Array; // [x0, y0, x1, y1, ...] in CSS pixels
    paletteIndexByPoint: Uint8Array; // palette bucket 0..(palette.length-1)
    groups: number[][]; // point indices grouped by palette index for batched drawing
    cols: number;
    rows: number;
    baseRadius: number;
    amplitude: number;
  } | null>(null);

  const paletteRef = useRef<string[]>([]);
  const jitterRef = useRef<Float32Array | null>(null);

  const pickPalette = useCallback(() => {
    // Uniform opacity/brightness across X: generate HSL with fixed lightness
    // and saturation. Vary only the hue from deep purple → magenta.
    const steps = 40;
    const hueStart = 265; // deep purple
    const hueEnd = 305;   // magenta
    const saturation = 95;
    const lightness = 68; // constant to keep perceived opacity consistent
    const pal: string[] = [];
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const h = hueStart + (hueEnd - hueStart) * t;
      pal.push(`hsl(${h}deg ${saturation}% ${lightness}%)`);
    }
    paletteRef.current = pal;
    // Stable per-group jitter to vary hue dynamics without per-point cost
    const jit = new Float32Array(steps);
    for (let i = 0; i < steps; i++) jit[i] = Math.random();
    jitterRef.current = jit;
  }, []);

  const createGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const canvas = ctx.canvas;

    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDevicePixelRatio);
    const width = Math.floor(cssWidth * dpr);
    const height = Math.floor(cssHeight * dpr);
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels

    // Adaptive grid density based on size
    // Slightly denser than before while staying performant
    const targetPoints = Math.min(10000, Math.max(3000, Math.floor((cssWidth * cssHeight) / 6_000)));
    const aspect = cssWidth / Math.max(cssHeight, 1);
    let cols = Math.round(Math.sqrt(targetPoints * aspect));
    let rows = Math.round(targetPoints / Math.max(cols, 1));

    cols = Math.max(90, Math.min(210, cols));
    rows = Math.max(40, Math.min(130, rows));

    const xStep = cssWidth / (cols - 1);
    const yStep = cssHeight / (rows - 1);
    const baseRadius = Math.max(0.5, Math.min(1.2, Math.min(xStep, yStep) * 0.14));

    const positions = new Float32Array(cols * rows * 2);
    const paletteIndexByPoint = new Uint8Array(cols * rows);
    const groups: number[][] = Array.from({ length: paletteRef.current.length }, () => []);

    const palLen = paletteRef.current.length;
    let p = 0;
    for (let j = 0; j < rows; j++) {
      const y = j * yStep;
      for (let i = 0; i < cols; i++) {
        const x = i * xStep;
        positions[p++] = x;
        positions[p++] = y;
        // Color bucket based on x ratio for stable grouping
        const idx = Math.min(palLen - 1, Math.floor((i / (cols - 1)) * palLen));
        paletteIndexByPoint[j * cols + i] = idx as number;
        groups[idx].push(j * cols + i);
      }
    }

    gridRef.current = {
      positions,
      paletteIndexByPoint,
      groups,
      cols,
      rows,
      baseRadius,
      amplitude: Math.max(8, cssHeight * 0.08),
    };
  }, [maxDevicePixelRatio]);

  const drawFrame = (ctx: CanvasRenderingContext2D, t: number) => {
    const grid = gridRef.current;
    if (!grid) return;

    ctx.clearRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);

    const { positions, groups, cols, rows, baseRadius, amplitude } = grid;

    // Slow, gentle waves
    const time = t * 0.00010; // even slower movement
    const freqX = 1.2 / cols;
    const freqY = 1.8 / rows;

    // Use normal compositing to keep opacity uniform horizontally
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 2; // tiny glow without additive brightening
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Batch by color group for fewer state changes and fills
    for (let g = 0; g < groups.length; g++) {
      const indices = groups[g];
      if (indices.length === 0) continue;
      // Dynamic aurora-like color with more variety (preferring purple), occasional cyan
      const steps = paletteRef.current.length || 40;
      const jitter = (jitterRef.current && jitterRef.current[g % steps]) || 0;
      const phase = (g / steps) * Math.PI * 2 + jitter * 6;
      const baseHue = 278 + 26 * Math.sin(phase + time * 0.18) + 4 * Math.sin(phase * 1.7 + time * 0.07);
      const cyanInfluenceRaw = Math.sin(g * 0.24 + time * 0.11 + jitter * 9);
      const cyanInfluence = Math.max(0, (cyanInfluenceRaw - 0.2) / 0.8); // slightly more frequent than before
      const hue = baseHue * (1 - 0.45 * cyanInfluence) + 195 * (0.45 * cyanInfluence);
      const saturation = 86 + 8 * Math.sin(phase * 0.9 + time * 0.08);
      const lightness = 65 + 2 * Math.sin(phase * 0.5 + time * 0.04);
      ctx.fillStyle = `hsl(${hue}deg ${saturation}% ${lightness}%)`;
      ctx.globalAlpha = 0.65; // slightly more opaque
      ctx.beginPath();
      for (let k = 0; k < indices.length; k++) {
        const idx = indices[k];
        const i = idx % cols;
        const j = (idx / cols) | 0;
        const px = positions[idx * 2 + 0];
        const py = positions[idx * 2 + 1];

        // More twisted aurora-like waves with enhanced complexity
        const wave1 = Math.sin((i + time * 20) * Math.PI * freqX) * Math.cos((j - time * 15) * Math.PI * freqY);
        const wave2 = Math.sin((i * 1.9 - time * 13) * Math.PI * freqX * 0.55) * Math.cos((j * 0.6 + time * 26) * Math.PI * freqY * 2.0);
        const wave3 = Math.sin((i * 0.35 + time * 31) * Math.PI * freqX * 2.4) * Math.cos((j * 2.0 - time * 8) * Math.PI * freqY * 0.8);
        const wave4 = Math.sin((i * 2.3 + time * 19) * Math.PI * freqX * 0.35) * Math.cos((j * 1.0 - time * 23) * Math.PI * freqY * 1.7);
        const wave = wave1 * 0.45 + wave2 * 0.28 + wave3 * 0.18 + wave4 * 0.14;
        
        // Enhanced chaos/randomness for more organic distribution
        const chaos = Math.sin(i * 0.24 + j * 0.33) * Math.cos(i * 0.47 - j * 0.19) * 0.28 +
                      Math.sin(i * 0.12 - j * 0.29) * Math.cos(i * 0.39 + j * 0.25) * 0.14;

        const offset = (wave + chaos) * amplitude * 0.9 + Math.sin((i * 0.15 + time * 2.5)) * 3;
        const y = py + offset;
        const r = baseRadius + (Math.abs(wave) + Math.abs(chaos)) * 0.45; // tiny bit bigger

        // Accumulate small arcs in a single path per color
        ctx.moveTo(px + r, y);
        ctx.arc(px, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Apply vertical fade mask
    ctx.globalCompositeOperation = 'destination-in';
    // Mask: fully transparent at top, fully visible at bottom
    const mask = ctx.createLinearGradient(0, 0, 0, ctx.canvas.clientHeight);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(0.6, 'rgba(0,0,0,0.6)');
    mask.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return;

    pickPalette();

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotionRef.current = mql.matches;
    const handleMQ = () => (reduceMotionRef.current = mql.matches);
    mql.addEventListener?.('change', handleMQ);

    const handleResize = () => {
      createGrid(ctx);
    };
    handleResize();
    window.addEventListener('resize', handleResize, { passive: true });

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        runningRef.current = false;
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      } else if (document.visibilityState === 'visible') {
        runningRef.current = true;
        start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Pause when scrolled out of view
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio > 0.1) {
          runningRef.current = true;
          start();
        } else {
          runningRef.current = false;
          if (frameRef.current) cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
      },
      { threshold: [0, 0.1, 0.5, 1] }
    );
    observerRef.current.observe(canvas);

    let lastTime = performance.now();
    let accumulator = 0; // frame skipper for low CPU
    const targetFPS = 30; // gentle, enough for smoothness
    const frameInterval = 1000 / targetFPS;

    const loop = (now: number) => {
      if (!runningRef.current) return;
      frameRef.current = requestAnimationFrame(loop);
      const dt = now - lastTime;
      lastTime = now;
      accumulator += dt;

      const animate = !reduceMotionRef.current;
      if (!animate) {
        // Draw one static frame occasionally
        if (accumulator >= 500) {
          drawFrame(ctx, now);
          accumulator = 0;
        }
        return;
      }

      // Skip frames if we are ahead to keep CPU low
      if (accumulator < frameInterval) return;
      accumulator %= frameInterval; // leave fractional remainder to keep time coherent
      drawFrame(ctx, now);
    };

    const start = () => {
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(loop);
    };
    runningRef.current = true;
    start();

    return () => {
      runningRef.current = false;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', onVisibility);
      mql.removeEventListener?.('change', handleMQ);
      observerRef.current?.disconnect();
    };
  }, [createGrid, pickPalette]);

  return (
    <div className={[
      'pointer-events-none select-none bg-[color:var(--color-background)]',
      className || '',
    ].join(' ')}>
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}

