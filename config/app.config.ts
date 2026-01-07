// Application Configuration
// This file contains all configurable settings for the application

export const appConfig = {
  // Vercel Sandbox Configuration
  vercelSandbox: {
    // Sandbox timeout in minutes
    timeoutMinutes: 15,

    // Convert to milliseconds for Vercel Sandbox API
    get timeoutMs() {
      return this.timeoutMinutes * 60 * 1000;
    },

    // Development server port (Vercel Sandbox typically uses 3000 for Next.js/React)
    devPort: 3000,

    // Time to wait for dev server to be ready (in milliseconds)
    devServerStartupDelay: 7000,

    // Time to wait for CSS rebuild (in milliseconds)
    cssRebuildDelay: 2000,

    // Working directory in sandbox
    workingDirectory: '/app',

    // Default runtime for sandbox
    runtime: 'node22' // Available: node22, python3.13, v0-next-shadcn, cua-ubuntu-xfce
  },

  // E2B Sandbox Configuration
  e2b: {
    // Sandbox timeout in minutes
    timeoutMinutes: 30,

    // Convert to milliseconds for E2B API
    get timeoutMs() {
      return this.timeoutMinutes * 60 * 1000;
    },

    // Development server port (E2B uses 5173 for Vite)
    vitePort: 5173,

    // Time to wait for Vite dev server to be ready (in milliseconds)
    viteStartupDelay: 10000,

    // Working directory in sandbox
    workingDirectory: '/home/user/app',
  },

  // Sandy Sandbox Configuration
  sandy: {
    // Sandbox timeout in minutes
    timeoutMinutes: 10,

    // Convert to milliseconds for Sandy API
    get timeoutMs() {
      return this.timeoutMinutes * 60 * 1000;
    },

    // Development server port (Sandy uses 5173 for Vite)
    vitePort: 5173,

    // Time to wait for Vite dev server to be ready (in milliseconds)
    viteStartupDelay: 10000,

    // Time to wait for sandbox creation (in milliseconds)
    createTimeoutMs: 240000,

    // Time to wait for Vite setup after creation (in milliseconds)
    setupTimeoutMs: 240000,

    // Working directory in sandbox
    workingDirectory: '/workspace',
  },
  
  // AI Model Configuration
  ai: {
    // Default AI model
    defaultModel: 'zai-org/GLM-4.7-TEE',
    
    // Available models
    availableModels: [
      'zai-org/GLM-4.7-TEE',
      'deepseek-ai/DeepSeek-V3.2-TEE',
      'MiniMaxAI/MiniMax-M2.1-TEE',
      'XiaomiMiMo/MiMo-V2-Flash',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', // Best for Codex agent
    ],
    
    // Model display names
    modelDisplayNames: {
      'zai-org/GLM-4.7-TEE': 'GLM 4.7',
      'deepseek-ai/DeepSeek-V3.2-TEE': 'DeepSeek V3.2',
      'MiniMaxAI/MiniMax-M2.1-TEE': 'MiniMax M2.1',
      'XiaomiMiMo/MiMo-V2-Flash': 'MiMo V2 Flash',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8': 'Qwen3 Coder 480B',
    } as Record<string, string>,
    
    // Model API configuration to help downstream helpers pick the right SDK
    modelApiConfig: {
      'zai-org/GLM-4.7-TEE': { provider: 'chutes' },
      'deepseek-ai/DeepSeek-V3.2-TEE': { provider: 'chutes' },
      'MiniMaxAI/MiniMax-M2.1-TEE': { provider: 'chutes' },
      'XiaomiMiMo/MiMo-V2-Flash': { provider: 'chutes' },
      'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8': { provider: 'chutes' },
    },
    
    // Temperature settings for non-reasoning models
    defaultTemperature: 0.7,
    
    // Max tokens for code generation
    maxTokens: 8000,
    
    // Max tokens for truncation recovery
    truncationRecoveryMaxTokens: 4000,
  },
  
  // Coding Agent Configuration
  agents: {
    // Default coding agent
    defaultAgent: 'codex' as const,
    
    // Available agents
    availableAgents: [
      'builtin',      // Built-in code generator (current implementation)
      'claude-code',  // Claude Code CLI
      'codex',        // OpenAI Codex CLI
      'aider',        // Aider AI coding assistant
      'opencode',     // OpenCode CLI
      'droid',        // Factory AI Droid CLI
    ] as const,
    
    // Agent display names
    agentDisplayNames: {
      'builtin': 'Chutes Webcoder',
      'claude-code': 'Claude Code',
      'codex': 'OpenAI Codex',
      'aider': 'Aider',
      'opencode': 'OpenCode',
      'droid': 'Factory Droid',
    } as Record<string, string>,
    
    // Agent descriptions
    agentDescriptions: {
      'builtin': 'Built-in fast code generator optimized for web apps',
      'claude-code': 'Anthropic\'s powerful coding agent with full project understanding',
      'codex': 'OpenAI\'s code execution agent with autonomous capabilities',
      'aider': 'Open-source AI pair programming assistant',
      'opencode': 'OpenCode terminal agent with multi-provider support',
      'droid': 'Factory AI Droid agent (requires Factory API key)',
    } as Record<string, string>,
  },
  
  // Code Application Configuration
  codeApplication: {
    // Delay after applying code before refreshing iframe (milliseconds)
    defaultRefreshDelay: 2000,
    
    // Delay when packages are installed (milliseconds)
    packageInstallRefreshDelay: 5000,
    
    // Enable/disable automatic truncation recovery
    enableTruncationRecovery: false, // Disabled - too many false positives
    
    // Maximum number of truncation recovery attempts per file
    maxTruncationRecoveryAttempts: 1,
  },
  
  // UI Configuration
  ui: {
    // Show/hide certain UI elements
    showModelSelector: true,
    showStatusIndicator: true,
    
    // Animation durations (milliseconds)
    animationDuration: 200,
    
    // Toast notification duration (milliseconds)
    toastDuration: 3000,
    
    // Maximum chat messages to keep in memory
    maxChatMessages: 100,
    
    // Maximum recent messages to send as context
    maxRecentMessagesContext: 20,
  },
  
  // Development Configuration
  dev: {
    // Enable debug logging
    enableDebugLogging: true,
    
    // Enable performance monitoring
    enablePerformanceMonitoring: false,
    
    // Log API responses
    logApiResponses: true,
  },
  
  // Package Installation Configuration
  packages: {
    // Use --legacy-peer-deps flag for npm install
    useLegacyPeerDeps: true,
    
    // Package installation timeout (milliseconds)
    installTimeout: 180000,
    
    // Auto-restart Vite after package installation
    autoRestartVite: true,
  },
  
  // File Management Configuration
  files: {
    // Excluded file patterns (files to ignore)
    excludePatterns: [
      'node_modules/**',
      '.git/**',
      '.next/**',
      'dist/**',
      'build/**',
      '*.log',
      '.DS_Store'
    ],
    
    // Maximum file size to read (bytes)
    maxFileSize: 1024 * 1024, // 1MB
    
    // File extensions to treat as text
    textFileExtensions: [
      '.js', '.jsx', '.ts', '.tsx',
      '.css', '.scss', '.sass',
      '.html', '.xml', '.svg',
      '.json', '.yml', '.yaml',
      '.md', '.txt', '.env',
      '.gitignore', '.dockerignore'
    ],
  },
  
  // API Endpoints Configuration (for external services)
  api: {
    // Retry configuration
    maxRetries: 3,
    retryDelay: 1000, // milliseconds
    
    // Request timeout (milliseconds)
    requestTimeout: 120000,
  }
};

// Type-safe config getter
export function getConfig<K extends keyof typeof appConfig>(key: K): typeof appConfig[K] {
  return appConfig[key];
}

// Helper to get nested config values
export function getConfigValue(path: string): any {
  return path.split('.').reduce((obj, key) => obj?.[key], appConfig as any);
}

export default appConfig;
