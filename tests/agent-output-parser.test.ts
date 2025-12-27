/**
 * Tests for Agent Output Parser
 *
 * Run with: npx tsx tests/agent-output-parser.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseClaudeCodeOutput,
  cleanAgentOutput,
  shouldDisplayMessage,
} from '../lib/agent-output-parser';

// Sample Claude Code output messages
const SYSTEM_INIT_MESSAGE = {
  type: 'system',
  subtype: 'init',
  cwd: '/workspace',
  session_id: 'abc123',
  tools: ['Read', 'Write', 'Edit', 'Bash'],
  model: 'zai-org/GLM-4.7-TEE',
};

const ASSISTANT_THINKING_MESSAGE = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'thinking',
        thinking: 'The user wants me to create a Tic Tac Toe game...',
      },
    ],
    id: 'msg_123',
    model: 'zai-org/GLM-4.7-TEE',
    role: 'assistant',
  },
  session_id: 'abc123',
};

const ASSISTANT_TEXT_MESSAGE = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'text',
        text: "I'll create a Tic Tac Toe game for you using React and Vite.",
      },
    ],
    id: 'msg_124',
    model: 'zai-org/GLM-4.7-TEE',
    role: 'assistant',
  },
  session_id: 'abc123',
};

const ASSISTANT_TOOL_USE_MESSAGE = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'tool_use',
        name: 'Write',
        input: {
          file_path: '/workspace/src/App.jsx',
          content: 'const App = () => { return <div>Hello</div>; }',
        },
      },
    ],
    id: 'msg_125',
    model: 'zai-org/GLM-4.7-TEE',
    role: 'assistant',
  },
  session_id: 'abc123',
};

const USER_TOOL_RESULT_MESSAGE = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        content: 'File written successfully',
        tool_use_id: 'tool_123',
      },
    ],
  },
  session_id: 'abc123',
};

test('parseClaudeCodeOutput - skips system init messages', () => {
  const result = parseClaudeCodeOutput(SYSTEM_INIT_MESSAGE);
  assert.strictEqual(result.type, 'skip');
  assert.strictEqual(shouldDisplayMessage(result), false);
});

test('parseClaudeCodeOutput - handles thinking messages', () => {
  const result = parseClaudeCodeOutput(ASSISTANT_THINKING_MESSAGE);
  assert.strictEqual(result.type, 'thinking');
  assert.strictEqual(result.content, 'Thinking...');
  assert.strictEqual(result.metadata?.thinking, true);
});

test('parseClaudeCodeOutput - extracts text from assistant messages', () => {
  const result = parseClaudeCodeOutput(ASSISTANT_TEXT_MESSAGE);
  assert.strictEqual(result.type, 'user-friendly');
  assert.ok(result.content.includes('Tic Tac Toe'));
  assert.strictEqual(shouldDisplayMessage(result), true);
});

test('parseClaudeCodeOutput - formats tool use messages', () => {
  const result = parseClaudeCodeOutput(ASSISTANT_TOOL_USE_MESSAGE);
  assert.strictEqual(result.type, 'tool-use');
  assert.ok(result.content.includes('Creating file'));
  assert.ok(result.content.includes('App.jsx'));
  assert.strictEqual(result.metadata?.toolName, 'Write');
  assert.strictEqual(result.metadata?.filePath, '/workspace/src/App.jsx');
});

test('parseClaudeCodeOutput - skips user tool result messages', () => {
  const result = parseClaudeCodeOutput(USER_TOOL_RESULT_MESSAGE);
  assert.strictEqual(result.type, 'skip');
  assert.strictEqual(shouldDisplayMessage(result), false);
});

test('parseClaudeCodeOutput - handles numeric data (init 0)', () => {
  const result = parseClaudeCodeOutput(0);
  assert.strictEqual(result.type, 'skip');
});

test('parseClaudeCodeOutput - handles null/undefined', () => {
  assert.strictEqual(parseClaudeCodeOutput(null).type, 'skip');
  assert.strictEqual(parseClaudeCodeOutput(undefined).type, 'skip');
});

test('cleanAgentOutput - removes ANSI escape codes', () => {
  const input = '\x1b[32mSuccess!\x1b[0m';
  const result = cleanAgentOutput(input);
  assert.strictEqual(result, 'Success!');
});

test('cleanAgentOutput - filters out JSON fragments', () => {
  const jsonFragment = '{"type":"system","subtype":"init","tools":["Read"]}';
  const result = cleanAgentOutput(jsonFragment);
  assert.strictEqual(result, '');
});

test('cleanAgentOutput - filters out partial JSON starting with quote', () => {
  const partialJson = '"type":"assistant","message":{"content":[]';
  const result = cleanAgentOutput(partialJson);
  assert.strictEqual(result, '');
});

test('cleanAgentOutput - extracts text from JSON message content', () => {
  const jsonWithText = '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello World"}]}}';
  const result = cleanAgentOutput(jsonWithText);
  assert.strictEqual(result, 'Hello World');
});

test('shouldDisplayMessage - returns false for skip type', () => {
  assert.strictEqual(shouldDisplayMessage({ type: 'skip', content: '' }), false);
});

test('shouldDisplayMessage - returns false for empty content', () => {
  assert.strictEqual(shouldDisplayMessage({ type: 'user-friendly', content: '' }), false);
  assert.strictEqual(shouldDisplayMessage({ type: 'user-friendly', content: '   ' }), false);
});

test('shouldDisplayMessage - returns true for valid content', () => {
  assert.strictEqual(shouldDisplayMessage({ type: 'user-friendly', content: 'Hello' }), true);
  assert.strictEqual(shouldDisplayMessage({ type: 'tool-use', content: 'Creating file' }), true);
});

console.log('All agent output parser tests passed!');
