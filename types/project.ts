export interface ProjectChatMessage {
  id: string;
  role: 'user' | 'ai' | 'system' | 'error' | 'command' | 'file-update';
  content: string;
  timestamp: number;
  metadata?: {
    scrapedUrl?: string;
    scrapedContent?: any;
    generatedCode?: string;
    appliedFiles?: string[];
    commandType?: 'input' | 'output' | 'error' | 'success';
    systemTag?: string;
  };
}

export interface ProjectCheckpoint {
  id: string;
  label: string;
  createdAt: string;
}

export interface ProjectDevServer {
  command: string;
  port: number;
  processMatch?: string;
}

export interface ProjectState {
  projectId: string;
  createdAt: string;
  updatedAt: string;
  conversation: {
    messages: ProjectChatMessage[];
  };
  conversationContext?: {
    scrapedWebsites: Array<{ url: string; content: any; timestamp: number }>;
    generatedComponents: Array<{ name: string; path: string; content: string }>;
    appliedCode: Array<{ files: string[]; timestamp: number }>;
    currentProject: string;
    lastGeneratedCode?: string;
  };
  checkpoints: ProjectCheckpoint[];
  devServer?: ProjectDevServer;
  github?: {
    repo: string;
    owner?: string;
    url?: string;
    branch?: string;
    lastSync?: string;
  };
  netlify?: {
    siteId?: string;
    siteName?: string;
    url?: string;
    lastDeployAt?: string;
  };
}
