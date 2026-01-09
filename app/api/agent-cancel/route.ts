import { NextRequest, NextResponse } from 'next/server';

function getSandyConfig() {
  const baseUrl = process.env.SANDY_BASE_URL;
  const apiKey = process.env.SANDY_API_KEY;

  if (!baseUrl) {
    throw new Error('SANDY_BASE_URL is not configured');
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sandboxId } = body || {};

    if (!sandboxId) {
      return NextResponse.json({ error: 'sandboxId is required' }, { status: 400 });
    }

    const { baseUrl, apiKey } = getSandyConfig();
    const response = await fetch(`${baseUrl}/api/sandboxes/${sandboxId}/agent/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: errorText || 'Failed to cancel agent' }, { status: response.status });
    }

    return NextResponse.json({ success: true, message: 'Agent cancelled' });
  } catch (error) {
    console.error('[agent-cancel] Error:', error);
    return NextResponse.json({ error: 'Failed to cancel agent' }, { status: 500 });
  }
}
