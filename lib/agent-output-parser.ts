/**
 * Agent Output Parser
 *
 * Parses and formats output from various CLI coding agents (Claude Code, Codex, Aider)
 * into user-friendly chat messages.
 */

export interface ParsedMessage {
  type: 'user-friendly' | 'status' | 'thinking' | 'tool-use' | 'error' | 'code' | 'skip';
  content: string;
  metadata?: {
    toolName?: string;
    filePath?: string;
    thinking?: boolean;
    duration?: number;
  };
}

/**
 * Parse Claude Code stream-json format
 * Claude Code outputs JSON lines with various event types
 */
export function parseClaudeCodeOutput(data: any): ParsedMessage {
  // Handle raw text output (non-JSON)
  if (typeof data === 'string') {
    const cleaned = cleanAgentOutput(data);
    if (cleaned) {
      return { type: 'user-friendly', content: cleaned };
    }
    return { type: 'skip', content: '' };
  }

  // Handle numeric data (often just 0 for init)
  if (typeof data === 'number') {
    return { type: 'skip', content: '' };
  }

  // Handle null/undefined
  if (data === null || data === undefined) {
    return { type: 'skip', content: '' };
  }

  // Handle system init messages - skip these as they're internal
  if (data.type === 'system') {
    return { type: 'skip', content: '' };
  }

  // Handle user messages (tool results) - skip these
  if (data.type === 'user') {
    return { type: 'skip', content: '' };
  }

  // Handle result messages - skip these
  if (data.type === 'result') {
    // Check if it has a useful message
    if (data.result && typeof data.result === 'string' && !data.result.includes('"type":')) {
      return { type: 'user-friendly', content: data.result };
    }
    return { type: 'skip', content: '' };
  }

  // Handle assistant messages
  if (data.type === 'assistant' && data.message?.content) {
    const content = data.message.content;
    const messages: string[] = [];
    const toolUses: ParsedMessage[] = [];

    for (const block of content) {
      if (block.type === 'thinking') {
        // Thinking blocks are internal - just show status
        return {
          type: 'thinking',
          content: 'Thinking...',
          metadata: { thinking: true }
        };
      }

      if (block.type === 'text' && block.text) {
        // Only add non-empty, non-JSON text
        const text = block.text.trim();
        if (text && !text.startsWith('{') && !text.includes('"type":')) {
          messages.push(text);
        }
      }

      if (block.type === 'tool_use') {
        const toolName = block.name || '';
        const normalizedTool = toolName.toLowerCase();
        const input = block.input || {};

        // Format tool use nicely
        if (normalizedTool === 'write' || normalizedTool === 'write_to_file') {
          toolUses.push({
            type: 'tool-use',
            content: `Creating file: ${input.file_path || input.path || 'file'}`,
            metadata: { toolName, filePath: input.file_path || input.path }
          });
        } else if (normalizedTool === 'edit') {
          toolUses.push({
            type: 'tool-use',
            content: `Editing file: ${input.file_path || 'file'}`,
            metadata: { toolName, filePath: input.file_path }
          });
        } else if (normalizedTool === 'read') {
          const filePath = input.file_path || input.path;
          if (filePath) {
            toolUses.push({
              type: 'tool-use',
              content: `Reading file: ${filePath}`,
              metadata: { toolName, filePath }
            });
          }
        } else if (normalizedTool === 'bash') {
          const cmd = input.command || '';
          // Clean up the command display - show meaningful commands
          if (
            cmd.includes('npm ') ||
            cmd.includes('pnpm ') ||
            cmd.includes('yarn ') ||
            cmd.includes('bun ') ||
            cmd.startsWith('ls ') ||
            cmd.startsWith('ls\t') ||
            cmd.startsWith('ls\n') ||
            cmd.startsWith('find ') ||
            cmd.startsWith('rg ') ||
            cmd.startsWith('grep ') ||
            cmd.startsWith('cat ') ||
            cmd.startsWith('mkdir ') ||
            cmd.startsWith('pwd')
          ) {
            const shortCmd = cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd;
            toolUses.push({
              type: 'tool-use',
              content: `Running: ${shortCmd}`,
              metadata: { toolName }
            });
          }
        } else if (normalizedTool === 'glob') {
          const pattern = input.pattern || input.glob || input.path || '';
          toolUses.push({
            type: 'tool-use',
            content: pattern ? `Searching files: ${pattern}` : 'Searching files...',
            metadata: { toolName }
          });
        } else if (normalizedTool === 'grep') {
          const pattern = input.pattern || input.query || '';
          const path = input.path || input.directory || '';
          const details = [pattern ? `"${pattern}"` : '', path ? `in ${path}` : '']
            .filter(Boolean)
            .join(' ');
          toolUses.push({
            type: 'tool-use',
            content: details ? `Searching ${details}` : 'Searching workspace...',
            metadata: { toolName }
          });
        } else if (normalizedTool === 'task') {
          const label = input.title || input.description || input.prompt || input.task || 'Task';
          toolUses.push({
            type: 'tool-use',
            content: `Working on: ${label}`,
            metadata: { toolName }
          });
        } else if (normalizedTool === 'taskoutput') {
          const summary = input.output || input.result || input.message;
          if (summary) {
            const trimmed = String(summary).trim();
            toolUses.push({
              type: 'tool-use',
              content: trimmed.length > 120 ? `Task update: ${trimmed.slice(0, 120)}…` : `Task update: ${trimmed}`,
              metadata: { toolName }
            });
          }
        } else if (normalizedTool === 'exitplan') {
          toolUses.push({
            type: 'tool-use',
            content: 'Finalizing plan...',
            metadata: { toolName }
          });
        }
        // Skip other tool uses to reduce noise
      }
    }

    // Prefer returning tool uses if we have them (more informative during generation)
    if (toolUses.length > 0) {
      return toolUses[0];
    }

    // Return text messages
    if (messages.length > 0) {
      return {
        type: 'user-friendly',
        content: messages.join('\n')
      };
    }

    // Skip if no useful content
    return { type: 'skip', content: '' };
  }

  // Handle tool results - skip these
  if (data.type === 'tool_result') {
    return { type: 'skip', content: '' };
  }

  // Handle errors
  if (data.type === 'error') {
    return {
      type: 'error',
      content: data.error || data.message || 'An error occurred'
    };
  }

  // Default: skip unrecognized data
  return { type: 'skip', content: '' };
}

