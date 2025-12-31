import test from 'node:test';
import assert from 'node:assert/strict';

import { SSEJsonBuffer } from '@/lib/agent-output-parser';

test('SSEJsonBuffer handles JSON lines split across chunks', () => {
  const buffer = new SSEJsonBuffer();
  const first = 'data: {"type":"complete","exitCode":0,"success"';
  const second = ':true}\n\n';

  const result1 = buffer.addChunk(first);
  assert.equal(result1.jsonObjects.length, 0, 'no JSON objects should be parsed yet');

  const result2 = buffer.addChunk(second);
  assert.equal(result2.jsonObjects.length, 1, 'should parse split JSON event');
  assert.equal(result2.jsonObjects[0].type, 'complete');
  assert.equal(result2.jsonObjects[0].success, true);
});

test('SSEJsonBuffer parses multiple events in one chunk', () => {
  const buffer = new SSEJsonBuffer();
  const chunk = [
    'data: {"type":"status","message":"Hello"}',
    '',
    'data: {"type":"complete","exitCode":0,"success":true}',
    '',
    '',
  ].join('\n');

  const result = buffer.addChunk(chunk);
  assert.equal(result.jsonObjects.length, 2, 'should parse both events');
  assert.equal(result.jsonObjects[0].type, 'status');
  assert.equal(result.jsonObjects[1].type, 'complete');
});

test('SSEJsonBuffer flushes final event without delimiter', () => {
  const buffer = new SSEJsonBuffer();
  buffer.addChunk('data: {"type":"complete","exitCode":0,"success":true}');

  const result = buffer.flush();
  assert.equal(result.jsonObjects.length, 1, 'should parse final event');
  assert.equal(result.jsonObjects[0].type, 'complete');
});
