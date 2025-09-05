import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Payload = {
  level?: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args?: string[];
  url?: string;
  userAgent?: string;
  time?: number;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;
    const level = body.level || 'log';
    const time = body.time ? new Date(body.time) : new Date();
    const ts = time.toISOString();

    const line = [
      ts,
      level.toUpperCase(),
      (body.url || '').trim(),
      ...(Array.isArray(body.args) ? body.args : []),
    ]
      .filter(Boolean)
      .join(' | ')
      .concat('\n');

    const logDir = path.join(process.cwd(), 'logs');
    const logFile = path.join(logDir, 'browser-console.log');

    await fs.promises.mkdir(logDir, { recursive: true });
    await fs.promises.appendFile(logFile, line, { encoding: 'utf8' });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Failed to write browser console log:', e);
    return NextResponse.json({ ok: false, error: 'write_failed' }, { status: 500 });
  }
}

