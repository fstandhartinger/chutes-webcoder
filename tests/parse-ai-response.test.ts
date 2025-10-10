import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAIResponse } from '@/lib/ai-response';

test('parseAIResponse prefers complete file definitions and parses metadata', () => {
  const aiOutput = `
<explanation>Create a landing page</explanation>
<file path="src/App.jsx">
  <div>Incomplete
</file>
<file path="src/App.jsx">
  <div>Complete content</div>
</file>
<packages>
react-router-dom
@heroicons/react
</packages>
<command>npm run build</command>
<structure>App > Header > Hero</structure>
`;

  const parsed = parseAIResponse(aiOutput);

  assert.equal(parsed.files.length, 1, 'should capture a single file entry');
  assert.equal(parsed.files[0].path, 'src/App.jsx');
  assert.ok(parsed.files[0].content.includes('Complete content'));
  assert.equal(parsed.explanation, 'Create a landing page');
  assert.equal(parsed.structure, 'App > Header > Hero');
  assert.deepEqual(parsed.commands, ['npm run build']);
  assert.deepEqual(parsed.packages.sort(), ['@heroicons/react', 'react-router-dom']);
});
