import type { ProjectState } from '@/types/project';

const PROJECT_STATE_PATH = '.chutes/project.json';
const DEFAULT_DEV_SERVER_COMMAND = 'npm run dev -- --host 0.0.0.0 --port 5173';

export function buildDefaultProjectState(projectId: string): ProjectState {
  const now = new Date().toISOString();
  return {
    projectId,
    createdAt: now,
    updatedAt: now,
    conversation: {
      messages: []
    },
    conversationContext: {
      scrapedWebsites: [],
      generatedComponents: [],
      appliedCode: [],
      currentProject: '',
      lastGeneratedCode: undefined
    },
    checkpoints: [],
    devServer: {
      command: DEFAULT_DEV_SERVER_COMMAND,
      port: 5173,
      processMatch: 'vite'
    }
  };
}

export function normalizeProjectState(input: Partial<ProjectState> | null | undefined, projectId: string): ProjectState {
  const fallback = buildDefaultProjectState(projectId);
  if (!input) {
    return fallback;
  }

  const messages = Array.isArray(input.conversation?.messages) ? input.conversation?.messages : [];
  const trimmedMessages = messages.slice(-200);

  return {
    projectId: input.projectId || projectId,
    createdAt: input.createdAt || fallback.createdAt,
    updatedAt: new Date().toISOString(),
    conversation: {
      messages: trimmedMessages
    },
    conversationContext: input.conversationContext
      ? {
          scrapedWebsites: Array.isArray(input.conversationContext.scrapedWebsites)
            ? input.conversationContext.scrapedWebsites
            : [],
          generatedComponents: Array.isArray(input.conversationContext.generatedComponents)
            ? input.conversationContext.generatedComponents
            : [],
          appliedCode: Array.isArray(input.conversationContext.appliedCode)
            ? input.conversationContext.appliedCode
            : [],
          currentProject: input.conversationContext.currentProject || '',
          lastGeneratedCode: input.conversationContext.lastGeneratedCode
        }
      : fallback.conversationContext,
    checkpoints: Array.isArray(input.checkpoints) ? input.checkpoints : [],
    devServer: input.devServer || fallback.devServer,
    github: input.github,
    netlify: input.netlify
  };
}

export async function readProjectState(provider: {
  readFile: (path: string) => Promise<string>;
}, projectId: string): Promise<ProjectState> {
  try {
    const raw = await provider.readFile(PROJECT_STATE_PATH);
    const parsed = JSON.parse(raw);
    return normalizeProjectState(parsed, projectId);
  } catch {
    return buildDefaultProjectState(projectId);
  }
}

export async function writeProjectState(provider: {
  writeFile: (path: string, content: string) => Promise<void>;
}, projectId: string, state: Partial<ProjectState>): Promise<ProjectState> {
  const normalized = normalizeProjectState(state, projectId);
  await provider.writeFile(PROJECT_STATE_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

export function getProjectStatePath(): string {
  return PROJECT_STATE_PATH;
}