/**
 * Parse plain text output from agents (Codex, Aider)
 */
export function parsePlainTextOutput(text: string): ParsedMessage {
  const cleaned = cleanAgentOutput(text);
  if (!cleaned) {
    return { type: 'skip', content: '' };
  }

  // Check if this looks like an error
  if (cleaned.toLowerCase().includes('error:') ||
      cleaned.toLowerCase().includes('failed:') ||
      cleaned.toLowerCase().includes('exception:')) {
    return { type: 'error', content: cleaned };
  }

  // Check if this is a status update
  if (cleaned.startsWith('►') ||
      cleaned.startsWith('✓') ||
      cleaned.startsWith('✗') ||
      cleaned.startsWith('...') ||
      cleaned.toLowerCase().startsWith('reading') ||
      cleaned.toLowerCase().startsWith('writing') ||
      cleaned.toLowerCase().startsWith('running')) {
    return { type: 'status', content: cleaned };
  }

  return { type: 'user-friendly', content: cleaned };
}

/**
 * Clean agent output by removing unwanted artifacts
 */
export function cleanAgentOutput(text: string): string {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text;

  // Remove ANSI escape codes
  cleaned = cleaned.replace(/\x1b\[[0-9;]*m/g, '');
  cleaned = cleaned.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

  // Remove carriage returns
  cleaned = cleaned.replace(/\r/g, '');

  // Remove control characters
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  // Check if this looks like raw JSON or JSON fragment - if so, try to extract meaningful content
  const trimmed = cleaned.trim();

  // Skip obvious JSON fragments that start with quotes (partial JSON lines)
  if (trimmed.startsWith('"') && (
      trimmed.includes('"type":') ||
      trimmed.includes('"message":') ||
      trimmed.includes('"content":') ||
      trimmed.includes('"session_id":') ||
      trimmed.includes('"subtype":')
  )) {
    return '';
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('"type":')) {
    try {
      // Try to parse and extract useful info
      let jsonStr = trimmed;
      if (jsonStr.startsWith('"type":')) {
        jsonStr = '{' + jsonStr;
      }
      // Find the end of the JSON object
      let depth = 0;
      let endIdx = 0;
      for (let i = 0; i < jsonStr.length; i++) {
        if (jsonStr[i] === '{') depth++;
        if (jsonStr[i] === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      if (endIdx > 0) {
        jsonStr = jsonStr.substring(0, endIdx);
      }

      const parsed = JSON.parse(jsonStr);

      // Extract text content from assistant messages
      if (parsed.message?.content) {
        const texts: string[] = [];
        for (const block of parsed.message.content) {
          if (block.type === 'text' && block.text) {
            texts.push(block.text);
          }
        }
        if (texts.length > 0) {
          return texts.join('\n').trim();
        }
      }

      // If it's a system init message, skip it
      if (parsed.type === 'system' && parsed.subtype === 'init') {
        return '';
      }

      // If we couldn't extract anything useful, return empty
      return '';
    } catch {
      // If JSON parsing fails, check if it starts with a known prefix
      if (cleaned.includes('"type":"system"') ||
          cleaned.includes('"subtype":"init"') ||
          cleaned.includes('"tools":')) {
        // This is a system message, skip it
        return '';
      }

      // Check for partial assistant message with text
      const textMatch = cleaned.match(/"text"\s*:\s*"([^"]+)"/);
      if (textMatch) {
        return textMatch[1].trim();
      }
    }
  }

  // Remove common noise patterns
  const noisePatterns = [
    /^\s*\d+\|\s*/, // Line numbers like "1| "
    /^\s*>\s*$/, // Just a ">" prompt
    /^\s*\$\s*$/, // Just a "$" prompt
    /^\s*claude\s+/i, // Claude command prefix
    /^\s*codex\s+/i, // Codex command prefix
    /^\s*aider\s+/i, // Aider command prefix
  ];

  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

/**
 * Check if a message should be displayed to the user
 */
export function shouldDisplayMessage(parsed: ParsedMessage): boolean {
  if (parsed.type === 'skip') return false;
  if (!parsed.content || parsed.content.trim().length === 0) return false;

  // Skip very short status messages
  if (parsed.type === 'status' && parsed.content.length < 5) return false;

  return true;
}

/**
 * SSE JSON buffer for handling chunked JSON across multiple SSE events
 */
export class SSEJsonBuffer {
  private buffer: string = '';
  private incompleteJson: string = '';

  /**
   * Add a chunk to the buffer and return any complete JSON objects
   */
  addChunk(chunk: string): { jsonObjects: any[]; lines: string[] } {
    this.buffer += chunk;
    const jsonObjects: any[] = [];
    const lines: string[] = [];

    // Split by newlines but keep track of incomplete JSON
    const allLines = this.buffer.split('\n');
    this.buffer = '';

    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      const isLastLine = i === allLines.length - 1;

      if (line.startsWith('data: ')) {
        const jsonStr = this.incompleteJson + line.slice(6);

        try {
          const parsed = JSON.parse(jsonStr);
          jsonObjects.push(parsed);
          this.incompleteJson = '';
        } catch (e) {
          // If this is the last line and parsing failed, it might be incomplete
          if (isLastLine) {
            this.incompleteJson = jsonStr;
          } else {
            // Try to see if it's a complete but malformed line
            // If so, try to extract what we can
            const extracted = this.tryExtractJson(jsonStr);
            if (extracted) {
              jsonObjects.push(extracted);
              this.incompleteJson = '';
            } else {
              // Accumulate for next chunk
              this.incompleteJson = jsonStr;
            }
          }
        }
      } else if (line.trim() && !line.startsWith(':')) {
        // Non-SSE line
        lines.push(line);
      }
    }

    return { jsonObjects, lines };
  }

  /**
   * Try to extract a valid JSON object from a potentially truncated string
   */
  private tryExtractJson(str: string): any | null {
    // Find matching braces
    let depth = 0;
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < str.length; i++) {
      if (str[i] === '{') {
        if (startIdx === -1) startIdx = i;
        depth++;
      }
      if (str[i] === '}') {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          endIdx = i + 1;
          break;
        }
      }
    }

    if (startIdx !== -1 && endIdx !== -1) {
      try {
        return JSON.parse(str.substring(startIdx, endIdx));
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Check if there's incomplete JSON waiting
   */
  hasIncomplete(): boolean {
    return this.incompleteJson.length > 0;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = '';
    this.incompleteJson = '';
  }
}
