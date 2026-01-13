'use client';

import { useState, useEffect, useRef, Suspense, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import { appConfig } from '@/config/app.config';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth, usePendingAuthRequest } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
// Import icons from centralized module to avoid Turbopack chunk issues
import { 
  FiFile, 
  FiChevronRight, 
  FiChevronDown,
  BsFolderFill, 
  BsFolder2Open, 
  SiJavascript, 
  SiReact, 
  SiCss3, 
  SiJson 
} from '@/lib/icons';
import { motion } from 'framer-motion';
import { MessageSquare, Code2, Eye, ExternalLink, Clipboard, RotateCcw, Plus, Square, Github, Share2, CloudUpload } from 'lucide-react';
import CodeApplicationProgress, { type CodeApplicationState } from '@/components/CodeApplicationProgress';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { parseClaudeCodeOutput, SSEJsonBuffer, shouldDisplayMessage } from '@/lib/agent-output-parser';
import type { ProjectCheckpoint, ProjectState, ProjectChatMessage } from '@/types/project';
// Lazy-load the wave to avoid impacting TTI
const ParticleWave = dynamic(() => import('@/components/ParticleWave'), { ssr: false });

// V2 Design System Components
import { Header2, ChutesLogo } from '@/components/layout/Header2';
import { UserAvatar2 } from '@/components/auth/UserAvatar2';
import { Dialog, AppDialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/shared/ui/app-dialog';

const FILE_ICON_SIZE = 16;
const CODE_PANEL_COLLAPSED_MAX_HEIGHT = '24rem';
const CODE_PANEL_EXPANDED_MAX_HEIGHT = '70vh';
const CODE_PANEL_MIN_HEIGHT = '12rem';
const CHAT_STREAM_MIN_HEIGHT = '8rem';
const CHAT_STREAM_MAX_HEIGHT = '18rem';
const GITHUB_REPO_MANUAL = '__manual__';
const buildFallbackSandboxUrl = (sandboxId: string) => {
  const rawSuffix = (process.env.NEXT_PUBLIC_SANDBOX_HOST_SUFFIX || '').trim();
  if (!rawSuffix) {
    return `/api/sandy-preview/${sandboxId}`;
  }
  const suffix = rawSuffix.startsWith('.') ? rawSuffix : `.${rawSuffix}`;
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
  return `${protocol}//${sandboxId}${suffix}`;
};

interface SandboxData {
  sandboxId: string;
  url: string;
  [key: string]: any;
}

interface ChatMessage {
  content: string;
  type: 'user' | 'ai' | 'system' | 'file-update' | 'command' | 'error';
  timestamp: Date;
  metadata?: {
    scrapedUrl?: string;
    scrapedContent?: any;
    generatedCode?: string;
    appliedFiles?: string[];
    commandType?: 'input' | 'output' | 'error' | 'success';
    systemTag?: string;
  };
}

interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  url?: string;
  defaultBranch?: string;
  private?: boolean;
}

// Simple markdown renderer for chat messages
function renderMarkdown(text: string): React.ReactNode {
  // Split by code blocks first (```)
  const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${keyIndex++}`}>
          {renderInlineMarkdown(text.slice(lastIndex, match.index))}
        </span>
      );
    }

    // Add code block
    const language = match[1] || 'text';
    const code = match[2].trim();
    parts.push(
      <pre
        key={`code-${keyIndex++}`}
        className="my-2 p-3 bg-neutral-900 rounded-lg overflow-x-auto text-sm font-mono"
      >
        <code className={`language-${language}`}>{code}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${keyIndex++}`}>
        {renderInlineMarkdown(text.slice(lastIndex))}
      </span>
    );
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// Render inline markdown (bold, italic, code, links)
function renderInlineMarkdown(text: string): React.ReactNode {
  // Process inline elements: **bold**, *italic*, `code`, [link](url)
  const elements: React.ReactNode[] = [];
  let keyIndex = 0;

  // Regex for all inline patterns
  const inlineRegex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Add plain text before match
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const fullMatch = match[1];
    if (fullMatch.startsWith('**')) {
      // Bold
      elements.push(<strong key={`b-${keyIndex++}`} className="font-semibold">{match[2]}</strong>);
    } else if (fullMatch.startsWith('*') && !fullMatch.startsWith('**')) {
      // Italic
      elements.push(<em key={`i-${keyIndex++}`}>{match[3]}</em>);
    } else if (fullMatch.startsWith('`')) {
      // Inline code
      elements.push(
        <code key={`c-${keyIndex++}`} className="px-1.5 py-0.5 bg-neutral-800 rounded text-emerald-400 text-sm font-mono">
          {match[4]}
        </code>
      );
    } else if (fullMatch.startsWith('[')) {
      // Link
      elements.push(
        <a
          key={`a-${keyIndex++}`}
          href={match[6]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-400 hover:text-emerald-300 underline"
        >
          {match[5]}
        </a>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements.length === 1 ? elements[0] : <>{elements}</>;
}

function AISandboxPageContent() {
  const [sandboxData, setSandboxData] = useState<SandboxData | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ text: 'Not connected', active: false });
  const [_responseArea, _setResponseArea] = useState<string[]>([]);
  const [structureContent, setStructureContent] = useState('No sandbox created yet');
  const [promptInput, setPromptInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [aiChatInput, setAiChatInput] = useState('');
  const [aiEnabled] = useState(true);
  const searchParams = useSearchParams();
  const router = useRouter();
  
  // Auth state - enforce login on first request
  const {
    isAuthenticated,
    isLoading: isAuthLoading,
    login,
    refresh: refreshAuth,
    user,
    connections,
    checkAuthAndProceed,
  } = useAuth();
  const { pendingRequest, clearPendingRequest } = usePendingAuthRequest();
  const githubConnected = connections?.github ?? false;
  const netlifyConnected = connections?.netlify ?? false;
  const creatingSandboxRef = useRef<Promise<any> | null>(null);
  const [aiModel, setAiModel] = useState(() => {
    const modelParam = searchParams.get('model');
    return appConfig.ai.availableModels.includes(modelParam || '') ? modelParam! : appConfig.ai.defaultModel;
  });
  const [selectedAgent, setSelectedAgent] = useState<string>(() => {
    const agentParam = searchParams.get('agent');
    return appConfig.agents.availableAgents.includes(agentParam as any) ? agentParam! : appConfig.agents.defaultAgent;
  });
  const [_urlOverlayVisible, _setUrlOverlayVisible] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [_urlStatus, _setUrlStatus] = useState<string[]>([]);
  const [showHomeScreen, setShowHomeScreen] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const userSelectedFileRef = useRef(false);
  const [isCodeExpanded, setIsCodeExpanded] = useState(false);
  const [homeScreenFading, setHomeScreenFading] = useState(false);
  const [homeUrlInput, setHomeUrlInput] = useState('');
  const [homePromptInput, setHomePromptInput] = useState('');
  const [homeContextInput, setHomeContextInput] = useState('');
  const [activeTab, setActiveTab] = useState<'generation' | 'preview'>('preview');
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [_showLoadingBackground, _setShowLoadingBackground] = useState(false);
  const [urlScreenshot, setUrlScreenshot] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [isPreparingDesign, setIsPreparingDesign] = useState(false);
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [loadingStage, setLoadingStage] = useState<'gathering' | 'planning' | 'generating' | null>(null);
  const [_sandboxFiles, _setSandboxFiles] = useState<Record<string, string>>({});
  const [_fileStructure, _setFileStructure] = useState<string>('');
  
  const [conversationContext, setConversationContext] = useState<{
    scrapedWebsites: Array<{ url: string; content: any; timestamp: Date }>;
    generatedComponents: Array<{ name: string; path: string; content: string }>;
    appliedCode: Array<{ files: string[]; timestamp: Date }>;
    currentProject: string;
    lastGeneratedCode?: string;
  }>({
    scrapedWebsites: [],
    generatedComponents: [],
    appliedCode: [],
    currentProject: '',
    lastGeneratedCode: undefined
  });

  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([]);
  const [githubDialogOpen, setGithubDialogOpen] = useState(false);
  const [githubRepoInput, setGithubRepoInput] = useState('');
  const [githubBranchInput, setGithubBranchInput] = useState('');
  const [githubExportName, setGithubExportName] = useState('');
  const [githubOwnerInput, setGithubOwnerInput] = useState('');
  const [githubPrivate, setGithubPrivate] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [githubReposLoading, setGithubReposLoading] = useState(false);
  const [githubReposError, setGithubReposError] = useState<string | null>(null);
  const [githubRepoSelection, setGithubRepoSelection] = useState('');
  const [netlifyDialogOpen, setNetlifyDialogOpen] = useState(false);
  const [netlifySiteName, setNetlifySiteName] = useState('');
  const [netlifyDeploying, setNetlifyDeploying] = useState(false);
  const projectSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadProjectStateRef = useRef<((sandboxId: string) => Promise<void>) | null>(null);
  
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const codeDisplayRef = useRef<HTMLDivElement>(null);
  const applyingRecoveryRef = useRef<boolean>(false);
  const sandboxRecreationCountRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const createSandboxRef = useRef<((fromHomeScreen?: boolean, suppressUrlPush?: boolean, sandboxIdOverride?: string | null) => Promise<any>) | null>(null);
  const sendChatMessageRef = useRef<((message?: string, retryCount?: number) => Promise<void>) | null>(null);
  const captureUrlScreenshotRef = useRef<((url: string) => Promise<void>) | null>(null);
  const lastUserPromptRef = useRef<string>('');
  const lastSandboxIdRef = useRef<string | null>(null);
  const sandboxStatusThrottleRef = useRef<{ lastCheckedAt: number; inFlight: boolean }>({
    lastCheckedAt: 0,
    inFlight: false
  });
  const refreshInFlightRef = useRef<boolean>(false);
  const agentAbortRef = useRef<AbortController | null>(null);
  const fileUpdateQueueRef = useRef<{ created: Set<string>; modified: Set<string> }>({
    created: new Set(),
    modified: new Set()
  });
  const fileUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFileUpdateRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      try {
        if (streamAbortRef.current) {
          streamAbortRef.current.abort();
        }
      } catch {}
      try {
        if (agentAbortRef.current) {
          agentAbortRef.current.abort();
        }
      } catch {}
      if (projectSaveTimerRef.current) {
        clearTimeout(projectSaveTimerRef.current);
      }
      if (fileUpdateTimerRef.current) {
        clearTimeout(fileUpdateTimerRef.current);
      }
    };
  }, []);
  
  const [codeApplicationState, setCodeApplicationState] = useState<CodeApplicationState>({
    stage: null
  });

  const getActiveSandboxId = useCallback(
    (override?: string | null) =>
      override ||
      sandboxData?.sandboxId ||
      searchParams.get('sandbox') ||
      searchParams.get('project') ||
      projectState?.projectId ||
      lastSandboxIdRef.current ||
      null,
    [sandboxData?.sandboxId, projectState?.projectId, searchParams]
  );
  const buildSandboxStatusUrl = useCallback(
    (sandboxId: string) => `/api/sandbox-status?sandboxId=${encodeURIComponent(sandboxId)}`,
    []
  );
  const buildSandboxFilesUrl = useCallback(
    (sandboxId: string) => `/api/get-sandbox-files?sandboxId=${encodeURIComponent(sandboxId)}`,
    []
  );
  const getPreviewUrl = useCallback(
    (override?: string | null) => {
      const sandboxId = getActiveSandboxId(override);
      if (!sandboxId) return null;
      if (sandboxData?.sandboxId === sandboxId && (sandboxData?.url || sandboxData?.sandboxUrl)) {
        return sandboxData.url || sandboxData.sandboxUrl;
      }
      return buildFallbackSandboxUrl(sandboxId);
    },
    [getActiveSandboxId, sandboxData?.sandboxId, sandboxData?.sandboxUrl, sandboxData?.url]
  );
  useEffect(() => {
    const candidate =
      sandboxData?.sandboxId ||
      searchParams.get('sandbox') ||
      searchParams.get('project') ||
      projectState?.projectId ||
      null;
    if (candidate && candidate !== lastSandboxIdRef.current) {
      lastSandboxIdRef.current = candidate;
    }
  }, [sandboxData?.sandboxId, searchParams, projectState?.projectId]);
  const syncUrlWithSandbox = useCallback((sandboxId: string, replace: boolean = true) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sandbox', sandboxId);
    params.set('project', sandboxId);
    params.set('model', aiModel);
    params.set('agent', selectedAgent);
    const next = `/?${params.toString()}`;
    const current = `/?${searchParams.toString()}`;
    if (next === current) return;
    if (replace) {
      router.replace(next, { scroll: false });
    } else {
      router.push(next, { scroll: false });
    }
  }, [aiModel, router, searchParams, selectedAgent]);

  useEffect(() => {
    const sandboxId = sandboxData?.sandboxId;
    if (!sandboxId) return;
    const urlSandbox = searchParams.get('sandbox');
    const urlProject = searchParams.get('project');
    if (urlSandbox !== sandboxId || urlProject !== sandboxId) {
      syncUrlWithSandbox(sandboxId, true);
    }
  }, [sandboxData?.sandboxId, searchParams, syncUrlWithSandbox]);

  // Helpers for robust preview readiness
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const pingSandbox = async (baseUrl?: string) => {
    if (!baseUrl) return false;
    const trimmed = baseUrl.replace(/\/$/, '');
    const sameOrigin = trimmed.startsWith('/') || trimmed.startsWith(window.location.origin);

    if (sameOrigin) {
      try {
        const res = await fetch(`${trimmed}?ping=${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store'
        });
        return res.ok;
      } catch {
        return false;
      }
    }

    // Fallback to an image ping to bypass CORS for cross-origin sandboxes.
    try {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = `${trimmed}/favicon.ico?t=${Date.now()}`;
      });
      return true;
    } catch {
      return false;
    }
  };
  const fetchSandboxActive = async (overrideSandboxId?: string | null): Promise<boolean> => {
    const sandboxId = getActiveSandboxId(overrideSandboxId);
    if (!sandboxId) return false;
    const now = Date.now();
    const throttle = sandboxStatusThrottleRef.current;
    if (throttle.inFlight || now - throttle.lastCheckedAt < 1000) {
      return false;
    }
    throttle.inFlight = true;
    throttle.lastCheckedAt = now;
    try {
      const res = await fetch(buildSandboxStatusUrl(sandboxId), { method: 'GET' });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.active && data?.healthy) {
        if (data.sandboxData && (!sandboxData || sandboxData.sandboxId !== data.sandboxData.sandboxId)) {
          setSandboxData(data.sandboxData);
        }
        return true;
      }
    } catch {}
    finally {
      sandboxStatusThrottleRef.current.inFlight = false;
    }
    return false;
  };
  
  const [generationProgress, setGenerationProgress] = useState<{
    isGenerating: boolean;
    status: string;
    components: Array<{ name: string; path: string; completed: boolean }>;
    currentComponent: number;
    streamedCode: string;
    isStreaming: boolean;
    isThinking: boolean;
    thinkingText?: string;
    thinkingDuration?: number;
    currentFile?: { path: string; content: string; type: string };
    files: Array<{ path: string; content: string; type: string; completed: boolean; edited?: boolean; lastUpdated?: number; truncated?: boolean }>;
    lastProcessedPosition: number;
    isEdit?: boolean;
  }>({
    isGenerating: false,
    status: '',
    components: [],
    currentComponent: 0,
    streamedCode: '',
    isStreaming: false,
    isThinking: false,
    files: [],
    lastProcessedPosition: 0
  });

  const rootFolder = useMemo(() => {
    const filePaths = generationProgress.files.map(file => file.path).filter(Boolean);
    if (filePaths.length === 0) return 'src';
    const topLevelDirs = new Set(filePaths.map(path => path.split('/')[0]).filter(Boolean));
    const hasRootFiles = filePaths.some(path => !path.includes('/'));
    if (hasRootFiles || topLevelDirs.size > 1) return 'workspace';
    if (topLevelDirs.has('src')) return 'src';
    if (topLevelDirs.has('app')) return 'app';
    if (topLevelDirs.size === 1) return Array.from(topLevelDirs)[0] as string;
    return 'workspace';
  }, [generationProgress.files]);
  const rootFolderLabel = rootFolder === 'workspace' ? 'root' : rootFolder;

  const treeFiles = useMemo(() => {
    const rootPrefix = rootFolder === 'workspace' ? '' : `${rootFolder}/`;
    return generationProgress.files.map(file => {
      const displayPath = rootPrefix && file.path.startsWith(rootPrefix)
        ? file.path.slice(rootPrefix.length)
        : file.path;
      return { ...file, displayPath, fullPath: file.path };
    });
  }, [generationProgress.files, rootFolder]);

  useEffect(() => {
    setExpandedFolders(prev => {
      if (prev.has(rootFolder)) return prev;
      const next = new Set(prev);
      next.add(rootFolder);
      return next;
    });
  }, [rootFolder]);

  useEffect(() => {
    setIsCodeExpanded(false);
  }, [selectedFile, activeTab, generationProgress.currentFile?.path, generationProgress.files.length]);

  // After apply, request a preview refresh when iframe exists
  const [pendingRefresh, setPendingRefresh] = useState<{ reason: string } | null>(null);
  
  // Mobile portrait layout detection and tab state
  const [isPortrait, setIsPortrait] = useState(false);
  const [isSmallViewport, setIsSmallViewport] = useState(true);
  const isMobilePortraitLayout = isPortrait && isSmallViewport;
  const [mobileTab, setMobileTab] = useState<'chat' | 'code' | 'preview'>('chat');
  const userTabbedRef = useRef(false);
  const prevIsGeneratingRef = useRef(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeRevision, setIframeRevision] = useState(0);

  useEffect(() => {
    const updateViewportState = () => {
      try {
        const portrait = window.matchMedia('(orientation: portrait)').matches;
        setIsPortrait(portrait);
      } catch {
        setIsPortrait(window.innerHeight >= window.innerWidth);
      }
      setIsSmallViewport(window.innerWidth < 768);
    };
    updateViewportState();
    window.addEventListener('resize', updateViewportState, { passive: true });
    // Some browsers still emit orientationchange
    window.addEventListener('orientationchange', updateViewportState as any, { passive: true } as any);
    return () => {
      window.removeEventListener('resize', updateViewportState);
      window.removeEventListener('orientationchange', updateViewportState as any);
    };
  }, []);

  // Keep right panel mode in sync when user taps mobile tabs
  useEffect(() => {
    if (!isMobilePortraitLayout) return;
    if (mobileTab === 'code') setActiveTab('generation');
    if (mobileTab === 'preview') setActiveTab('preview');
  }, [mobileTab, isMobilePortraitLayout]);

  // Reflect programmatic right-panel mode changes in mobile tabs
  useEffect(() => {
    if (!isMobilePortraitLayout) return;
    if (activeTab === 'generation') setMobileTab('code');
    if (activeTab === 'preview') setMobileTab('preview');
  }, [activeTab, isMobilePortraitLayout]);

  // Auto-switch to Chat when generation starts (mobile portrait); later auto-switch to Preview when ready
  useEffect(() => {
    if (!isMobilePortraitLayout) {
      prevIsGeneratingRef.current = generationProgress.isGenerating;
      return;
    }
    if (!prevIsGeneratingRef.current && generationProgress.isGenerating) {
      // Generation just started
      setIframeLoaded(false);
      if (!userTabbedRef.current) {
        setActiveTab('generation');
        setMobileTab('chat');
      }
    }
    prevIsGeneratingRef.current = generationProgress.isGenerating;
  }, [generationProgress.isGenerating, isMobilePortraitLayout]);

  const initialSetupRef = useRef(false);

  // Clear old conversation data on component mount and create/restore sandbox
  useEffect(() => {
    if (initialSetupRef.current) return;
    initialSetupRef.current = true;

    const initializePage = async () => {
      const sandboxIdParam = searchParams.get('sandbox') || searchParams.get('project');

      if (!sandboxIdParam) {
        try {
          await fetch('/api/conversation-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clear-old' })
          });
          console.log('[home] Cleared old conversation data on mount');
        } catch (error) {
          console.error('[ai-sandbox] Failed to clear old conversation:', error);
        }
      }

      if (isMountedRef.current && !sandboxIdParam) {
        console.log('[home] Clearing stale sandbox data on fresh page load');
        setSandboxData(null);
      }

      if (sandboxIdParam) {
        console.log('[home] Attempting to restore sandbox:', sandboxIdParam);
        if (isMountedRef.current) setLoading(true);
        setShowHomeScreen(false);
        try {
          const restored = await createSandboxRef.current?.(true, true, sandboxIdParam);
          const effectiveId = restored?.sandboxId || sandboxIdParam;
          await loadProjectStateRef.current?.(effectiveId);
        } catch (error) {
          console.error('[ai-sandbox] Failed to restore sandbox:', error);
          const created = await createSandboxRef.current?.(true, false);
          if (created?.sandboxId) {
            await loadProjectStateRef.current?.(created.sandboxId);
          }
        }
      } else {
        console.log('[home] No sandbox in URL, creating new sandbox automatically...');
        const created = await createSandboxRef.current?.(true, false);
        if (created?.sandboxId) {
          await loadProjectStateRef.current?.(created.sandboxId);
        }
      }
    };
    
    initializePage();
  }, [searchParams]);

  useEffect(() => {
    const oauthError = searchParams.get('oauthError');
    if (!oauthError) return;
    const message = decodeURIComponent(oauthError.replace(/\+/g, ' '));
    toast.error(message);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('oauthError');
    const next = params.toString();
    router.replace(next ? `/?${next}` : '/', { scroll: false });
  }, [router, searchParams]);
  
  // Handle pending request after successful auth
  // This is a ref to track if we've processed the pending request
  const pendingRequestProcessedRef = useRef(false);
  
  useEffect(() => {
    if (!isAuthenticated || !pendingRequest || pendingRequestProcessedRef.current || isAuthLoading) {
      return;
    }

    const resumePending = async () => {
      if (pendingRequest.type !== 'generate' || !pendingRequest.payload?.prompt) {
        clearPendingRequest();
        return;
      }

      let activeSandboxId = getActiveSandboxId();
      if (!activeSandboxId) {
        try {
          const created = await createSandboxRef.current?.(true, false);
          activeSandboxId = created?.sandboxId || getActiveSandboxId();
        } catch (error) {
          console.error('[auth] Failed to create sandbox for pending request:', error);
        }
      }

      if (!activeSandboxId) {
        return;
      }

      pendingRequestProcessedRef.current = true;
      console.log('[auth] Resuming pending request after login:', pendingRequest, 'sandbox:', activeSandboxId);

      setShowHomeScreen(false);
      setActiveTab('generation');

      setTimeout(() => {
        void sendChatMessageRef.current?.(pendingRequest.payload.prompt);
        clearPendingRequest();
        toast.success(`Welcome back, ${user?.username}! Continuing with your request...`);
      }, 300);
    };

    void resumePending();
  }, [isAuthenticated, pendingRequest, isAuthLoading, clearPendingRequest, user, sandboxData, getActiveSandboxId]);
  
  useEffect(() => {
    // Handle Escape key for home screen
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showHomeScreen) {
        setHomeScreenFading(true);
        setTimeout(() => {
          setShowHomeScreen(false);
          setHomeScreenFading(false);
        }, 500);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showHomeScreen]);
  
  // Start capturing screenshot if URL is provided on mount (from home screen)
  useEffect(() => {
    if (!showHomeScreen && homeUrlInput && !urlScreenshot && !isCapturingScreenshot) {
      let screenshotUrl = homeUrlInput.trim();
      if (!screenshotUrl.match(/^https?:\/\//i)) {
        screenshotUrl = 'https://' + screenshotUrl;
      }
      // Avoid triggering if unmounted during state changes
      if (isMountedRef.current) captureUrlScreenshotRef.current?.(screenshotUrl);
    }
  }, [showHomeScreen, homeUrlInput, urlScreenshot, isCapturingScreenshot]);

  const updateStatus = useCallback((text: string, active: boolean) => {
    setStatus({ text, active });
  }, []);

  const checkSandboxStatus = useCallback(async () => {
    const sandboxId = getActiveSandboxId();
    if (!sandboxId) {
      setSandboxData(null);
      updateStatus('No sandbox', false);
      return;
    }
    const now = Date.now();
    const throttle = sandboxStatusThrottleRef.current;
    if (throttle.inFlight || now - throttle.lastCheckedAt < 1000) {
      return;
    }
    throttle.inFlight = true;
    throttle.lastCheckedAt = now;
    try {
      const response = await fetch(buildSandboxStatusUrl(sandboxId));
      if (!response.ok) {
        console.warn('[sandbox-status] Non-OK response:', response.status);
        updateStatus('Sandbox status unavailable', false);
        return;
      }
      const data = await response.json().catch(() => ({}));
      
      if (data.active && data.healthy && data.sandboxData) {
        setSandboxData(data.sandboxData);
        updateStatus('Sandbox active', true);
      } else if (data.active && !data.healthy) {
        // Sandbox exists but not responding
        updateStatus('Sandbox not responding', false);
        // Optionally try to create a new one
      } else {
        if (!sandboxData && data?.message?.includes('not found')) {
          setSandboxData(null);
          updateStatus('No sandbox', false);
        } else {
          updateStatus('Sandbox inactive', false);
        }
      }
    } catch (error) {
      console.error('Failed to check sandbox status:', error);
      if (!sandboxData) {
        setSandboxData(null);
        updateStatus('Error', false);
      } else {
        updateStatus('Status check failed', false);
      }
    } finally {
      sandboxStatusThrottleRef.current.inFlight = false;
    }
  }, [buildSandboxStatusUrl, getActiveSandboxId, sandboxData, updateStatus]);


  useEffect(() => {
    // Only check sandbox status on mount and when user navigates to the page
    checkSandboxStatus();
    
    // Optional: Check status when window regains focus
    const handleFocus = () => {
      checkSandboxStatus();
    };
    
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [checkSandboxStatus]);

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Clear "waiting_preview" state only after the UI has switched to the preview tab
  useEffect(() => {
    if (activeTab === 'preview' && codeApplicationState.stage === 'waiting_preview') {
      setCodeApplicationState({ stage: null });
    }
  }, [activeTab, codeApplicationState.stage]);

  // Deferred, robust refresh sequence when iframe and sandbox are ready
  useEffect(() => {
    const run = async () => {
      if (!pendingRefresh || refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      const url = getPreviewUrl();
      if (!url) {
        console.warn('[refresh] No sandbox URL yet; waiting...');
        setTimeout(() => { if (isMountedRef.current) setPendingRefresh({ reason: pendingRefresh.reason }); }, 500);
        refreshInFlightRef.current = false;
        return;
      }
      if (!iframeRef.current) {
        console.warn('[refresh] No iframe yet; waiting for render...');
        // Switch to preview tab to ensure iframe is rendered in the right pane
        if (isMountedRef.current) setActiveTab('preview');
        // Re-arm the refresh shortly after switching tabs
        setTimeout(() => { if (isMountedRef.current) setPendingRefresh({ reason: pendingRefresh.reason }); }, 300);
        refreshInFlightRef.current = false;
        return;
      }
      console.log('[refresh] Starting refresh sequence. reason=', pendingRefresh.reason, 'url=', url);
      applyingRecoveryRef.current = true;
      try {
        // Step 1: health checks
        for (let attempt = 0; attempt < 12; attempt++) {
          const active = await fetchSandboxActive();
          const reachable = await pingSandbox(url);
          console.log(`[refresh] Health check ${attempt + 1}/12 active=${active} reachable=${reachable}`);
          if (active && reachable) break;
          await wait(1000);
        }
        // Step 2: navigate
        iframeRef.current.src = `${url}?t=${Date.now()}&deferred=1`;
        await wait(1500);
        // Step 3: recreate iframe once if still needed
        if (isMountedRef.current) {
          setIframeRevision(prev => prev + 1);
          await wait(1500);
        }
        // Step 4: final health
        const finalActive = await fetchSandboxActive();
        const finalReachable = await pingSandbox(url);
        console.log('[refresh] Final health active=', finalActive, 'reachable=', finalReachable);
        if (!(finalActive && finalReachable) && sandboxRecreationCountRef.current < 3) {
          sandboxRecreationCountRef.current += 1;
          console.warn('[refresh] Recreating sandbox. attempt=', sandboxRecreationCountRef.current);
          await createSandbox(true, false);
          const fallbackUrl = getPreviewUrl();
          if (isMountedRef.current && fallbackUrl && iframeRef.current) {
            iframeRef.current.src = `${fallbackUrl}?t=${Date.now()}&deferredNewSandbox=1`;
          }
        }
      } finally {
        applyingRecoveryRef.current = false;
        refreshInFlightRef.current = false;
        if (isMountedRef.current) setPendingRefresh(null);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getPreviewUrl, pendingRefresh]);

  // Only auto-switch to Preview after iframe is fully loaded and user hasn't changed tabs
  useEffect(() => {
    if (!isMobilePortraitLayout) return;
    if (iframeLoaded && !userTabbedRef.current) {
      setActiveTab('preview');
      setMobileTab('preview');
    }
  }, [iframeLoaded, isMobilePortraitLayout]);

  const log = (message: string, type: 'info' | 'error' | 'command' = 'info') => {
    _setResponseArea(prev => [...prev, `[${type}] ${message}`]);
  };

  const addChatMessage = useCallback((content: string, type: ChatMessage['type'], metadata?: ChatMessage['metadata']) => {
    setChatMessages(prev => {
      // Ensure we never show this message twice by removing any previous ones before adding a new one
      let base = prev;
      if (type === 'system' && content === 'Waiting for sandbox to be ready...') {
        base = prev.filter(msg => msg.content !== 'Waiting for sandbox to be ready...');
      }

      // Skip duplicate consecutive system messages
      if (type === 'system' && base.length > 0) {
        const lastMessage = base[base.length - 1];
        if (lastMessage.type === 'system' && lastMessage.content === content) {
          return base; // Skip duplicate
        }
      }
      return [...base, { content, type, timestamp: new Date(), metadata }];
    });
  }, []);

  const upsertSystemMessage = useCallback((content: string, systemTag: string) => {
    setChatMessages(prev => {
      const index = [...prev].reverse().findIndex(msg => msg.metadata?.systemTag === systemTag);
      if (index === -1) {
        return [...prev, { content, type: 'system', timestamp: new Date(), metadata: { systemTag } }];
      }
      const actualIndex = prev.length - 1 - index;
      const target = prev[actualIndex];
      if (target?.content === content) return prev;
      const next = [...prev];
      next[actualIndex] = { ...target, content, timestamp: new Date() };
      return next;
    });
  }, []);

  const clearSystemMessage = useCallback((systemTag: string) => {
    setChatMessages(prev => prev.filter(msg => msg.metadata?.systemTag !== systemTag));
  }, []);

  const flushFileUpdates = useCallback(() => {
    const queue = fileUpdateQueueRef.current;
    const created = Array.from(queue.created);
    const modified = Array.from(queue.modified);
    queue.created.clear();
    queue.modified.clear();
    if (fileUpdateTimerRef.current) {
      clearTimeout(fileUpdateTimerRef.current);
      fileUpdateTimerRef.current = null;
    }
    if (created.length === 0 && modified.length === 0) return;

    const list = (items: string[]) => items.slice(0, 4).map(item => item.split('/').pop()).filter(Boolean);
    const createdList = list(created);
    const modifiedList = list(modified);
    const createdSuffix = created.length > createdList.length ? ` +${created.length - createdList.length} more` : '';
    const modifiedSuffix = modified.length > modifiedList.length ? ` +${modified.length - modifiedList.length} more` : '';

    if (createdList.length > 0 && modifiedList.length > 0) {
      lastFileUpdateRef.current = `Created ${createdList.join(', ')} / Updated ${modifiedList.join(', ')}`;
      addChatMessage(
        `Files created: ${createdList.join(', ')}${createdSuffix}. Updated: ${modifiedList.join(', ')}${modifiedSuffix}.`,
        'system'
      );
    } else if (createdList.length > 0) {
      lastFileUpdateRef.current = `Created ${createdList.join(', ')}`;
      addChatMessage(`Files created: ${createdList.join(', ')}${createdSuffix}.`, 'system');
    } else if (modifiedList.length > 0) {
      lastFileUpdateRef.current = `Updated ${modifiedList.join(', ')}`;
      addChatMessage(`Files updated: ${modifiedList.join(', ')}${modifiedSuffix}.`, 'system');
    }
  }, [addChatMessage]);

  const queueFileUpdates = useCallback((changes: Array<{ path: string; changeType: 'created' | 'modified' }>) => {
    const queue = fileUpdateQueueRef.current;
    for (const change of changes) {
      if (!change?.path) continue;
      if (change.changeType === 'modified') {
        queue.modified.add(change.path);
      } else {
        queue.created.add(change.path);
      }
    }
    if (!fileUpdateTimerRef.current) {
      fileUpdateTimerRef.current = setTimeout(() => {
        flushFileUpdates();
      }, 1500);
    }
  }, [flushFileUpdates]);
  
  const checkAndInstallPackages = async () => {
    if (!sandboxData) {
      // Avoid noisy message; just start sandbox creation implicitly where relevant
      return;
    }
    
    // Vite error checking removed - handled by template setup
    addChatMessage('Sandbox is ready. Vite configuration is handled by the template.', 'system');
  };
  
  const _handleSurfaceError = (_errors: any[]) => {
    // Function kept for compatibility but Vite errors are now handled by template
    
    // Focus the input
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.focus();
    }
  };
  
  const _installPackages = async (_packages: string[]) => {
    if (!sandboxData) {
      return;
    }
    
    try {
      const response = await fetch('/api/install-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages: _packages })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to install packages: ${response.statusText}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              switch (data.type) {
                case 'command':
                  // Don't show npm install commands - they're handled by info messages
                  if (!data.command.includes('npm install')) {
                    addChatMessage(data.command, 'command', { commandType: 'input' });
                  }
                  break;
                case 'output':
                  addChatMessage(data.message, 'command', { commandType: 'output' });
                  break;
                case 'error':
                  if (data.message && data.message !== 'undefined') {
                    addChatMessage(data.message, 'command', { commandType: 'error' });
                  }
                  break;
                case 'warning':
                  addChatMessage(data.message, 'command', { commandType: 'output' });
                  break;
                case 'success':
                  addChatMessage(`${data.message}`, 'system');
                  break;
                case 'status':
                  addChatMessage(data.message, 'system');
                  break;
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error: any) {
      addChatMessage(`Failed to install packages: ${error.message}`, 'system');
    }
  };

  const createSandbox = async (fromHomeScreen = false, suppressUrlPush = false, sandboxIdOverride?: string | null) => {
    if (creatingSandboxRef.current) {
      console.log('[createSandbox] Reusing in-flight creation promise');
      return creatingSandboxRef.current;
    }
    console.log('[createSandbox] Starting sandbox creation... fromHomeScreen=', fromHomeScreen);
    if (isMountedRef.current) setLoading(true);
    _setShowLoadingBackground(true);
    updateStatus('Creating sandbox...', false);
    _setResponseArea([]);
    setScreenshotError(null);

    creatingSandboxRef.current = (async () => {
      try {
        const response = await fetch('/api/create-ai-sandbox-v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sandboxId: sandboxIdOverride || undefined })
        });
        const data = await response.json();
        console.log('[createSandbox] Response data:', data);
        if (data.success) {
          const previewUrl = data.sandboxUrl || data.url;
          console.log('[createSandbox] SUCCESS sandboxId=', data.sandboxId, 'url=', previewUrl);
          if (isMountedRef.current) setSandboxData(data);
          if (isMountedRef.current) updateStatus('Sandbox active', true);
          log('Sandbox created successfully!');
          log(`Sandbox ID: ${data.sandboxId}`);
          log(`URL: ${previewUrl}`);
          if (data.sandboxId) {
            await loadProjectStateRef.current?.(data.sandboxId);
          }
          const hasSandboxParam = searchParams.get('sandbox');
          const hasProjectParam = searchParams.get('project');
          const shouldSyncUrl = !suppressUrlPush || !hasSandboxParam || !hasProjectParam;
          if (data.sandboxId && shouldSyncUrl) {
            console.log('[createSandbox] Syncing URL with sandbox param');
            syncUrlWithSandbox(data.sandboxId, true);
          } else if (!shouldSyncUrl) {
            console.log('[createSandbox] Suppressing URL sync during active generation');
          }
          // Fade out loading background after sandbox loads
          setTimeout(() => {
            if (isMountedRef.current) _setShowLoadingBackground(false);
          }, 3000);
          if (data.structure) {
            if (isMountedRef.current) displayStructure(data.structure);
          }
          // Fetch sandbox files after creation
          setTimeout(() => { if (isMountedRef.current) fetchSandboxFiles(data.sandboxId); }, 1000);
          // Ensure Vite server is up
          setTimeout(async () => {
            try {
              console.log('[createSandbox] Ensuring Vite server is running...');
              const restartResponse = await fetch('/api/restart-vite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sandboxId: data.sandboxId })
              });
              if (restartResponse.ok) {
                const restartData = await restartResponse.json();
                if (restartData.success) {
                  console.log('[createSandbox] Vite server started successfully');
                }
              }
            } catch (error) {
              console.error('[createSandbox] Error starting Vite server:', error);
            }
          }, 2000);
          // Only add welcome message if not coming from home screen
          if (!fromHomeScreen && isMountedRef.current) {
            addChatMessage(`Sandbox created! ID: ${data.sandboxId}. I now have context of your sandbox and can help you build your app. Just ask me to create components and I'll automatically apply them!

Tip: I automatically detect and install npm packages from your code imports (like react-router-dom, axios, etc.)`, 'system');
          }
          setTimeout(() => {
            if (isMountedRef.current && iframeRef.current) {
              console.log('[createSandbox] Setting iframe src to sandbox URL');
              iframeRef.current.src = previewUrl;
            }
          }, 100);
          return data;
        } else {
          throw new Error(data.error || 'Unknown error');
        }
      } catch (error: any) {
        console.error('[createSandbox] Error:', error);
        updateStatus('Error', false);
        log(`Failed to create sandbox: ${error.message}`, 'error');
        if (isMountedRef.current) addChatMessage(`Failed to create sandbox: ${error.message}`, 'system');
        throw error;
      } finally {
        if (isMountedRef.current) setLoading(false);
        creatingSandboxRef.current = null;
      }
    })();

    return creatingSandboxRef.current;
  };
  createSandboxRef.current = createSandbox;

  const displayStructure = (structure: any) => {
    if (typeof structure === 'object') {
      setStructureContent(JSON.stringify(structure, null, 2));
    } else {
      setStructureContent(structure || 'No structure available');
    }
  };

  const serializeChatMessages = useCallback((messages: ChatMessage[]): ProjectChatMessage[] => {
    return messages.map((msg, index) => ({
      id: `${msg.type}-${msg.timestamp.getTime()}-${index}`,
      role: msg.type,
      content: msg.content,
      timestamp: msg.timestamp.getTime(),
      metadata: msg.metadata
    }));
  }, []);

  const deserializeChatMessages = useCallback((messages: ProjectChatMessage[] = []): ChatMessage[] => {
    return messages.map((msg) => ({
      content: msg.content,
      type: msg.role,
      timestamp: new Date(msg.timestamp),
      metadata: msg.metadata
    }));
  }, []);

  const buildProjectStatePayload = useCallback((sandboxId: string): ProjectState => {
    const createdAt = projectState?.createdAt || new Date().toISOString();
    return {
      projectId: sandboxId,
      createdAt,
      updatedAt: new Date().toISOString(),
      conversation: {
        messages: serializeChatMessages(chatMessages)
      },
      conversationContext: {
        scrapedWebsites: conversationContext.scrapedWebsites.map(site => ({
          url: site.url,
          content: site.content,
          timestamp: site.timestamp.getTime()
        })),
        generatedComponents: conversationContext.generatedComponents,
        appliedCode: conversationContext.appliedCode.map(entry => ({
          files: entry.files,
          timestamp: entry.timestamp.getTime()
        })),
        currentProject: conversationContext.currentProject,
        lastGeneratedCode: conversationContext.lastGeneratedCode
      },
      checkpoints,
      devServer: projectState?.devServer,
      github: projectState?.github,
      netlify: projectState?.netlify
    };
  }, [chatMessages, checkpoints, conversationContext, projectState?.createdAt, projectState?.devServer, projectState?.github, projectState?.netlify, serializeChatMessages]);

  const persistProjectState = useCallback(async (sandboxIdOverride?: string | null) => {
    const sandboxId = getActiveSandboxId(sandboxIdOverride);
    if (!sandboxId) return;

    const payload = buildProjectStatePayload(sandboxId);
    try {
      const response = await fetch('/api/project-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxId, state: payload })
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.state) {
          setProjectState(data.state);
          setCheckpoints(data.state.checkpoints || []);
        }
      }
    } catch (error) {
      console.error('[project-state] Failed to persist:', error);
    }
  }, [buildProjectStatePayload, getActiveSandboxId]);

  const scheduleProjectSave = useCallback((sandboxIdOverride?: string | null) => {
    if (projectSaveTimerRef.current) {
      clearTimeout(projectSaveTimerRef.current);
    }
    projectSaveTimerRef.current = setTimeout(() => {
      void persistProjectState(sandboxIdOverride);
    }, 800);
  }, [persistProjectState]);

  useEffect(() => {
    const sandboxId = getActiveSandboxId();
    if (!sandboxId) return;
    scheduleProjectSave(sandboxId);
  }, [chatMessages, conversationContext, checkpoints, sandboxData?.sandboxId, scheduleProjectSave, searchParams, getActiveSandboxId]);

  const loadProjectState = useCallback(async (sandboxId: string) => {
    try {
      const response = await fetch(`/api/project-state?sandboxId=${encodeURIComponent(sandboxId)}`);
      if (!response.ok) return;
      const data = await response.json();
      if (data?.state) {
        const state: ProjectState = data.state;
        setProjectState(state);
        setCheckpoints(state.checkpoints || []);
        setConversationContext({
          scrapedWebsites: (state.conversationContext?.scrapedWebsites || []).map(site => ({
            url: site.url,
            content: site.content,
            timestamp: new Date(site.timestamp)
          })),
          generatedComponents: state.conversationContext?.generatedComponents || [],
          appliedCode: (state.conversationContext?.appliedCode || []).map(entry => ({
            files: entry.files,
            timestamp: new Date(entry.timestamp)
          })),
          currentProject: state.conversationContext?.currentProject || '',
          lastGeneratedCode: state.conversationContext?.lastGeneratedCode
        });

        const restoredMessages = deserializeChatMessages(state.conversation?.messages || []);
        if (restoredMessages.length > 0) {
          setChatMessages(restoredMessages);
        }
      }
    } catch (error) {
      console.error('[project-state] Failed to load:', error);
    }
  }, [deserializeChatMessages]);

  loadProjectStateRef.current = loadProjectState;

  const applyGeneratedCode = async (
    code: string,
    isEdit: boolean = false,
    sandboxOverride?: { sandboxId: string; url: string }
  ) => {
    setLoading(true);
    log('Applying AI-generated code...');
    
    try {
      // Show progress component instead of individual messages
      setCodeApplicationState({ stage: 'analyzing' });
      
      // Get pending packages from tool calls
      const pendingPackages = ((window as any).pendingPackages || []).filter((pkg: any) => pkg && typeof pkg === 'string');
      if (pendingPackages.length > 0) {
        console.log('[applyGeneratedCode] Sending packages from tool calls:', pendingPackages);
        // Clear pending packages after use
        (window as any).pendingPackages = [];
      }
      
      // Use streaming endpoint for real-time feedback
      console.log('[applyGeneratedCode] Calling /api/apply-ai-code-stream with sandboxId=', sandboxData?.sandboxId);
      // Abortable streaming request guard
      if (streamAbortRef.current) {
        try { streamAbortRef.current.abort(); } catch {}
      }
      streamAbortRef.current = new AbortController();
      const response = await fetch('/api/apply-ai-code-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          response: code,
          isEdit: isEdit,
          packages: pendingPackages,
          sandboxId: sandboxOverride?.sandboxId || sandboxData?.sandboxId // Ensure correct sandbox is used
        }),
        signal: streamAbortRef.current.signal
      });
      
      if (!response.ok) {
        // Try to parse server error JSON to show a useful message
        try {
          const err = await response.json();
          throw new Error(err?.error || err?.message || `Failed to apply code (${response.status})`);
        } catch {
          throw new Error(`Failed to apply code (${response.status})`);
        }
      }
      
      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let finalData: any = null;
      
      let receivedFinalEvent = false;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log('[applyGeneratedCode] SSE event:', data.type, data.message || data.fileName || '');
              
              switch (data.type) {
                case 'start':
                  // Don't add as chat message, just update state
                  setCodeApplicationState({ stage: 'analyzing' });
                  break;
                  
                case 'step':
                  // Update progress state based on step
                  if (data.message.includes('Installing') && data.packages) {
                    setCodeApplicationState({ 
                      stage: 'installing', 
                      packages: data.packages 
                    });
                   } else if (data.message.includes('Creating files') || data.message.includes('Applying')) {
                    setCodeApplicationState({ 
                      stage: 'applying'
                    });
                  }
                  break;
                  
                case 'package-progress':
                  // Handle package installation progress
                  if (data.installedPackages) {
                    setCodeApplicationState(prev => ({ 
                      ...prev,
                      installedPackages: data.installedPackages 
                    }));
                  }
                  break;
                  
                case 'command':
                  // Don't show npm install commands - they're handled by info messages
                  if (data.command && !data.command.includes('npm install')) {
                    addChatMessage(data.command, 'command', { commandType: 'input' });
                  }
                  break;
                  
                case 'success':
                  if (data.installedPackages) {
                    setCodeApplicationState(prev => ({ 
                      ...prev,
                      installedPackages: data.installedPackages 
                    }));
                  }
                  break;
                  
                case 'file-progress':
                  // Skip file progress messages, they're noisy
                  break;
                  
                case 'file-complete':
                  // Could add individual file completion messages if desired
                  break;
                  
                case 'command-progress':
                  addChatMessage(`${data.action} command: ${data.command}`, 'command', { commandType: 'input' });
                  break;
                  
                case 'command-output':
                  addChatMessage(data.output, 'command', { 
                    commandType: data.stream === 'stderr' ? 'error' : 'output' 
                  });
                  break;
                  
                case 'command-complete':
                  if (data.success) {
                    addChatMessage(`Command completed successfully`, 'system');
                  } else {
                    addChatMessage(`Command failed with exit code ${data.exitCode}`, 'system');
                  }
                  break;
                  
                case 'complete':
                  finalData = data;
                  setCodeApplicationState({ stage: 'complete' });
                  // Always enter 'waiting_preview' to keep the message visible until we actually switch to preview
                  setTimeout(() => {
                    setCodeApplicationState({ stage: 'waiting_preview' });
                  }, 500);
                  receivedFinalEvent = true;
                  break;
                  
                case 'error':
                  addChatMessage(`Error: ${data.message || data.error || 'Unknown error'}`, 'system');
                  break;
                  
                case 'warning':
                  addChatMessage(`${data.message}`, 'system');
                  break;
                  
                case 'info':
                  // Show info messages, especially for package installation
                  if (data.message) {
                    addChatMessage(data.message, 'system');
                  }
                  break;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
      
      // Process final data
      if (finalData && finalData.type === 'complete') {
        const data = {
          success: true,
          results: finalData.results,
          explanation: finalData.explanation,
          structure: finalData.structure,
          message: finalData.message
        };
        console.log('[applyGeneratedCode] Final data received:', data.message, data.results);
        
        if (data.success) {
          const { results } = data;
        
        // Log package installation results without duplicate messages
        if (results.packagesInstalled?.length > 0) {
          log(`Packages installed: ${results.packagesInstalled.join(', ')}`);
        }
        
        if (results.filesCreated?.length > 0 || results.filesUpdated?.length > 0) {
          log('Files created:');
          results.filesCreated.forEach((file: string) => {
            log(`  ${file}`, 'command');
          });
          
          // Verify files were actually created by refreshing the sandbox if needed
          const effectiveSandbox = sandboxOverride || sandboxData;
          if (effectiveSandbox?.sandboxId) {
            // Request a refresh to occur after the iframe is rendered/available
            setPendingRefresh({ reason: 'applied' });
            // Also restart Vite to pick up any dependencies or initial app bootstrap
            try {
              console.log('[applyGeneratedCode] Requesting /api/restart-vite');
              await fetch('/api/restart-vite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sandboxId: effectiveSandbox.sandboxId })
              });
            } catch {}
            // Do not force switch; rely on iframe load and auto-switch logic elsewhere
          }
        }
        
        if (results.filesUpdated?.length > 0) {
          log('Files updated:');
          results.filesUpdated.forEach((file: string) => {
            log(`  ${file}`, 'command');
          });
        }
        
        // Update conversation context with applied code
        setConversationContext(prev => ({
          ...prev,
          appliedCode: [...prev.appliedCode, {
            files: [...(results.filesCreated || []), ...(results.filesUpdated || [])],
            timestamp: new Date()
          }]
        }));
        
        if (results.commandsExecuted?.length > 0) {
          log('Commands executed:');
          results.commandsExecuted.forEach((cmd: string) => {
            log(`  $ ${cmd}`, 'command');
          });
        }
        
        if (results.errors?.length > 0) {
          results.errors.forEach((err: string) => {
            log(err, 'error');
          });
        }
        
        if (data.structure) {
          displayStructure(data.structure);
        }
        
        if (data.explanation) {
          log(data.explanation);
        }
        
        // Optionally handle extra fields if present in future
        
        log('Code applied successfully!');
        const checkpointLabel = lastUserPromptRef.current
          ? `Auto: ${lastUserPromptRef.current.slice(0, 60)}`
          : 'Auto checkpoint';
        void createCheckpoint(checkpointLabel);
        console.log('[applyGeneratedCode] Response data:', data);
        // Debug info may not always be present
        console.log('[applyGeneratedCode] Current sandboxData:', sandboxData);
        console.log('[applyGeneratedCode] Current iframe element:', iframeRef.current);
        console.log('[applyGeneratedCode] Current iframe src:', iframeRef.current?.src);
        
        if (results.filesCreated?.length > 0) {
          setConversationContext(prev => ({
            ...prev,
            appliedCode: [...prev.appliedCode, {
              files: results.filesCreated,
              timestamp: new Date()
            }]
          }));
          
          // Update the chat message to show success
          // Only show file list if not in edit mode
          if (isEdit) {
            addChatMessage(`Edit applied successfully!`, 'system');
          } else {
            // Check if this is part of a generation flow (has recent AI recreation message)
            const recentMessages = chatMessages.slice(-5);
            const isPartOfGeneration = recentMessages.some(m => 
              m.content.includes('AI recreation generated') || 
              m.content.includes('Code generated')
            );
            
            // Don't show files if part of generation flow to avoid duplication
            if (isPartOfGeneration) {
              addChatMessage(`Applied ${results.filesCreated.length} files successfully!`, 'system');
            } else {
              addChatMessage(`Applied ${results.filesCreated.length} files successfully!`, 'system', {
                appliedFiles: results.filesCreated
              });
            }
          }
          
          // If there are failed packages, add a message about checking for errors
          if (results.packagesFailed?.length > 0) {
            addChatMessage(`⚠️ Some packages failed to install. Check the error banner above for details.`, 'system');
          }
          
          // Fetch updated file structure
          await fetchSandboxFiles(sandboxOverride?.sandboxId || sandboxData?.sandboxId);
          
          // Automatically check and install any missing packages
          await checkAndInstallPackages();
          
          // Test build to ensure everything compiles correctly
          // Skip build test for now - it's causing errors with undefined activeSandbox
          // The build test was trying to access global.activeSandbox from the frontend,
          // but that's only available in the backend API routes
          console.log('[build-test] Skipping build test - would need API endpoint');
          
        // After applying code, prefer showing code generation progress a moment longer
        // and switch to preview slightly delayed to allow Vite to finish
          
          // Vite error checking removed - handled by template setup
        }
        
          // Defer robust refresh to dedicated useEffect via pendingRefresh
          const effectiveSandbox2 = sandboxOverride || sandboxData;
          if (effectiveSandbox2?.url) {
            // Wait for Vite to process the file changes
            // If packages were installed, wait longer for Vite to restart
            const packagesInstalled = results?.packagesInstalled?.length > 0 || data.results?.packagesInstalled?.length > 0;
            const refreshDelay = packagesInstalled ? appConfig.codeApplication.packageInstallRefreshDelay : appConfig.codeApplication.defaultRefreshDelay;
            console.log(`[applyGeneratedCode] Packages installed: ${packagesInstalled}, refresh delay: ${refreshDelay}ms`);
            
            setTimeout(() => setPendingRefresh({ reason: packagesInstalled ? 'packagesInstalled' : 'default' }), refreshDelay);
        }
        
        } else {
          throw new Error(finalData?.error || 'Failed to apply code');
        }
      } else {
        // If the SSE stream ended without a final event, avoid leaving the UI stuck
        if (!receivedFinalEvent) {
          setCodeApplicationState({ stage: null });
        }
        addChatMessage('Code application may have partially succeeded. Check the preview.', 'system');
      }
    } catch (error: any) {
      log(`Failed to apply code: ${error.message}`, 'error');
    } finally {
      if (streamAbortRef.current) {
        try { streamAbortRef.current.abort(); } catch {}
        streamAbortRef.current = null;
      }
      setLoading(false);
      // Clear isEdit flag after applying code
      setGenerationProgress(prev => ({
        ...prev,
        isEdit: false
      }));
    }
  };

  const pickDefaultFile = useCallback((files: Record<string, string>) => {
    const paths = Object.keys(files);
    if (paths.length === 0) return null;
    const preferred = [
      'src/App.jsx',
      'App.jsx',
      'src/main.jsx',
      'src/index.jsx',
      'index.html'
    ];
    for (const candidate of preferred) {
      if (paths.includes(candidate)) return candidate;
    }
    return paths[0];
  }, []);

  const applyFileSnapshot = useCallback((files: Record<string, string>) => {
    setGenerationProgress(prev => {
      const existingMap = new Map(prev.files.map(file => [file.path, file]));
      for (const [path, content] of Object.entries(files)) {
        const ext = path.split('.').pop() || '';
        const type = ext === 'jsx' || ext === 'js' ? 'javascript' :
          ext === 'css' ? 'css' :
          ext === 'json' ? 'json' :
          ext === 'html' ? 'html' : 'text';
        const existing = existingMap.get(path);
        existingMap.set(path, {
          ...existing,
          path,
          content,
          type,
          completed: true,
          lastUpdated: Date.now(),
          truncated: false
        });
      }
      return {
        ...prev,
        files: Array.from(existingMap.values())
      };
    });
  }, []);

  const fetchSandboxFiles = useCallback(async (overrideSandboxId?: string | null, retryCount: number = 0) => {
    const sandboxId = getActiveSandboxId(overrideSandboxId);
    if (!sandboxId) return;
    
    try {
      const response = await fetch(buildSandboxFilesUrl(sandboxId), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (!isMountedRef.current) return;
        if (data.success) {
          _setSandboxFiles(data.files || {});
          _setFileStructure(data.structure || '');
          console.log('[fetchSandboxFiles] Updated file list:', Object.keys(data.files || {}).length, 'files');
          if (data.files) {
            applyFileSnapshot(data.files);
            if (!selectedFile && !userSelectedFileRef.current) {
              const defaultFile = pickDefaultFile(data.files);
              if (defaultFile) {
                setSelectedFile(defaultFile);
              }
            }
          }
        }
      } else if (response.status >= 500 && retryCount < 2) {
        setTimeout(() => {
          if (isMountedRef.current) {
            void fetchSandboxFiles(sandboxId, retryCount + 1);
          }
        }, 1500);
      }
    } catch (error) {
      console.error('[fetchSandboxFiles] Error fetching files:', error);
    }
  }, [applyFileSnapshot, buildSandboxFilesUrl, getActiveSandboxId, pickDefaultFile, selectedFile]);

  const fetchCheckpoints = useCallback(async (overrideSandboxId?: string | null) => {
    const sandboxId = getActiveSandboxId(overrideSandboxId);
    if (!sandboxId) return;
    try {
      const response = await fetch(`/api/checkpoints?sandboxId=${encodeURIComponent(sandboxId)}`);
      if (!response.ok) return;
      const data = await response.json();
      if (data?.checkpoints) {
        setCheckpoints(data.checkpoints);
      }
    } catch (error) {
      console.error('[checkpoints] Failed to fetch:', error);
    }
  }, [getActiveSandboxId]);

  const createCheckpoint = useCallback(async (label?: string) => {
    const sandboxId = getActiveSandboxId();
    if (!sandboxId) {
      addChatMessage('No active sandbox to checkpoint.', 'system');
      return;
    }
    try {
      addChatMessage('Creating checkpoint...', 'system');
      const response = await fetch('/api/checkpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sandboxId,
          action: 'create',
          label: label || 'Checkpoint'
        })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        addChatMessage(`Failed to create checkpoint: ${err.error || response.statusText}`, 'error');
        return;
      }
      const data = await response.json();
      setCheckpoints(data.checkpoints || []);
      addChatMessage('Checkpoint created!', 'system');
      scheduleProjectSave(sandboxId);
    } catch (error) {
      console.error('[checkpoints] Create failed:', error);
      addChatMessage('Failed to create checkpoint.', 'error');
    }
  }, [addChatMessage, getActiveSandboxId, scheduleProjectSave]);

  const restoreCheckpoint = useCallback(async (checkpointId: string) => {
    const sandboxId = getActiveSandboxId();
    if (!sandboxId) {
      addChatMessage('No active sandbox to restore.', 'system');
      return;
    }
    try {
      addChatMessage('Restoring checkpoint...', 'system');
      const response = await fetch('/api/checkpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sandboxId,
          action: 'restore',
          checkpointId
        })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        addChatMessage(`Failed to restore checkpoint: ${err.error || response.statusText}`, 'error');
        return;
      }
      const data = await response.json();
      if (data?.state) {
        setProjectState(data.state);
        setCheckpoints(data.state.checkpoints || []);
        await loadProjectStateRef.current?.(sandboxId);
      }
      await fetchSandboxFiles(sandboxId);
      await fetch('/api/restart-vite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxId })
      });
      addChatMessage('Checkpoint restored. Preview refreshed.', 'system');
      setActiveTab('preview');
    } catch (error) {
      console.error('[checkpoints] Restore failed:', error);
      addChatMessage('Failed to restore checkpoint.', 'error');
    }
  }, [addChatMessage, fetchSandboxFiles, getActiveSandboxId]);
  
  const _restartViteServer = async () => {
    try {
      addChatMessage('Restarting Vite dev server...', 'system');
      
      const response = await fetch('/api/restart-vite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxId: sandboxData?.sandboxId })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          addChatMessage('✓ Vite dev server restarted successfully!', 'system');
          
          // Refresh the iframe after a short delay
          setTimeout(() => {
            const previewUrl = getPreviewUrl();
            if (iframeRef.current && previewUrl) {
              iframeRef.current.src = `${previewUrl}?t=${Date.now()}`;
            }
          }, 2000);
        } else {
          addChatMessage(`Failed to restart Vite: ${data.error}`, 'error');
        }
      } else {
        addChatMessage('Failed to restart Vite server', 'error');
      }
    } catch (error) {
      console.error('[restartViteServer] Error:', error);
      addChatMessage(`Error restarting Vite: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  };

  const _applyCode = async () => {
    const code = promptInput.trim();
    if (!code) {
      log('Please enter some code first', 'error');
      addChatMessage('No code to apply. Please generate code first.', 'system');
      return;
    }
    
    // Prevent double clicks
    if (loading) {
      console.log('[applyCode] Already loading, skipping...');
      return;
    }
    
    // Determine if this is an edit based on whether we have applied code before
    const isEdit = conversationContext.appliedCode.length > 0;
    await applyGeneratedCode(code, isEdit);
  };

  const renderMainContent = () => {
    const hasCodePanelContent = Boolean(
      selectedFile ||
      generationProgress.streamedCode ||
      generationProgress.currentFile ||
      generationProgress.files.length > 0
    );

    if (activeTab === 'generation' && (generationProgress.isGenerating || generationProgress.files.length > 0)) {
      return (
        /* Generation Tab Content */
        <div className="absolute inset-0 flex overflow-hidden">
          {/* File Explorer - Hide during edits */}
          {!generationProgress.isEdit && (
            <div className="hidden sm:flex w-full sm:w-[240px] md:w-[250px] sm:flex-col border-b sm:border-b-0 sm:border-r border-[#262626] bg-[#171717] flex-shrink-0">
            <div className="p-3 bg-[#262626] text-[#d4d4d4] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BsFolderFill className="w-5 h-5" />
                <span className="text-sm font-medium">Explorer</span>
              </div>
            </div>
            
            {/* File Tree */}
            <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
              <div className="text-sm">
                {/* Root app folder */}
                <div 
                  className="flex items-center gap-1 py-2 px-3 hover:bg-surface-ink-750 rounded cursor-pointer text-[#f5f5f5]"
                  onClick={() => toggleFolder(rootFolder)}
                >
                  {expandedFolders.has(rootFolder) ? (
                    <FiChevronDown className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <FiChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                  {expandedFolders.has(rootFolder) ? (
                    <BsFolder2Open className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <BsFolderFill className="w-5 h-5 text-emerald-500" />
                  )}
                  <span className="font-medium text-foreground">{rootFolderLabel}</span>
                </div>
                
                {expandedFolders.has(rootFolder) && (
                  <div className="ml-4">
                    {/* Group files by directory */}
                    {(() => {
                      const fileTree: { [key: string]: Array<{ name: string; path: string; edited?: boolean }> } = {};
                      
                      // Create a map of edited files
                       const editedFiles = new Set(
                         generationProgress.files
                           // edited flag may not exist on all entries
                           .filter((f: any) => !!(f as any).edited)
                           .map(f => f.path)
                       );
                      
                      // Process all files from generation progress
                      treeFiles.forEach(file => {
                        const parts = file.displayPath.split('/');
                        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                        const fileName = parts[parts.length - 1];
                        
                        if (!fileTree[dir]) fileTree[dir] = [];
                         fileTree[dir].push({
                           name: fileName,
                           path: file.fullPath,
                           edited: (file as any).edited || false
                         });
                      });
                      
                      return Object.entries(fileTree).map(([dir, files]) => (
                        <div key={dir} className="mb-1">
                          {dir && (
                            <div 
                              className="flex items-center gap-1 py-2 px-3 hover:bg-surface-ink-750 rounded cursor-pointer text-[#f5f5f5]"
                              onClick={() => toggleFolder(dir)}
                            >
                              {expandedFolders.has(dir) ? (
                                <FiChevronDown className="w-5 h-5 text-muted-foreground" />
                              ) : (
                                <FiChevronRight className="w-5 h-5 text-muted-foreground" />
                              )}
                              {expandedFolders.has(dir) ? (
                                <BsFolder2Open className="w-5 h-5 text-emerald-500" />
                              ) : (
                                <BsFolderFill className="w-5 h-5 text-emerald-500" />
                              )}
                              <span className="text-[#d4d4d4]">{dir.split('/').pop()}</span>
                            </div>
                          )}
                          {(!dir || expandedFolders.has(dir)) && (
                            <div className={dir ? 'ml-6' : ''}>
                              {files.sort((a, b) => a.name.localeCompare(b.name)).map(fileInfo => {
                                const fullPath = fileInfo.path;
                                const isSelected = selectedFile === fullPath;
                                
                                return (
                                  <div 
                                    key={fullPath} 
                                    className={`flex items-center gap-2 py-2 px-3 rounded cursor-pointer transition-all ${
                                      isSelected 
                                        ? 'bg-emerald-600 text-neutral-950' 
                                        : 'text-[#f5f5f5] hover:bg-surface-ink-750'
                                    }`}
                                    onClick={() => handleFileClick(fullPath)}
                                  >
                                    {getFileIcon(fileInfo.name)}
                                    <span className={`text-xs flex items-center gap-1 ${isSelected ? 'font-medium' : ''}`}>
                                      {fileInfo.name}
                                      {fileInfo.edited && (
                                        <span className={`text-[10px] px-1.5 rounded ${
                                        isSelected ? 'bg-emerald-500 text-neutral-950' : 'bg-orange-500 text-neutral-950'
                                        }`}>✓</span>
                                      )}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-[#262626] p-3">
              <div className="flex items-center justify-between text-[#d4d4d4]">
                <span className="text-xs font-semibold uppercase tracking-wider">Checkpoints</span>
                <button
                  type="button"
                  onClick={() => createCheckpoint()}
                  className="p-1 rounded hover:bg-[#2a2a2a] transition-colors"
                  title="Create checkpoint"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto scrollbar-hide">
                {checkpoints.length === 0 ? (
                  <div className="text-xs text-neutral-500">No checkpoints yet</div>
                ) : (
                  checkpoints.slice(-6).map((checkpoint) => (
                    <div
                      key={checkpoint.id}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-neutral-300 hover:bg-[#1f1f1f]"
                    >
                      <div className="flex flex-col overflow-hidden">
                        <span className="truncate">{checkpoint.label}</span>
                        <span className="text-[10px] text-neutral-500">{new Date(checkpoint.createdAt).toLocaleString()}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => restoreCheckpoint(checkpoint.id)}
                        className="p-1 rounded hover:bg-[#2a2a2a] transition-colors"
                        title="Restore checkpoint"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          )}
          
          {/* Code Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Thinking Mode Display - Only show during active generation */}
            {generationProgress.isGenerating && (generationProgress.isThinking || generationProgress.thinkingText) && (
              <div className="px-6 pb-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-emerald-500 font-medium flex items-center gap-2">
                    {generationProgress.isThinking ? (
                      <>
                        <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
                        AI is thinking...
                      </>
                    ) : (
                      <>
                        <span className="text-emerald-500">✓</span>
                        Thought for {generationProgress.thinkingDuration || 0} seconds
                      </>
                    )}
                  </div>
                </div>
                {generationProgress.thinkingText && (
                  <div className="bg-[#171717] border border-[#404040]/70 rounded-2xl p-4 max-h-48 overflow-y-auto scrollbar-hide">
                    <pre className="text-xs font-mono text-[#a3a3a3] whitespace-pre-wrap">
                      {generationProgress.thinkingText}
                    </pre>
                  </div>
                )}
              </div>
            )}
            
            {/* Live Code Display */}
            <div className="flex-1 rounded-2xl p-6 flex flex-col min-h-0 overflow-hidden">
              {hasCodePanelContent && (
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => setIsCodeExpanded(prev => !prev)}
                    className="inline-flex items-center gap-2 rounded-full border border-[#262626]/70 bg-[#171717] bg-opacity-70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#a3a3a3] hover:text-[#f5f5f5] hover:bg-surface-ink-750 hover:border-neutral-700 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                  >
                    {isCodeExpanded ? 'Collapse view' : 'Expand view'}
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto min-h-0 scrollbar-dark" ref={codeDisplayRef}>
                {/* Show selected file if one is selected */}
                {selectedFile ? (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="bg-[#171717] border border-[#262626] rounded-2xl overflow-hidden shadow-[var(--shadow-floating)]">
                      <div className="px-4 py-2 bg-[#262626] text-[#f5f5f5] flex items-center justify-between rounded-t-lg">
                        <div className="flex items-center gap-2">
                          {getFileIcon(selectedFile)}
                          <span className="font-mono text-sm">{selectedFile}</span>
                        </div>
                        <button
                          onClick={() => {
                            userSelectedFileRef.current = false;
                            setSelectedFile(null);
                          }}
                          className="hover:bg-black/20 p-1 rounded transition-colors"
                        >
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="relative bg-[#262626] bg-opacity-80 border border-[#262626] rounded-b-lg">
                        <SyntaxHighlighter
                          language={(() => {
                            const ext = selectedFile.split('.').pop()?.toLowerCase();
                            if (ext === 'css') return 'css';
                            if (ext === 'json') return 'json';
                            if (ext === 'html') return 'html';
                            return 'jsx';
                          })()}
                          style={vscDarkPlus}
                          className="scrollbar-dark"
                          customStyle={{
                            margin: 0,
                            padding: '1rem',
                            fontSize: '0.875rem',
                            background: 'transparent',
                            minHeight: CODE_PANEL_MIN_HEIGHT,
                            maxHeight: isCodeExpanded ? CODE_PANEL_EXPANDED_MAX_HEIGHT : CODE_PANEL_COLLAPSED_MAX_HEIGHT,
                            overflow: 'auto'
                          }}
                          showLineNumbers={true}
                        >
                          {(() => {
                            // Find the file content from generated files
                            const file = generationProgress.files.find(f => f.path === selectedFile);
                            return file?.content || '// File content will appear here';
                          })()}
                        </SyntaxHighlighter>
                        {!isCodeExpanded && (
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-800 via-neutral-800 to-transparent" />
                        )}
                      </div>
                    </div>
                  </div>
                ) : /* If no files parsed yet, show loading or raw stream */
                generationProgress.files.length === 0 && !generationProgress.currentFile ? (
                  generationProgress.isThinking ? (
                    // Beautiful loading state while thinking
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="mb-6">
                          <div className="w-12 h-12 border-3 border-[#262626] border-t-neutral-600 rounded-full animate-spin mx-auto" />
                        </div>
                        <h3 className="text-xl font-medium text-white mb-2">AI is analyzing your request</h3>
                        <p className="text-muted-foreground text-sm">{generationProgress.status || 'Preparing to generate code...'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[#171717] border border-[#262626] rounded-xl overflow-hidden shadow-[var(--shadow-floating)]">
                      <div className="px-4 py-2 bg-[#262626] text-[#d4d4d4] flex items-center justify-between rounded-t-xl">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                          <span className="font-mono text-sm">Streaming code...</span>
                        </div>
                      </div>
                      <div className="relative p-4 bg-[#171717] bg-opacity-80 rounded-b-xl">
                        <SyntaxHighlighter
                          language="jsx"
                          style={vscDarkPlus}
                          className="scrollbar-dark"
                          customStyle={{
                            margin: 0,
                            padding: '1rem',
                            fontSize: '0.875rem',
                            background: 'transparent',
                            minHeight: CODE_PANEL_MIN_HEIGHT,
                            maxHeight: isCodeExpanded ? CODE_PANEL_EXPANDED_MAX_HEIGHT : CODE_PANEL_COLLAPSED_MAX_HEIGHT,
                            overflow: 'auto'
                          }}
                          showLineNumbers={true}
                        >
                          {generationProgress.streamedCode || 'Starting code generation...'}
                        </SyntaxHighlighter>
                        <span className="inline-block w-2 h-4 bg-orange-400 ml-1 animate-pulse" />
                        {!isCodeExpanded && (
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-900 via-neutral-900 to-transparent rounded-b-xl" />
                        )}
                      </div>
                    </div>
                  )
                ) : (
                  <div className="space-y-4">
                    {/* Show current file being generated */}
                    {generationProgress.currentFile && (
                      <div className="bg-[#171717] border border-[#262626] rounded-xl overflow-hidden shadow-[var(--shadow-floating)]">
                        <div className="px-4 py-2.5 bg-[#262626] text-[#d4d4d4] flex items-center justify-between rounded-t-xl">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                            <span className="font-mono text-sm">{generationProgress.currentFile.path}</span>
                            <span className={`px-2 py-0.5 text-xs rounded ${
                              generationProgress.currentFile.type === 'css' ? 'bg-emerald-500/20 text-emerald-500' :
                              generationProgress.currentFile.type === 'javascript' ? 'bg-orange-500/20 text-orange-500' :
                              generationProgress.currentFile.type === 'json' ? 'bg-emerald-600/20 text-emerald-600' :
                              'bg-[#404040] text-[#a3a3a3]'
                            }`}>
                              {generationProgress.currentFile.type === 'javascript' ? 'JSX' : generationProgress.currentFile.type.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      <div className="relative bg-[#171717] bg-opacity-80 border border-[#262626] rounded-b-xl">
                          <SyntaxHighlighter
                            language={
                              generationProgress.currentFile.type === 'css' ? 'css' :
                              generationProgress.currentFile.type === 'json' ? 'json' :
                              generationProgress.currentFile.type === 'html' ? 'html' :
                              'jsx'
                            }
                            style={vscDarkPlus}
                            className="scrollbar-dark"
                            customStyle={{
                              margin: 0,
                              padding: '1rem',
                              fontSize: '0.75rem',
                              background: 'transparent',
                              minHeight: CODE_PANEL_MIN_HEIGHT,
                              maxHeight: isCodeExpanded ? CODE_PANEL_EXPANDED_MAX_HEIGHT : CODE_PANEL_COLLAPSED_MAX_HEIGHT,
                              overflow: 'auto'
                            }}
                            showLineNumbers={true}
                          >
                            {generationProgress.currentFile.content}
                          </SyntaxHighlighter>
                          <span className="inline-block w-2 h-3 bg-orange-400 ml-4 mb-4 animate-pulse" />
                          {!isCodeExpanded && (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-900 via-neutral-900 to-transparent rounded-b-xl" />
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Show completed files */}
                    {generationProgress.files.map((file, idx) => (
                      <div key={idx} className="bg-[#171717] border border-[#262626] rounded-xl overflow-hidden shadow-sm">
                        <div className="px-4 py-2.5 bg-[#262626] text-[#d4d4d4] flex items-center justify-between rounded-t-xl">
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-600">✓</span>
                            <span className="font-mono text-sm">{file.path}</span>
                          </div>
                          <span className={`px-2 py-0.5 text-xs rounded-xl ${
                            file.type === 'css' ? 'bg-emerald-500/20 text-emerald-500' :
                            file.type === 'javascript' ? 'bg-orange-500/20 text-orange-500' :
                            file.type === 'json' ? 'bg-emerald-600/20 text-emerald-600' :
                            'bg-[#404040] text-[#a3a3a3]'
                          }`}>
                            {file.type === 'javascript' ? 'JSX' : file.type.toUpperCase()}
                          </span>
                        </div>
                        <div className="relative bg-[#171717] bg-opacity-80 border border-[#262626] rounded-b-xl">
                          <SyntaxHighlighter
                            language={
                              file.type === 'css' ? 'css' :
                              file.type === 'json' ? 'json' :
                              file.type === 'html' ? 'html' :
                              'jsx'
                            }
                            style={vscDarkPlus}
                            className="scrollbar-dark"
                            customStyle={{
                              margin: 0,
                              padding: '1rem',
                              fontSize: '0.75rem',
                              background: 'transparent',
                              minHeight: CODE_PANEL_MIN_HEIGHT,
                              maxHeight: isCodeExpanded ? CODE_PANEL_EXPANDED_MAX_HEIGHT : CODE_PANEL_COLLAPSED_MAX_HEIGHT,
                              overflow: 'auto'
                            }}
                            showLineNumbers={true}
                            wrapLongLines={true}
                          >
                            {file.content}
                          </SyntaxHighlighter>
                          {!isCodeExpanded && (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-900 via-neutral-900 to-transparent rounded-b-xl" />
                          )}
                        </div>
                      </div>
                    ))}
                    
                    {/* Show remaining raw stream if there's content after the last file */}
                    {!generationProgress.currentFile && generationProgress.streamedCode.length > 0 && generationProgress.isGenerating && (
                      <div className="bg-[#171717] border border-[#262626] rounded-xl overflow-hidden shadow-sm">
                        <div className="px-4 py-2.5 bg-[#262626] text-[#d4d4d4] flex items-center justify-between rounded-t-xl">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                            <span className="font-mono text-sm">Processing...</span>
                          </div>
                        </div>
                        <div className="relative bg-[#171717] bg-opacity-80 border border-[#262626] rounded-b-xl">
                          <SyntaxHighlighter
                            language="jsx"
                            style={vscDarkPlus}
                            className="scrollbar-dark"
                            customStyle={{
                              margin: 0,
                              padding: '1rem',
                              fontSize: '0.75rem',
                              background: 'transparent',
                              minHeight: CODE_PANEL_MIN_HEIGHT,
                              maxHeight: isCodeExpanded ? CODE_PANEL_EXPANDED_MAX_HEIGHT : CODE_PANEL_COLLAPSED_MAX_HEIGHT,
                              overflow: 'auto'
                            }}
                            showLineNumbers={false}
                          >
                            {(() => {
                              // Show only the tail of the stream after the last file
                              const lastFileEnd = generationProgress.files.length > 0 
                                ? generationProgress.streamedCode.lastIndexOf('</file>') + 7
                                : 0;
                              let remainingContent = generationProgress.streamedCode.slice(lastFileEnd).trim();
                              
                              // Remove explanation tags and content
                              remainingContent = remainingContent.replace(/<explanation>[\s\S]*?<\/explanation>/g, '').trim();
                              
                              // If only whitespace or nothing left, show waiting message (only during generation)
                              return remainingContent || '';
                            })()}
                          </SyntaxHighlighter>
                          {!isCodeExpanded && (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-900 via-neutral-900 to-transparent rounded-b-xl" />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            {/* Progress indicator */}
            {generationProgress.components.length > 0 && (
              <div className="mx-6 mb-6">
                <div className="h-2 bg-surface-ink-750 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 transition-all duration-300"
                    style={{
                      width: `${(generationProgress.currentComponent / Math.max(generationProgress.components.length, 1)) * 100}%`
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      );
    } else if (activeTab === 'preview') {
      // Show screenshot when we have one and (loading OR generating OR no sandbox yet)
      const previewUrl = getPreviewUrl();
      if (urlScreenshot && (loading || generationProgress.isGenerating || !previewUrl || isPreparingDesign)) {
        return (
          <div className="absolute inset-0 w-full h-full bg-[#171717] relative">
            <NextImage
              src={urlScreenshot}
              alt="Website preview"
              fill
              className="object-contain"
              unoptimized
              sizes="100vw"
            />
            {(generationProgress.isGenerating || isPreparingDesign) && (
              <div className="absolute inset-0 bg-[#0a0a0a] bg-opacity-60 backdrop-blur-sm flex items-center justify-center">
                <div className="text-center bg-[#171717] bg-opacity-90 rounded-2xl px-8 py-7 backdrop-blur-md border border-[#262626]/70 shadow-[var(--shadow-elevated)]">
                  <div className="w-14 h-14 border-4 border-emerald-500/30 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-[#d4d4d4] text-base font-medium">
                    {generationProgress.isGenerating ? 'Generating code...' : `Preparing your design for ${targetUrl}...`}
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      }
      
      // Check loading stage FIRST to prevent showing old sandbox
      // Don't show loading overlay for edits
      if (loadingStage || (generationProgress.isGenerating && !generationProgress.isEdit)) {
        return (
          <div className="absolute inset-0 w-full h-full bg-[#171717] flex items-center justify-center">
            <div className="text-center">
              <div className="mb-8">
                <div className="w-16 h-16 border-4 border-emerald-500/30 border-t-emerald-600 rounded-full animate-spin mx-auto"></div>
              </div>
              <h3 className="text-xl font-semibold text-[#d4d4d4] mb-2">
                {loadingStage === 'gathering' && 'Gathering website information...'}
                {loadingStage === 'planning' && 'Planning your design...'}
                {(loadingStage === 'generating' || generationProgress.isGenerating) && 'Generating your application...'}
              </h3>
              <p className="text-[#737373] text-sm">
                {loadingStage === 'gathering' && 'Analyzing the website structure and content'}
                {loadingStage === 'planning' && 'Creating the optimal React component architecture'}
                {(loadingStage === 'generating' || generationProgress.isGenerating) && 'Writing clean, modern code for your app'}
              </p>
            </div>
          </div>
        );
      }
      
      // Show sandbox iframe only when not in any loading state
      if (previewUrl && !loading) {
        return (
          <div className="absolute inset-0 w-full h-full">
            <iframe
              key={iframeRevision}
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-none"
              title="Chutes Webcoder Sandbox"
              allow="clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              onLoad={() => setIframeLoaded(true)}
            />
            {/* Refresh button */}
            <button
              onClick={() => {
                if (iframeRef.current && previewUrl) {
                  console.log('[Manual Refresh] Forcing iframe reload...');
                  const newSrc = `${previewUrl}?t=${Date.now()}&manual=true`;
                  iframeRef.current.src = newSrc;
                }
              }}
              className="absolute bottom-5 right-5 bg-[#171717] bg-opacity-90 hover:bg-[#262626] text-[#d4d4d4] p-2.5 rounded-xl shadow-[var(--shadow-floating)] transition-all duration-200 hover:scale-105 border border-[#262626]/70"
              title="Refresh sandbox"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        );
      }
      
      // Show loading animation when capturing screenshot
      if (isCapturingScreenshot) {
        return (
          <div className="flex items-center justify-center h-full bg-[#171717]">
            <div className="text-center">
              <div className="w-14 h-14 border-4 border-emerald-500/30 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-medium text-[#d4d4d4]">Gathering website information</h3>
            </div>
          </div>
        );
      }
      
      // Default state when no sandbox and no screenshot
      return (
        <div className="flex items-center justify-center h-full bg-[#171717] text-[#737373] text-lg">
          {screenshotError ? (
            <div className="text-center">
              <p className="mb-2">Failed to capture screenshot</p>
              <p className="text-sm text-[#737373]">{screenshotError}</p>
            </div>
          ) : sandboxData ? (
            <div className="text-muted-foreground">
              <div className="w-8 h-8 border-2 border-neutral-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-sm">Loading preview...</p>
            </div>
          ) : (
            <div className="text-muted-foreground text-center">
              <p className="text-sm">Start chatting to create your first app</p>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const sendChatMessage = async (overrideMessage?: string, retryCount: number = 0) => {
    const MAX_RETRIES = 2;
    const message = (overrideMessage ?? aiChatInput).trim();
    console.log('[sendChatMessage] Called with message:', message?.substring(0, 50), '...');
    console.log('[sendChatMessage] Auth state:', { isAuthenticated, isAuthLoading });
    console.log('[sendChatMessage] Sandbox state:', { hasSandbox: !!sandboxData, sandboxId: sandboxData?.sandboxId });
    console.log('[sendChatMessage] Retry count:', retryCount);
    
    if (!message) {
      console.log('[sendChatMessage] Empty message, returning');
      return;
    }

    lastUserPromptRef.current = message;
    
    // Prevent infinite retry loops
    if (retryCount > MAX_RETRIES) {
      console.error('[sendChatMessage] Max retries exceeded');
      addChatMessage('Request failed after multiple retries. Please refresh the page and try again.', 'system');
      return;
    }
    
    const authReady = await checkAuthAndProceed(
      async () => true,
      'generate',
      { prompt: message }
    );
    if (!authReady) {
      console.log('[sendChatMessage] Auth required, redirecting to login');
      return;
    }
    
    if (!aiEnabled) {
      console.log('[sendChatMessage] AI disabled');
      addChatMessage('AI is disabled. Please enable it first.', 'system');
      return;
    }
    
    console.log('[sendChatMessage] Adding user message and starting generation');
    addChatMessage(message, 'user');
    if (!overrideMessage) {
      setAiChatInput('');
    }
    
    // Check for special commands
    const lowerMessage = message.toLowerCase().trim();
    if (lowerMessage === 'check packages' || lowerMessage === 'install packages' || lowerMessage === 'npm install') {
      if (!sandboxData) {
        // Start or wait for sandbox implicitly
        await createSandbox(true, false);
      }
      await checkAndInstallPackages();
      return;
    }
    
    // IMPORTANT: Always check if sandbox creation is in progress
    // This prevents race conditions where we use an old sandboxId while a new one is being created
    let sandboxPromise: Promise<{ sandboxId: string; url: string; sandboxUrl?: string }> | null = null;
    let sandboxCreating = false;
    
    // Check if there's already a sandbox creation in progress (from home page auto-create, etc.)
    if (creatingSandboxRef.current) {
      sandboxCreating = true;
      sandboxPromise = creatingSandboxRef.current;
      console.log('[sendChatMessage] Sandbox creation already in progress, will wait for it...');
    } else if (!sandboxData) {
      sandboxCreating = true;
      console.log('[sendChatMessage] No sandbox, creating one...');
      addChatMessage('Creating sandbox...', 'system');
      sandboxPromise = createSandbox(true, false).catch((error: any) => {
        console.error('[sendChatMessage] Sandbox creation failed:', error);
        addChatMessage(`Failed to create sandbox: ${error.message}`, 'system');
        throw error;
      }) as Promise<{ sandboxId: string; url: string; sandboxUrl?: string }>;
    } else {
      console.log('[sendChatMessage] Using existing sandbox:', sandboxData.sandboxId);
    }
    
    // Determine if this is an edit
    const isEdit = conversationContext.appliedCode.length > 0;

    let useExternalAgent = false;
    let effectiveSandboxId: string | null = null;
    let effectiveSandboxUrl = getPreviewUrl();

    // ALWAYS wait for sandbox creation if it's in progress
    effectiveSandboxId = sandboxData?.sandboxId || null;
    
    if (sandboxCreating && sandboxPromise) {
      console.log('[sendChatMessage] Waiting for sandbox creation before AI call...');
      if (!sandboxData) {
        addChatMessage('Creating sandbox...', 'system');
      }
      try {
        const createdSandbox = await sandboxPromise;
        // ALWAYS use the newly created sandbox, not the old one
        effectiveSandboxId = createdSandbox.sandboxId;
        effectiveSandboxUrl = createdSandbox.sandboxUrl || createdSandbox.url;
        console.log('[sendChatMessage] Sandbox ready:', effectiveSandboxId);
        // Remove the "Creating sandbox..." message
        setChatMessages(prev => prev.filter(msg => msg.content !== 'Creating sandbox...'));
      } catch (error: any) {
        console.error('[sendChatMessage] Sandbox creation failed:', error);
        addChatMessage(`Failed to create sandbox: ${error.message}`, 'system');
        return;
      }
    }
    
    try {
      // Generation tab is already active from scraping phase
      if (!isMobilePortraitLayout) {
        setActiveTab('generation');
      }
      userSelectedFileRef.current = false;
      setSelectedFile(null);
      setGenerationProgress(prev => ({
        ...prev,  // Preserve all existing state
        isGenerating: true,
        status: 'Starting AI generation...',
        components: [],
        currentComponent: 0,
        streamedCode: '',
        isStreaming: false,
        isThinking: true,
        thinkingText: 'Analyzing your request...',
        thinkingDuration: undefined,
        currentFile: undefined,
        lastProcessedPosition: 0,
        // Add isEdit flag to generation progress
        isEdit: isEdit,
        // Keep existing files for edits - we'll mark edited ones differently
        files: prev.files
      }));
      
      // Backend now manages file state - no need to fetch from frontend
      console.log('[chat] Using backend file cache for context');
      
      const fullContext = {
        sandboxId: effectiveSandboxId || null,
        structure: structureContent,
        recentMessages: chatMessages.slice(-20),
        conversationContext: conversationContext,
        currentCode: promptInput,
        sandboxUrl: effectiveSandboxUrl,
        sandboxCreating: false // Sandbox is now ready
      };
      
      // Debug what we're sending
      console.log('[chat] Sending context to AI:');
      console.log('[chat] - sandboxId:', fullContext.sandboxId);
      console.log('[chat] - isEdit:', conversationContext.appliedCode.length > 0);
      console.log('[chat] - model:', aiModel);
      console.log('[chat] - agent:', selectedAgent);
      console.log('[chat] - prompt:', message.substring(0, 100));
      
      // Determine which API to use based on selected agent
      useExternalAgent = selectedAgent !== 'builtin' && Boolean(effectiveSandboxId);
      const apiEndpoint = useExternalAgent ? '/api/agent-run' : '/api/generate-ai-code-stream';
      
      console.log(`[chat] Making fetch request to ${apiEndpoint}...`);
      
      const requestBody = useExternalAgent 
        ? {
            agent: selectedAgent,
            model: aiModel,
            prompt: message,
            sandboxId: effectiveSandboxId,
          }
        : {
            prompt: message,
            model: aiModel,
            context: fullContext,
            isEdit: conversationContext.appliedCode.length > 0
          };
      
      if (agentAbortRef.current) {
        try {
          agentAbortRef.current.abort();
        } catch {}
      }
      agentAbortRef.current = new AbortController();
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: agentAbortRef.current.signal
      });
      
      console.log('[chat] Fetch response received:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[chat] API error response:', errorText);
        
        // Special handling for 404 Sandbox not found - auto-retry with new sandbox
        if (response.status === 404 && errorText.includes('Sandbox') && errorText.includes('not found')) {
          console.log('[chat] Sandbox not found, auto-creating new one and retrying... (attempt', retryCount + 1, ')');
          // Clear the stale sandbox data
          setSandboxData(null);
          
          if (retryCount < MAX_RETRIES) {
            addChatMessage('Sandbox expired. Recreating and retrying...', 'system');
            
            try {
              // Create a new sandbox
              const newSandbox = await createSandbox(true, false);
              if (newSandbox?.sandboxId) {
                console.log('[chat] New sandbox created:', newSandbox.sandboxId, '- retrying request');
                // Remove the "expired" message and retry with new sandbox (increment retry count)
                setChatMessages(prev => prev.filter(msg => msg.content !== 'Sandbox expired. Recreating and retrying...'));
                // Retry with incremented count to prevent infinite loops
                await sendChatMessage(message, retryCount + 1);
              } else {
                addChatMessage('Failed to create new sandbox. Please try again.', 'system');
              }
            } catch (retryError: any) {
              console.error('[chat] Auto-retry failed:', retryError);
              addChatMessage(`Retry failed: ${retryError.message}. Please refresh the page.`, 'system');
            }
          } else {
            addChatMessage('Sandbox creation failed after multiple attempts. Please refresh the page.', 'system');
          }
          return;
        }
        
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const sseBuffer = new SSEJsonBuffer();
      let generatedCode = '';
      let explanation = '';
      let aggregatedStream = '';
      let externalAgentCompleted = false;
      
      console.log('[chat] Starting to read stream...');
      let chunkCount = 0;
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          const chunk = done ? '' : decoder.decode(value, { stream: true });
          if (!done) {
            chunkCount++;
            if (chunkCount <= 3) {
              console.log('[chat] Chunk', chunkCount, ':', chunk.substring(0, 200));
            }
          }
          const { jsonObjects } = sseBuffer.addChunk(chunk, done);
          
          for (const data of jsonObjects) {
            try {
              if (chunkCount <= 3) {
                console.log('[chat] Parsed data type:', data.type);
              }
                
                // Handle agent-run specific output types
                if (data.type === 'agent-output') {
                  // Use the improved parser for Claude Code output
                  const parsed = parseClaudeCodeOutput(data.data);

                    if (shouldDisplayMessage(parsed)) {
                      if (parsed.type === 'user-friendly') {
                        addChatMessage(parsed.content, 'ai');
                      } else if (parsed.type === 'tool-use') {
                        // Show tool use as status, not as chat message
                        setGenerationProgress(prev => ({
                          ...prev,
                          status: parsed.content,
                          isStreaming: true
                        }));
                        upsertSystemMessage(parsed.content, 'progress');
                        // Also extract file path for tracking
                        if (parsed.metadata?.filePath) {
                          const filePath = parsed.metadata.filePath;
                          const fileName = filePath.split('/').pop() || filePath;
                        setGenerationProgress(prev => {
                          // Check if we already have this file
                          const exists = prev.files.some(f => f.path === filePath);
                          if (exists) return prev;

                          const ext = fileName.split('.').pop() || '';
                          const fileType = ext === 'jsx' || ext === 'js' ? 'javascript' :
                                          ext === 'css' ? 'css' :
                                          ext === 'json' ? 'json' : 'text';
                          return {
                            ...prev,
                            files: [...prev.files, {
                              path: filePath,
                              content: '',
                              type: fileType,
                              completed: false
                            }]
                          };
                        });
                      }
                    } else if (parsed.type === 'thinking') {
                      setGenerationProgress(prev => ({
                        ...prev,
                        isThinking: true,
                        thinkingText: parsed.content
                      }));
                    } else if (parsed.type === 'error') {
                      addChatMessage(parsed.content, 'error');
                      clearSystemMessage('progress');
                    }
                  }
                } else if (data.type === 'output') {
                  // Plain text output from agent - clean it first
                  const cleaned = data.text?.trim();
                  if (cleaned && cleaned.length > 0) {
                    // Skip if it looks like JSON or a JSON fragment
                    if (cleaned.startsWith('{') || cleaned.startsWith('"type":') ||
                        cleaned.startsWith('ype":') || cleaned.includes('"message":{"content":') ||
                        cleaned.includes('"subtype":"init"') || cleaned.includes('"session_id":')) {
                      // Skip JSON fragments
                      console.log('[chat] Skipping JSON fragment from output');
                    } else {
                      // Only show lines that look like human-readable explanations
                      // Skip technical lines (code, commands, etc.)
                      const isExplanation = (
                        cleaned.includes('**') || // Markdown formatting
                        cleaned.includes('✓') || cleaned.includes('✅') || cleaned.includes('✔') || // Success indicators
                        cleaned.includes('apply_patch') ||
                        cleaned.includes('Updated the following files') ||
                        cleaned.includes('created') || cleaned.includes('Created') ||
                        cleaned.includes('built') || cleaned.includes('Built') ||
                        cleaned.includes('updated') || cleaned.includes('Updated') ||
                        cleaned.includes('applied') || cleaned.includes('Applied') ||
                        cleaned.includes('saved') || cleaned.includes('Saved') ||
                        cleaned.includes('writing') || cleaned.includes('Writing') ||
                        cleaned.includes('edited') || cleaned.includes('Editing') ||
                        cleaned.includes('installing') || cleaned.includes('Installing') ||
                        cleaned.includes('running') || cleaned.includes('Running') ||
                        cleaned.includes('generated') || cleaned.includes('Generating') ||
                        cleaned.includes('Done') || cleaned.includes('done') ||
                        cleaned.includes('Ready') || cleaned.includes('ready') ||
                        cleaned.includes('successfully') ||
                        cleaned.startsWith('I') || cleaned.startsWith("I'") || // Agent speaking
                        cleaned.startsWith('The ') || cleaned.startsWith('Your ') ||
                        cleaned.startsWith('Check ') || cleaned.startsWith('Now ') ||
                        cleaned.includes('counter') || cleaned.includes('component') ||
                        cleaned.includes('button') || cleaned.includes('feature') ||
                        cleaned.match(/\\b(app|page|file|component)\\b/i)
                      );
                      
                      if (isExplanation) {
                        addChatMessage(cleaned, 'ai');
                      }
                    }
                  }
                } else if (data.type === 'stderr') {
                  // Stderr from agent - show as warning
                  console.warn('[agent] stderr:', data.text);
                } else if (data.type === 'status') {
                  // Show status messages both in progress bar and chat
                  setGenerationProgress(prev => ({ ...prev, status: data.message }));
                  // Also add important status messages to chat for visibility
                  if (data.message && !data.message.includes('Processing')) {
                    addChatMessage(data.message, 'system');
                  }
                } else if (data.type === 'heartbeat') {
                  // Keep-alive event - always update status with current elapsed time
                  const lastUpdate = lastFileUpdateRef.current;
                  const progressText = lastUpdate
                    ? `Processing... (${Math.round(data.elapsed)}s) - ${lastUpdate}`
                    : `Processing... (${Math.round(data.elapsed)}s)`;
                  setGenerationProgress(prev => {
                    if (prev.status && !prev.status.startsWith('Processing')) {
                      return prev;
                    }
                    return {
                      ...prev,
                      status: progressText
                    };
                  });
                  upsertSystemMessage(progressText, 'progress');
                } else if (data.type === 'files-update') {
                  // Agent detected new files - add them to the file list
                    if (data.files && data.files.length > 0) {
                      console.log('[chat] Agent detected new files:', data.files);
                      const changeTypeMap = new Map<string, 'created' | 'modified'>();
                      let changeList: Array<{ path: string; changeType: 'created' | 'modified' }> = [];
                      if (Array.isArray(data.changes)) {
                        for (const change of data.changes) {
                          if (change?.path && change?.changeType) {
                            changeTypeMap.set(change.path, change.changeType);
                          }
                        }
                        changeList = data.changes as Array<{ path: string; changeType: 'created' | 'modified' }>;
                      }

                    if (!userSelectedFileRef.current) {
                      const lastFile = data.files[data.files.length - 1];
                      const lastPath = typeof lastFile === 'string' ? lastFile : lastFile?.path;
                      if (lastPath) {
                        setSelectedFile(lastPath);
                      }
                    }

                    setGenerationProgress(prev => {
                      // Handle both old format (string[]) and new format ({path, content}[])
                      const incomingFiles: Array<{
                        path: string;
                        content: string;
                        type: string;
                        completed: boolean;
                        edited?: boolean;
                        lastUpdated?: number;
                      }> = data.files.map((fileEntry: string | {path: string; content: string}) => {
                        const filePath = typeof fileEntry === 'string' ? fileEntry : fileEntry.path;
                        const fileContent = typeof fileEntry === 'string' ? '' : (fileEntry.content || '');
                        const entryChangeType = typeof fileEntry === 'string'
                          ? changeTypeMap.get(filePath)
                          : (fileEntry as any).changeType || changeTypeMap.get(filePath);
                        const ext = filePath.split('.').pop() || '';
                        return {
                          path: filePath,
                          content: fileContent,
                          type: ext === 'jsx' || ext === 'js' ? 'javascript' :
                                ext === 'css' ? 'css' :
                                ext === 'json' ? 'json' :
                                ext === 'html' ? 'html' : 'text',
                          completed: fileContent.length > 0,
                          edited: entryChangeType === 'modified',
                          lastUpdated: Date.now(),
                          truncated: fileContent.length >= 10240
                        };
                      });

                      // Merge with existing files: update content if file exists with empty content
                      const existingPathsMap = new Map(prev.files.map(f => [f.path, f]));
                      const updatedFiles = [...prev.files];
                      const newFiles: typeof updatedFiles = [];

                      for (const incoming of incomingFiles) {
                        const existing = existingPathsMap.get(incoming.path);
                        if (existing) {
                          const hasNewContent = Boolean(incoming.content);
                          const contentChanged = hasNewContent && incoming.content !== existing.content;
                          if (contentChanged || (incoming.edited && !existing.edited)) {
                            const idx = updatedFiles.findIndex(f => f.path === incoming.path);
                            if (idx >= 0) {
                              updatedFiles[idx] = {
                                ...existing,
                                content: hasNewContent ? incoming.content : existing.content,
                                completed: hasNewContent ? true : existing.completed,
                                edited: incoming.edited || existing.edited,
                                lastUpdated: incoming.lastUpdated || Date.now()
                              };
                            }
                          }
                        } else {
                          newFiles.push(incoming);
                        }
                      }

                      const fallbackChanges: Array<{ path: string; changeType: 'created' | 'modified' }> =
                        incomingFiles.map(file => ({
                          path: file.path,
                          changeType: (file.edited ? 'modified' : 'created')
                        }));
                      const effectiveChanges = changeList.length > 0 ? changeList : fallbackChanges;

                      if (effectiveChanges.length > 0) {
                        queueFileUpdates(effectiveChanges);
                      }

                      const changeSummary = (() => {
                        const changes = effectiveChanges;
                        if (changes.length === 1) {
                          const action = changes[0].changeType === 'modified' ? 'Updated' : 'Created';
                          return `${action} ${changes[0].path}`;
                        }
                        const createdCount = changes.filter((c: any) => c.changeType !== 'modified').length;
                        const updatedCount = changes.filter((c: any) => c.changeType === 'modified').length;
                        if (createdCount && updatedCount) {
                          return `Created ${createdCount}, updated ${updatedCount} files...`;
                        }
                        if (createdCount) {
                          return `Created ${createdCount} files...`;
                        }
                        if (updatedCount) {
                          return `Updated ${updatedCount} files...`;
                        }
                        return data.totalFiles ? `Detected ${data.totalFiles} files...` : prev.status;
                      })();

                      return {
                        ...prev,
                        files: [...updatedFiles, ...newFiles],
                        status: changeSummary
                      };
                    });
                  }
                } else if (data.type === 'thinking') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: true,
                    thinkingText: (prev.thinkingText || '') + data.text
                  }));
                } else if (data.type === 'thinking_complete') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: false,
                    thinkingDuration: data.duration
                  }));
                } else if (data.type === 'conversation') {
                  // Add conversational text to chat only if it's not code
                  let text = data.text || '';
                  
                  // Remove package tags from the text
                  text = text.replace(/<package>[^<]*<\/package>/g, '');
                  text = text.replace(/<packages>[^<]*<\/packages>/g, '');
                  
                  // Filter out any XML tags and file content that slipped through
                  if (!text.includes('<file') && !text.includes('import React') && 
                      !text.includes('export default') && !text.includes('className=') &&
                      text.trim().length > 0) {
                    addChatMessage(text.trim(), 'ai');
                  }
                } else if (data.type === 'stream' && data.raw) {
                  aggregatedStream += data.text || '';
                  setGenerationProgress(prev => {
                    const newStreamedCode = prev.streamedCode + data.text;
                    
                    // Tab is already switched after scraping
                    
                    const updatedState = { 
                      ...prev, 
                      streamedCode: newStreamedCode,
                      isStreaming: true,
                      isThinking: false,
                      status: 'Generating code...'
                    };
                    
                    // Process complete files from the accumulated stream
                    const fileRegex = /<file path="([^"]+)">([^]*?)<\/file>/g;
                    let match;
                    const processedFiles = new Set(prev.files.map(f => f.path));
                    
                    while ((match = fileRegex.exec(newStreamedCode)) !== null) {
                      const filePath = match[1];
                      const fileContent = match[2];
                      
                      // Only add if we haven't processed this file yet
                      if (!processedFiles.has(filePath)) {
                        const fileExt = filePath.split('.').pop() || '';
                        const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                        fileExt === 'css' ? 'css' :
                                        fileExt === 'json' ? 'json' :
                                        fileExt === 'html' ? 'html' : 'text';
                        
                        // Check if file already exists
                        const existingFileIndex = updatedState.files.findIndex(f => f.path === filePath);
                        
                        if (existingFileIndex >= 0) {
                          // Update existing file and mark as edited
                          updatedState.files = [
                            ...updatedState.files.slice(0, existingFileIndex),
                            {
                              ...updatedState.files[existingFileIndex],
                              content: fileContent.trim(),
                              type: fileType,
                              completed: true
                            } as any,
                            ...updatedState.files.slice(existingFileIndex + 1)
                          ];
                        } else {
                          // Add new file
                          updatedState.files = [...updatedState.files, {
                            path: filePath,
                            content: fileContent.trim(),
                            type: fileType,
                            completed: true
                          } as any];
                        }
                        
                        // Only show file status if not in edit mode
                        if (!prev.isEdit) {
                          updatedState.status = `Completed ${filePath}`;
                        }
                        processedFiles.add(filePath);
                      }
                    }
                    
                    // Check for current file being generated (incomplete file at the end)
                    const lastFileMatch = newStreamedCode.match(/<file path="([^"]+)">([^]*?)$/);
                    if (lastFileMatch && !lastFileMatch[0].includes('</file>')) {
                      const filePath = lastFileMatch[1];
                      const partialContent = lastFileMatch[2];
                      
                      if (!processedFiles.has(filePath)) {
                        const fileExt = filePath.split('.').pop() || '';
                        const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                        fileExt === 'css' ? 'css' :
                                        fileExt === 'json' ? 'json' :
                                        fileExt === 'html' ? 'html' : 'text';
                        
                        updatedState.currentFile = { 
                          path: filePath, 
                          content: partialContent, 
                          type: fileType 
                        };
                        // Only show file status if not in edit mode
                        if (!prev.isEdit) {
                          updatedState.status = `Generating ${filePath}`;
                        }
                      }
                    } else {
                      updatedState.currentFile = undefined;
                    }
                    
                    return updatedState;
                  });
                } else if (data.type === 'app') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    status: 'Generated App.jsx structure'
                  }));
                } else if (data.type === 'component') {
                  setGenerationProgress(prev => ({
                    ...prev,
                    status: `Generated ${data.name}`,
                    components: [...prev.components, { 
                      name: data.name, 
                      path: data.path, 
                      completed: true 
                    }],
                    currentComponent: data.index
                  }));
                } else if (data.type === 'package') {
                  // Handle package installation from tool calls
                  setGenerationProgress(prev => ({
                    ...prev,
                    status: data.message || `Installing ${data.name}`
                  }));
                } else if (data.type === 'complete') {
                  // Check if this is from external agent (has exitCode) or builtin agent (has generatedCode)
                  if (typeof data.exitCode !== 'undefined') {
                    // External agent (Claude Code, Codex, Aider) complete
                    console.log('[chat] External agent complete. exitCode:', data.exitCode, 'success:', data.success);
                    externalAgentCompleted = true;

                    // Clear thinking state
                    setGenerationProgress(prev => ({
                      ...prev,
                      isThinking: false,
                      thinkingText: undefined,
                      thinkingDuration: undefined,
                      isGenerating: false,
                      isStreaming: false,
                      status: data.cancelled
                        ? 'Agent cancelled'
                        : data.success
                          ? 'Agent completed successfully!'
                          : 'Agent finished with errors'
                    }));
                    clearSystemMessage('progress');

                    if (data.cancelled) {
                      addChatMessage('Agent cancelled. You can resume by sending another message.', 'system');
                      return;
                    }

                    if (data.success) {
                      // Agent completed successfully - the app should be running in sandbox
                      addChatMessage('Agent completed successfully! Your app is now running in the preview.', 'ai');

                      // Mark all tracked files as completed
                      setGenerationProgress(prev => ({
                        ...prev,
                        files: prev.files.map(f => ({ ...f, completed: true }))
                      }));

                      // Refresh file list from sandbox
                      console.log('[chat] Fetching sandbox files after agent completion');
                      const activeSandboxId = getActiveSandboxId();
                      if (activeSandboxId) {
                        fetchSandboxFiles(activeSandboxId);
                      }

                      const checkpointLabel = lastUserPromptRef.current
                        ? `Auto: ${lastUserPromptRef.current.slice(0, 60)}`
                        : 'Auto checkpoint';
                      void createCheckpoint(checkpointLabel);

                      // Restart Vite to ensure preview works (agent may not have started it)
                      (async () => {
                        try {
                          console.log('[chat] Restarting Vite after agent completion');
                          const sandboxId = getActiveSandboxId();
                          if (!sandboxId) return;
                          const restartResponse = await fetch('/api/restart-vite', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sandboxId })
                          });
                          if (restartResponse.ok) {
                            const restartData = await restartResponse.json();
                            console.log('[chat] Vite restart result:', restartData.success);
                          }
                        } catch (e) {
                          console.error('[chat] Error restarting Vite:', e);
                        }
                      })();

                      // Switch to preview mode and refresh after Vite starts
                      setTimeout(() => {
                        console.log('[chat] Switching to preview after agent complete');
                        setActiveTab('preview');
                        setPendingRefresh({ reason: 'agent-complete' });
                      }, 3000); // Wait longer for Vite to start
                    } else {
                      // Agent finished with errors
                      addChatMessage('Agent encountered some issues. Check the output above for details.', 'system');

                      // Still refresh file list to show what was created
                      fetchSandboxFiles(sandboxData?.sandboxId);
                    }
                  } else {
                    // Builtin agent complete (has generatedCode)
                    generatedCode = data.generatedCode;
                    explanation = data.explanation;

                    // Save the last generated code
                    setConversationContext(prev => ({
                      ...prev,
                      lastGeneratedCode: generatedCode
                    }));

                    // Clear thinking state when generation completes
                    setGenerationProgress(prev => ({
                      ...prev,
                      isThinking: false,
                      thinkingText: undefined,
                      thinkingDuration: undefined
                    }));

                    // Store packages to install from tool calls
                    if (data.packagesToInstall && data.packagesToInstall.length > 0) {
                      console.log('[generate-code] Packages to install from tools:', data.packagesToInstall);
                      // Store packages globally for later installation
                      (window as any).pendingPackages = data.packagesToInstall;
                    }

                    // Parse all files from the completed code if not already done
                    const fileRegex = /<file path="([^"]+)">([^]*?)<\/file>/g;
                    const parsedFiles: Array<{path: string; content: string; type: string; completed: boolean}> = [];
                    let fileMatch;

                    while ((fileMatch = fileRegex.exec(data.generatedCode)) !== null) {
                      const filePath = fileMatch[1];
                      const fileContent = fileMatch[2];
                      const fileExt = filePath.split('.').pop() || '';
                      const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                      fileExt === 'css' ? 'css' :
                                      fileExt === 'json' ? 'json' :
                                      fileExt === 'html' ? 'html' : 'text';

                      parsedFiles.push({
                        path: filePath,
                        content: fileContent.trim(),
                        type: fileType,
                        completed: true
                      });
                    }

                    setGenerationProgress(prev => ({
                      ...prev,
                      status: `Generated ${parsedFiles.length > 0 ? parsedFiles.length : prev.files.length} file${(parsedFiles.length > 0 ? parsedFiles.length : prev.files.length) !== 1 ? 's' : ''}!`,
                      isGenerating: false,
                      isStreaming: false,
                      isEdit: prev.isEdit,
                      // Keep the files that were already parsed during streaming
                      files: prev.files.length > 0 ? prev.files : parsedFiles
                    }));
                  }
                } else if (data.type === 'error') {
                  throw new Error(data.error);
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
          }
          if (done) {
            console.log('[chat] Stream complete. Total chunks:', chunkCount);
            break;
          }
        }
      }
      if (agentAbortRef.current) {
        agentAbortRef.current = null;
      }
      if (useExternalAgent && !externalAgentCompleted) {
        console.warn('[chat] External agent stream ended without completion; attempting recovery');
        addChatMessage('Agent stream ended early. Checking sandbox state...', 'system');
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          isThinking: false,
          thinkingText: undefined,
          thinkingDuration: undefined,
          status: 'Finalizing preview...'
        }));
        const fallbackSandboxId = effectiveSandboxId || getActiveSandboxId();
        if (fallbackSandboxId) {
          await fetchSandboxFiles(fallbackSandboxId);
          try {
            await fetch('/api/restart-vite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sandboxId: fallbackSandboxId })
            });
          } catch {}
          setActiveTab('preview');
          setPendingRefresh({ reason: 'stream-ended' });
        }
      }
      // Fallback if the model didn't send an explicit 'complete' event
      if (!generatedCode && aggregatedStream && aggregatedStream.includes('<file path="')) {
        console.warn('[chat] No explicit complete event; using aggregated streamed code as fallback');
        generatedCode = aggregatedStream;
      }
      
      if (generatedCode) {
        // Parse files from generated code for metadata
        const fileRegex = /<file path="([^"]+)">([^]*?)<\/file>/g;
        const generatedFiles = [];
        let match;
        while ((match = fileRegex.exec(generatedCode)) !== null) {
          generatedFiles.push(match[1]);
        }
        
        // Show appropriate message based on edit mode
        if (isEdit && generatedFiles.length > 0) {
          // For edits, show which file(s) were edited
          const editedFileNames = generatedFiles.map(f => f.split('/').pop()).join(', ');
          addChatMessage(
            explanation || `Updated ${editedFileNames}`,
            'ai',
            {
              appliedFiles: [generatedFiles[0]] // Only show the first edited file
            }
          );
        } else {
          // For new generation, show all files
          addChatMessage(explanation || 'Code generated!', 'ai', {
            appliedFiles: generatedFiles
          });
        }
        
        setPromptInput(generatedCode);
        // Don't show the Generated Code panel by default
        // setLeftPanelVisible(true);
        
        // Wait for sandbox creation if it's still in progress
        let createdSandbox: { sandboxId: string; url: string; sandboxUrl?: string } | null = null;
        if (sandboxPromise) {
          addChatMessage('Waiting for sandbox to be ready...', 'system');
          try {
            console.log('[chat] Awaiting sandboxPromise before apply');
            createdSandbox = await sandboxPromise;
            console.log('[chat] SandboxPromise resolved. createdSandbox=', createdSandbox, 'state.sandboxData=', sandboxData);
            // Refresh sandboxData from URL param after router push (if any)
            const sParam = new URLSearchParams(window.location.search).get('sandbox');
            if (!sandboxData && sParam) {
              console.log('[chat] Restoring sandbox from URL param:', sParam);
              setSandboxData(prev => prev || { sandboxId: sParam, url: iframeRef.current?.src?.split('?')[0] || '' } as any);
            }
            // Remove the waiting message
            setChatMessages(prev => prev.filter(msg => msg.content !== 'Waiting for sandbox to be ready...'));
          } catch (e) {
            console.error('[chat] Sandbox creation failed:', e);
            addChatMessage('Sandbox creation failed. Cannot apply code.', 'system');
            return;
          }
        }
        
        // Apply using the freshest sandbox info available
        const sandboxParam = getActiveSandboxId();
        const effectiveSandbox = (sandboxData && sandboxData.sandboxId)
          ? sandboxData
          : (createdSandbox && createdSandbox.sandboxId)
            ? createdSandbox
            : (sandboxParam ? { sandboxId: sandboxParam, url: buildFallbackSandboxUrl(sandboxParam) } as any : null);
        
        if (effectiveSandbox && generatedCode) {
          console.log('[chat] Applying generated code. sandboxId=', effectiveSandbox.sandboxId, 'url=', effectiveSandbox.url);
          await applyGeneratedCode(generatedCode, isEdit, effectiveSandbox as any);
          console.log('[chat] applyGeneratedCode finished');
        } else {
          console.warn('[chat] Missing effective sandbox or generatedCode at apply step', { hasSandbox: !!effectiveSandbox, hasCode: !!generatedCode });
        }
      }
      
        // Show completion status; switch to preview happens after apply step confirms
      setGenerationProgress(prev => ({
        ...prev,
        isGenerating: false,
        isStreaming: false,
        status: 'Generation complete!',
        isEdit: prev.isEdit,
        // Clear thinking state on completion
        isThinking: false,
        thinkingText: undefined,
        thinkingDuration: undefined
      }));
      clearSystemMessage('progress');
        // do not immediately switch to preview; wait for apply flow to refresh
    } catch (error: any) {
      if (agentAbortRef.current) {
        agentAbortRef.current = null;
      }
      setChatMessages(prev => prev.filter(msg => msg.content !== 'Thinking...'));
      if (error?.name === 'AbortError') {
        addChatMessage('Agent run cancelled.', 'system');
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          status: 'Agent cancelled',
          isThinking: false,
          thinkingText: undefined,
          thinkingDuration: undefined
        }));
        clearSystemMessage('progress');
        return;
      }
      const errorMessage = error?.message || '';
      const isNetworkError = error?.name === 'TypeError' ||
        /QUIC|NetworkError|Failed to fetch/i.test(errorMessage);
      if (useExternalAgent && isNetworkError) {
        addChatMessage('Agent stream interrupted. Recovering from sandbox...', 'system');
        clearSystemMessage('progress');
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          status: 'Finalizing preview...',
          isThinking: false,
          thinkingText: undefined,
          thinkingDuration: undefined
        }));
        const fallbackSandboxId = effectiveSandboxId || getActiveSandboxId();
        if (fallbackSandboxId) {
          await fetchSandboxFiles(fallbackSandboxId);
          try {
            await fetch('/api/restart-vite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sandboxId: fallbackSandboxId })
            });
          } catch {}
          setActiveTab('preview');
          setPendingRefresh({ reason: 'stream-error' });
        }
        return;
      }
      addChatMessage(`Error: ${error.message}`, 'system');
      clearSystemMessage('progress');
      // Reset generation progress and switch back to preview on error
      setGenerationProgress({
        isGenerating: false,
        status: '',
        components: [],
        currentComponent: 0,
        streamedCode: '',
        isStreaming: false,
        isThinking: false,
        thinkingText: undefined,
        thinkingDuration: undefined,
        files: [],
        currentFile: undefined,
        lastProcessedPosition: 0
      });
      setActiveTab('preview');
    }
  };
  sendChatMessageRef.current = sendChatMessage;

  const cancelAgentRun = async () => {
    const sandboxId = getActiveSandboxId();
    if (!sandboxId) {
      addChatMessage('No active sandbox to cancel.', 'system');
      return;
    }
    try {
      addChatMessage('Cancelling agent run...', 'system');
      await fetch('/api/agent-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxId })
      });
    } catch (error) {
      console.error('[agent-cancel] Failed:', error);
    }
    try {
      agentAbortRef.current?.abort();
    } catch {}
    clearSystemMessage('progress');
    setGenerationProgress(prev => ({
      ...prev,
      isGenerating: false,
      isStreaming: false,
      status: 'Agent cancelled',
      isThinking: false,
      thinkingText: undefined,
      thinkingDuration: undefined
    }));
  };

  const shareSandbox = async () => {
    const sandboxId = getActiveSandboxId();
    if (!sandboxId) {
      toast.error('No sandbox to share yet.');
      return;
    }
    const shareUrl = `${window.location.origin}/share/${sandboxId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Share link copied to clipboard.');
    } catch {
      toast.success('Share link ready');
      addChatMessage(`Share link: ${shareUrl}`, 'system');
    }
  };

  const buildReturnToUrl = () => `${window.location.pathname}${window.location.search}`;

  const refreshGithubRepos = useCallback(async () => {
    if (!githubConnected) return;
    setGithubReposLoading(true);
    setGithubReposError(null);
    try {
      const response = await fetch('/api/github/repos');
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
      }
      const data = await response.json();
      const repos: GithubRepo[] = Array.isArray(data?.repos) ? data.repos : [];
      setGithubRepos(repos);

      if (githubRepoSelection === GITHUB_REPO_MANUAL) {
        return;
      }

      const preferredSelection = githubRepoSelection || githubRepoInput;
      const matchedRepo = preferredSelection
        ? repos.find(repo => repo.fullName === preferredSelection)
        : null;
      const fallbackRepo = matchedRepo || repos[0];

      if (fallbackRepo?.fullName) {
        setGithubRepoSelection(fallbackRepo.fullName);
        setGithubRepoInput(fallbackRepo.fullName);
        if (!githubBranchInput.trim() && fallbackRepo.defaultBranch) {
          setGithubBranchInput(fallbackRepo.defaultBranch);
        }
      } else if (repos.length === 0) {
        setGithubRepoSelection(GITHUB_REPO_MANUAL);
      }
    } catch (error: any) {
      setGithubReposError(error?.message || 'Failed to load repositories');
    } finally {
      setGithubReposLoading(false);
    }
  }, [githubBranchInput, githubConnected, githubRepoInput, githubRepoSelection]);

  useEffect(() => {
    if (githubConnected) return;
    setGithubRepos([]);
    setGithubReposError(null);
    setGithubRepoSelection('');
  }, [githubConnected]);

  useEffect(() => {
    if (!githubDialogOpen || !githubConnected || !showHomeScreen) return;
    void refreshGithubRepos();
  }, [githubConnected, githubDialogOpen, refreshGithubRepos, showHomeScreen]);

  const connectGithub = () => {
    if (!isAuthenticated && !isAuthLoading) {
      login(buildReturnToUrl());
      return;
    }
    window.location.href = `/api/github/oauth/start?returnTo=${encodeURIComponent(buildReturnToUrl())}`;
  };

  const disconnectGithub = async () => {
    try {
      await fetch('/api/github/oauth/disconnect', { method: 'POST' });
      await refreshAuth();
      toast.success('GitHub disconnected.');
    } catch (error) {
      console.error('[github] Disconnect failed:', error);
      toast.error('Failed to disconnect GitHub.');
    }
  };

  const connectNetlify = () => {
    if (!isAuthenticated && !isAuthLoading) {
      login(buildReturnToUrl());
      return;
    }
    window.location.href = `/api/netlify/oauth/start?returnTo=${encodeURIComponent(buildReturnToUrl())}`;
  };

  const disconnectNetlify = async () => {
    try {
      await fetch('/api/netlify/oauth/disconnect', { method: 'POST' });
      await refreshAuth();
      toast.success('Netlify disconnected.');
    } catch (error) {
      console.error('[netlify] Disconnect failed:', error);
      toast.error('Failed to disconnect Netlify.');
    }
  };

  const importGithubRepo = async () => {
    const repoInput = (githubRepoSelection === GITHUB_REPO_MANUAL
      ? githubRepoInput
      : (githubRepoSelection || githubRepoInput)).trim();
    if (!repoInput) {
      toast.error('Enter a GitHub repo URL.');
      return;
    }
    if (!githubConnected) {
      toast.error('Connect GitHub before importing.');
      connectGithub();
      return;
    }
    setGithubLoading(true);
    try {
      setShowHomeScreen(false);
      let sandbox = sandboxData;
      if (!sandbox) {
        sandbox = await createSandbox(true, false);
      }
      const sandboxId = sandbox?.sandboxId || getActiveSandboxId();
      if (!sandboxId) throw new Error('Sandbox not available');

      const response = await fetch('/api/github/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sandboxId,
          repoUrl: repoInput,
          branch: githubBranchInput.trim() || undefined
        })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || response.statusText);
      }
      const data = await response.json();
      if (data?.repo) {
        setProjectState(prev => prev ? { ...prev, github: data.repo, devServer: data.devServer || prev.devServer } : prev);
        setConversationContext(prev => ({
          ...prev,
          currentProject: `${data.repo.owner || ''}${data.repo.owner ? '/' : ''}${data.repo.repo}`
        }));
      }
      await fetchSandboxFiles(sandboxId);
      await fetch('/api/restart-vite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxId })
      });
      setActiveTab('preview');
      setGithubDialogOpen(false);
      toast.success('GitHub repo imported.');
      addChatMessage('GitHub repo imported. Preview refreshed.', 'system');
    } catch (error: any) {
      toast.error('GitHub import failed.');
      addChatMessage(`GitHub import failed: ${error.message}`, 'error');
    } finally {
      setGithubLoading(false);
    }
  };

  const exportGithubRepo = async () => {
    const repoName = githubExportName.trim();
    if (!repoName) {
      toast.error('Enter a repository name.');
      return;
    }
    if (!githubConnected) {
      toast.error('Connect GitHub before exporting.');
      connectGithub();
      return;
    }
    const sandboxId = getActiveSandboxId();
    if (!sandboxId) {
      toast.error('No sandbox available to export.');
      return;
    }
    setGithubLoading(true);
    try {
      const response = await fetch('/api/github/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sandboxId,
          repoName,
          owner: githubOwnerInput.trim() || undefined,
          private: githubPrivate
        })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || response.statusText);
      }
      const data = await response.json();
      if (data?.repo) {
        setProjectState(prev => prev ? { ...prev, github: data.repo } : prev);
        setConversationContext(prev => ({
          ...prev,
          currentProject: `${data.repo.owner || ''}${data.repo.owner ? '/' : ''}${data.repo.repo}`
        }));
        toast.success('GitHub repo created.');
        addChatMessage(`GitHub repo created: ${data.repo.url}`, 'system');
      }
      setGithubDialogOpen(false);
    } catch (error: any) {
      toast.error('GitHub export failed.');
      addChatMessage(`GitHub export failed: ${error.message}`, 'error');
    } finally {
      setGithubLoading(false);
    }
  };

  const deployToNetlify = async () => {
    const sandboxId = getActiveSandboxId();
    if (!sandboxId) {
      toast.error('No sandbox available to deploy.');
      return;
    }
    if (!netlifyConnected) {
      toast.error('Connect Netlify before deploying.');
      connectNetlify();
      return;
    }
    setNetlifyDeploying(true);
    try {
      const response = await fetch('/api/netlify/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sandboxId,
          siteName: netlifySiteName.trim() || undefined
        })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || response.statusText);
      }
      const data = await response.json();
      if (data?.url) {
        setProjectState(prev => prev ? {
          ...prev,
          netlify: {
            siteId: data.siteId,
            siteName: netlifySiteName || prev.netlify?.siteName,
            url: data.url,
            lastDeployAt: new Date().toISOString()
          }
        } : prev);
        toast.success('Netlify deployment ready.');
        addChatMessage(`Netlify deploy ready: ${data.url}`, 'system');
      }
      setNetlifyDialogOpen(false);
    } catch (error: any) {
      toast.error('Netlify deploy failed.');
      addChatMessage(`Netlify deploy failed: ${error.message}`, 'error');
    } finally {
      setNetlifyDeploying(false);
    }
  };


  const downloadZip = async () => {
    if (!sandboxData) {
      addChatMessage('No active sandbox to download. Create a sandbox first!', 'system');
      return;
    }
    
    setLoading(true);
    log('Creating zip file...');
    addChatMessage('Creating ZIP file of your Vite app...', 'system');
    
    try {
      const response = await fetch('/api/create-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      
      if (data.success) {
        log('Zip file created!');
        addChatMessage('ZIP file created! Download starting...', 'system');
        
        const link = document.createElement('a');
        link.href = data.dataUrl;
        link.download = data.fileName || 'sandbox-project.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        addChatMessage(
          'Your Vite app has been downloaded! To run it locally:\n' +
          '1. Unzip the file\n' +
          '2. Run: npm install\n' +
          '3. Run: npm run dev\n' +
          '4. Open http://localhost:5173',
          'system'
        );
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      log(`Failed to create zip: ${error.message}`, 'error');
      addChatMessage(`Failed to create ZIP: ${error.message}`, 'system');
    } finally {
      setLoading(false);
    }
  };

  const reapplyLastGeneration = async () => {
    if (!conversationContext.lastGeneratedCode) {
      addChatMessage('No previous generation to re-apply', 'system');
      return;
    }
    
    if (!sandboxData) {
      addChatMessage('Please create a sandbox first', 'system');
      return;
    }
    
    addChatMessage('Re-applying last generation...', 'system');
    const isEdit = conversationContext.appliedCode.length > 0;
    await applyGeneratedCode(conversationContext.lastGeneratedCode, isEdit);
  };

  // Auto-scroll code display to bottom when streaming
  useEffect(() => {
    if (codeDisplayRef.current && generationProgress.isStreaming) {
      codeDisplayRef.current.scrollTop = codeDisplayRef.current.scrollHeight;
    }
  }, [generationProgress.streamedCode, generationProgress.isStreaming]);

  const toggleFolder = (folderPath: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderPath)) {
      newExpanded.delete(folderPath);
    } else {
      newExpanded.add(folderPath);
    }
    setExpandedFolders(newExpanded);
  };

  const fetchFileContent = useCallback(async (filePath: string) => {
    const sandboxId = getActiveSandboxId();
    if (!sandboxId) return;
    try {
      const response = await fetch(
        `/api/sandbox-file?sandboxId=${encodeURIComponent(sandboxId)}&path=${encodeURIComponent(filePath)}`
      );
      if (!response.ok) return;
      const data = await response.json();
      if (!data?.content && data?.content !== '') return;
      setGenerationProgress(prev => ({
        ...prev,
        files: prev.files.map(file => file.path === filePath
          ? { ...file, content: data.content, completed: true, truncated: false, lastUpdated: Date.now() }
          : file
        )
      }));
    } catch (error) {
      console.error('[file] Failed to read file:', error);
    }
  }, [getActiveSandboxId]);

  const handleFileClick = async (filePath: string) => {
    userSelectedFileRef.current = true;
    setSelectedFile(filePath);
    const existing = generationProgress.files.find(file => file.path === filePath);
    if (!existing || existing.truncated || !existing.content) {
      await fetchFileContent(filePath);
    }
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();

    if (ext === 'jsx' || ext === 'js') {
      return <SiJavascript size={FILE_ICON_SIZE} className="shrink-0 text-yellow-500" aria-hidden="true" />;
    } else if (ext === 'tsx' || ext === 'ts') {
      return <SiReact size={FILE_ICON_SIZE} className="shrink-0 text-emerald-500" aria-hidden="true" />;
    } else if (ext === 'css') {
      return <SiCss3 size={FILE_ICON_SIZE} className="shrink-0 text-orange-500" aria-hidden="true" />;
    } else if (ext === 'json') {
      return <SiJson size={FILE_ICON_SIZE} className="shrink-0 text-muted-foreground" aria-hidden="true" />;
    } else {
      return <FiFile size={FILE_ICON_SIZE} className="shrink-0 text-muted-foreground" aria-hidden="true" />;
    }
  };

  const _clearChatHistory = () => {
    setChatMessages([{
      content: 'Chat history cleared. How can I help you?',
      type: 'system',
      timestamp: new Date()
    }]);
  };


  const _cloneWebsite = async () => {
    let url = urlInput.trim();
    if (!url) {
      _setUrlStatus(prev => [...prev, 'Please enter a URL']);
      return;
    }
    
    if (!url.match(/^https?:\/\//i)) {
      url = 'https://' + url;
    }
    
    _setUrlStatus([`Using: ${url}`, 'Starting to scrape...']);
    
    _setUrlOverlayVisible(false);
    
    // Remove protocol for cleaner display
    const cleanUrl = url.replace(/^https?:\/\//i, '');
    addChatMessage(`Starting to clone ${cleanUrl}...`, 'system');
    
    // Capture screenshot immediately and switch to preview tab
    captureUrlScreenshot(url);
    
    try {
      addChatMessage('Scraping website content...', 'system');
      const scrapeResponse = await fetch('/api/scrape-url-enhanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      if (!scrapeResponse.ok) {
        throw new Error(`Scraping failed: ${scrapeResponse.status}`);
      }
      
      const scrapeData = await scrapeResponse.json();
      
      if (!scrapeData.success) {
        throw new Error(scrapeData.error || 'Failed to scrape website');
      }
      
      addChatMessage(`Scraped ${scrapeData.content.length} characters from ${url}`, 'system');
      
      // Clear preparing design state and switch to generation tab
      setIsPreparingDesign(false);
      setActiveTab('generation');
      
      setConversationContext(prev => ({
        ...prev,
        scrapedWebsites: [...prev.scrapedWebsites, {
          url,
          content: scrapeData,
          timestamp: new Date()
        }],
        currentProject: `Clone of ${url}`
      }));
      
      // Start sandbox creation in parallel with code generation
      let sandboxPromise: Promise<void> | null = null;
      if (!sandboxData) {
        addChatMessage('Creating sandbox while generating your React app...', 'system');
        sandboxPromise = createSandbox(true);
      }
      
      addChatMessage('Analyzing and generating React recreation...', 'system');
      
      const recreatePrompt = `I scraped this website and want you to recreate it as a modern React application.

URL: ${url}

SCRAPED CONTENT:
${scrapeData.content}

${homeContextInput ? `ADDITIONAL CONTEXT/REQUIREMENTS FROM USER:
${homeContextInput}

Please incorporate these requirements into the design and implementation.` : ''}

REQUIREMENTS:
1. Create a COMPLETE React application with App.jsx as the main component
2. App.jsx MUST import and render all other components
3. Recreate the main sections and layout from the scraped content
4. ${homeContextInput ? `Apply the user's context/theme: "${homeContextInput}"` : `Use a modern dark theme with excellent contrast:
   - Background: #0a0a0a
   - Text: #ffffff
   - Links: #60a5fa
   - Accent: #3b82f6`}
5. Make it fully responsive
6. Include hover effects and smooth transitions
7. Create separate components for major sections (Header, Hero, Features, etc.)
8. Use semantic HTML5 elements

IMPORTANT CONSTRAINTS:
- DO NOT use React Router or any routing libraries
- Use regular <a> tags with href="#section" for navigation, NOT Link or NavLink components
- This is a single-page application, no routing needed
- ALWAYS create src/App.jsx that imports ALL components
- Each component should be in src/components/
- Use Tailwind CSS for ALL styling (no custom CSS files)
- Make sure the app actually renders visible content
- Create ALL components that you reference in imports

IMAGE HANDLING RULES:
- When the scraped content includes images, USE THE ORIGINAL IMAGE URLS whenever appropriate
- Keep existing images from the scraped site (logos, product images, hero images, icons, etc.)
- Use the actual image URLs provided in the scraped content, not placeholders
- Only use placeholder images or generic services when no real images are available
- For company logos and brand images, ALWAYS use the original URLs to maintain brand identity
- If scraped data contains image URLs, include them in your img tags
- Example: If you see "https://example.com/logo.png" in the scraped content, use that exact URL

Focus on the key sections and content, making it clean and modern while preserving visual assets.`;
      
      setGenerationProgress(prev => ({
        isGenerating: true,
        status: 'Initializing AI...',
        components: [],
        currentComponent: 0,
        streamedCode: '',
        isStreaming: true,
        isThinking: false,
        thinkingText: undefined,
        thinkingDuration: undefined,
        // Keep previous files until new ones are generated
        files: prev.files || [],
        currentFile: undefined,
        lastProcessedPosition: 0
      }));
      
      // Switch to generation tab when starting
      setActiveTab('generation');
      
      const aiResponse = await fetch('/api/generate-ai-code-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: recreatePrompt,
          model: aiModel,
          context: {
            sandboxId: sandboxData?.id,
            structure: structureContent,
            conversationContext: conversationContext
          }
        })
      });
      
      if (!aiResponse.ok) {
        throw new Error(`AI generation failed: ${aiResponse.status}`);
      }
      
      const reader = aiResponse.body?.getReader();
      const decoder = new TextDecoder();
      let generatedCode = '';
      let explanation = '';
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === 'status') {
                  setGenerationProgress(prev => ({ ...prev, status: data.message }));
                } else if (data.type === 'thinking') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: true,
                    thinkingText: (prev.thinkingText || '') + data.text
                  }));
                } else if (data.type === 'thinking_complete') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: false,
                    thinkingDuration: data.duration
                  }));
                } else if (data.type === 'conversation') {
                  // Add conversational text to chat only if it's not code
                  let text = data.text || '';
                  
                  // Remove package tags from the text
                  text = text.replace(/<package>[^<]*<\/package>/g, '');
                  text = text.replace(/<packages>[^<]*<\/packages>/g, '');
                  
                  // Filter out any XML tags and file content that slipped through
                  if (!text.includes('<file') && !text.includes('import React') && 
                      !text.includes('export default') && !text.includes('className=') &&
                      text.trim().length > 0) {
                    addChatMessage(text.trim(), 'ai');
                  }
                } else if (data.type === 'stream' && data.raw) {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    streamedCode: prev.streamedCode + data.text,
                    lastProcessedPosition: prev.lastProcessedPosition || 0
                  }));
                } else if (data.type === 'component') {
                  setGenerationProgress(prev => ({
                    ...prev,
                    status: `Generated ${data.name}`,
                    components: [...prev.components, { 
                      name: data.name, 
                      path: data.path, 
                      completed: true 
                    }],
                    currentComponent: prev.currentComponent + 1
                  }));
                } else if (data.type === 'complete') {
                  generatedCode = data.generatedCode;
                  explanation = data.explanation;
                  
                  // Save the last generated code
                  setConversationContext(prev => ({
                    ...prev,
                    lastGeneratedCode: generatedCode
                  }));
                }
              } catch (e) {
                console.error('Error parsing streaming data:', e);
              }
            }
          }
        }
      }
      
      setGenerationProgress(prev => ({
        ...prev,
        isGenerating: false,
        isStreaming: false,
        status: 'Generation complete!',
        isEdit: prev.isEdit
      }));
      
      if (generatedCode) {
        addChatMessage('AI recreation generated!', 'system');
        
        // Add the explanation to chat if available
        if (explanation && explanation.trim()) {
          addChatMessage(explanation, 'ai');
        }
        
        setPromptInput(generatedCode);
        // Don't show the Generated Code panel by default
        // setLeftPanelVisible(true);
        
        // Wait for sandbox creation if it's still in progress
        if (sandboxPromise) {
          addChatMessage('Waiting for sandbox to be ready...', 'system');
          try {
            await sandboxPromise;
            // Remove the waiting message
            setChatMessages(prev => prev.filter(msg => msg.content !== 'Waiting for sandbox to be ready...'));
          } catch (error: any) {
            addChatMessage('Sandbox creation failed. Cannot apply code.', 'system');
            throw error;
          }
        }
        
        // First application for cloned site should not be in edit mode
        await applyGeneratedCode(generatedCode, false);
        
        addChatMessage(
          `Successfully recreated ${url} as a modern React app${homeContextInput ? ` with your requested context: "${homeContextInput}"` : ''}! The scraped content is now in my context, so you can ask me to modify specific sections or add features based on the original site.`, 
          'ai',
          {
            scrapedUrl: url,
            scrapedContent: scrapeData,
            generatedCode: generatedCode
          }
        );
        
        setUrlInput('');
        _setUrlStatus([]);
        setHomeContextInput('');
        
        // Clear generation progress and all screenshot/design states
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          status: 'Generation complete!'
        }));
        
        // Clear screenshot and preparing design states to prevent them from showing on next run
        setUrlScreenshot(null);
        setIsPreparingDesign(false);
        setTargetUrl('');
        setScreenshotError(null);
        setLoadingStage(null); // Clear loading stage
        
        setTimeout(() => {
          console.log('[cloneWebsite] Switching to preview after generation complete');
          // Switch back to preview tab but keep files
          setActiveTab('preview');
        }, 1000); // Show completion briefly then switch
      } else {
        throw new Error('Failed to generate recreation');
      }
      
    } catch (error: any) {
      addChatMessage(`Failed to clone website: ${error.message}`, 'system');
      _setUrlStatus([]);
      setIsPreparingDesign(false);
      // Clear all states on error
      setUrlScreenshot(null);
      setTargetUrl('');
      setScreenshotError(null);
      setLoadingStage(null);
      setGenerationProgress(prev => ({
        ...prev,
        isGenerating: false,
        isStreaming: false,
        status: '',
        // Keep files to display in sidebar
        files: prev.files
      }));
      setActiveTab('preview');
    }
  };

  const captureUrlScreenshot = async (url: string) => {
    if (!isMountedRef.current) return;
    setIsCapturingScreenshot(true);
    setScreenshotError(null);
    try {
      const response = await fetch('/api/scrape-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      const data = await response.json();
      if (data.success && data.screenshot) {
        if (!isMountedRef.current) return;
        setUrlScreenshot(data.screenshot);
        // Set preparing design state
        setIsPreparingDesign(true);
        // Store the clean URL for display
        const cleanUrl = url.replace(/^https?:\/\//i, '');
        setTargetUrl(cleanUrl);
        // Switch to preview tab to show the screenshot
        if (activeTab !== 'preview') {
          setActiveTab('preview');
        }
      } else {
        if (isMountedRef.current) setScreenshotError(data.error || 'Failed to capture screenshot');
      }
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      if (isMountedRef.current) setScreenshotError('Network error while capturing screenshot');
    } finally {
      if (isMountedRef.current) setIsCapturingScreenshot(false);
    }
  };
  captureUrlScreenshotRef.current = captureUrlScreenshot;

  const handleHomeScreenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!homeUrlInput.trim()) return;
    
    setHomeScreenFading(true);
    
    // Clear messages and immediately show the cloning message
    setChatMessages([]);
    let displayUrl = homeUrlInput.trim();
    if (!displayUrl.match(/^https?:\/\//i)) {
      displayUrl = 'https://' + displayUrl;
    }
    // Remove protocol for cleaner display
    const cleanUrl = displayUrl.replace(/^https?:\/\//i, '');
    addChatMessage(`Starting to clone ${cleanUrl}...`, 'system');
    
    // Start creating sandbox and capturing screenshot immediately in parallel
    const sandboxPromise = !sandboxData ? createSandbox(true) : Promise.resolve();
    
    // Only capture screenshot if we don't already have a sandbox (first generation)
    // After sandbox is set up, skip the screenshot phase for faster generation
    if (!sandboxData) {
      captureUrlScreenshot(displayUrl);
    }
    
    // Set loading stage immediately before hiding home screen
    setLoadingStage('gathering');
    // Also ensure we're on preview tab to show the loading overlay
    setActiveTab('preview');
    
    setTimeout(async () => {
      setShowHomeScreen(false);
      setHomeScreenFading(false);
      
      // Wait for sandbox to be ready (if it's still creating)
      await sandboxPromise;
      
      // Now start the clone process which will stream the generation
      setUrlInput(homeUrlInput);
      _setUrlOverlayVisible(false); // Make sure overlay is closed
      _setUrlStatus(['Scraping website content...']);
      
      try {
        // Scrape the website
        let url = homeUrlInput.trim();
        if (!url.match(/^https?:\/\//i)) {
          url = 'https://' + url;
        }
        
        // Screenshot is already being captured in parallel above
        
        const scrapeResponse = await fetch('/api/scrape-url-enhanced', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        
        if (!scrapeResponse.ok) {
          throw new Error('Failed to scrape website');
        }
        
        const scrapeData = await scrapeResponse.json();
        
        if (!scrapeData.success) {
          throw new Error(scrapeData.error || 'Failed to scrape website');
        }
        
        _setUrlStatus(['Website scraped successfully!', 'Generating React app...']);
        
        // Clear preparing design state and switch to generation tab
        setIsPreparingDesign(false);
        setUrlScreenshot(null); // Clear screenshot when starting generation
        setTargetUrl(''); // Clear target URL
        
        // Update loading stage to planning
        setLoadingStage('planning');
        
        // Brief pause before switching to generation tab
        setTimeout(() => {
          setLoadingStage('generating');
          setActiveTab('generation');
        }, 1500);
        
        // Store scraped data in conversation context
        setConversationContext(prev => ({
          ...prev,
          scrapedWebsites: [...prev.scrapedWebsites, {
            url: url,
            content: scrapeData,
            timestamp: new Date()
          }],
          currentProject: `${url} Clone`
        }));
        
        const prompt = `I want to recreate the ${url} website as a complete React application based on the scraped content below.

${JSON.stringify(scrapeData, null, 2)}

${homeContextInput ? `ADDITIONAL CONTEXT/REQUIREMENTS FROM USER:
${homeContextInput}

Please incorporate these requirements into the design and implementation.` : ''}

IMPORTANT INSTRUCTIONS:
- Create a COMPLETE, working React application
- Implement ALL sections and features from the original site
- Use Tailwind CSS for all styling (no custom CSS files)
- Make it responsive and modern
- Ensure all text content matches the original
- Create proper component structure
- Make sure the app actually renders visible content
- Create ALL components that you reference in imports
${homeContextInput ? '- Apply the user\'s context/theme requirements throughout the application' : ''}

Focus on the key sections and content, making it clean and modern.`;
        
        setGenerationProgress(prev => ({
          isGenerating: true,
          status: 'Initializing AI...',
          components: [],
          currentComponent: 0,
          streamedCode: '',
          isStreaming: true,
          isThinking: false,
          thinkingText: undefined,
          thinkingDuration: undefined,
          // Keep previous files until new ones are generated
          files: prev.files || [],
          currentFile: undefined,
          lastProcessedPosition: 0
        }));
        
        const aiResponse = await fetch('/api/generate-ai-code-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            prompt,
            model: aiModel,
            context: {
              sandboxId: sandboxData?.sandboxId,
              structure: structureContent,
              conversationContext: conversationContext
            }
          })
        });
        
        if (!aiResponse.ok || !aiResponse.body) {
          throw new Error('Failed to generate code');
        }
        
        const reader = aiResponse.body.getReader();
        const decoder = new TextDecoder();
        let generatedCode = '';
        let explanation = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === 'status') {
                  setGenerationProgress(prev => ({ ...prev, status: data.message }));
                } else if (data.type === 'thinking') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: true,
                    thinkingText: (prev.thinkingText || '') + data.text
                  }));
                } else if (data.type === 'thinking_complete') {
                  setGenerationProgress(prev => ({ 
                    ...prev, 
                    isThinking: false,
                    thinkingDuration: data.duration
                  }));
                } else if (data.type === 'conversation') {
                  // Add conversational text to chat only if it's not code
                  let text = data.text || '';
                  
                  // Remove package tags from the text
                  text = text.replace(/<package>[^<]*<\/package>/g, '');
                  text = text.replace(/<packages>[^<]*<\/packages>/g, '');
                  
                  // Filter out any XML tags and file content that slipped through
                  if (!text.includes('<file') && !text.includes('import React') && 
                      !text.includes('export default') && !text.includes('className=') &&
                      text.trim().length > 0) {
                    addChatMessage(text.trim(), 'ai');
                  }
                } else if (data.type === 'stream' && data.raw) {
                  setGenerationProgress(prev => {
                    const newStreamedCode = prev.streamedCode + data.text;
                    
                    // Tab is already switched after scraping
                    
                    const updatedState = { 
                      ...prev, 
                      streamedCode: newStreamedCode,
                      isStreaming: true,
                      isThinking: false,
                      status: 'Generating code...'
                    };
                    
                    // Process complete files from the accumulated stream
                    const fileRegex = /<file path="([^"]+)">([^]*?)<\/file>/g;
                    let match;
                    const processedFiles = new Set(prev.files.map(f => f.path));
                    
                    while ((match = fileRegex.exec(newStreamedCode)) !== null) {
                      const filePath = match[1];
                      const fileContent = match[2];
                      
                      // Only add if we haven't processed this file yet
                      if (!processedFiles.has(filePath)) {
                        const fileExt = filePath.split('.').pop() || '';
                        const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                        fileExt === 'css' ? 'css' :
                                        fileExt === 'json' ? 'json' :
                                        fileExt === 'html' ? 'html' : 'text';
                        
                        // Check if file already exists
                        const existingFileIndex = updatedState.files.findIndex(f => f.path === filePath);
                        
                        if (existingFileIndex >= 0) {
                          // Update existing file and mark as edited
                          updatedState.files = [
                            ...updatedState.files.slice(0, existingFileIndex),
                            {
                              ...updatedState.files[existingFileIndex],
                              content: fileContent.trim(),
                              type: fileType,
                              completed: true
                            } as any,
                            ...updatedState.files.slice(existingFileIndex + 1)
                          ];
                        } else {
                          // Add new file
                          updatedState.files = [...updatedState.files, {
                            path: filePath,
                            content: fileContent.trim(),
                            type: fileType,
                            completed: true
                          } as any];
                        }
                        
                        // Only show file status if not in edit mode
                        if (!prev.isEdit) {
                          updatedState.status = `Completed ${filePath}`;
                        }
                        processedFiles.add(filePath);
                      }
                    }
                    
                    // Check for current file being generated (incomplete file at the end)
                    const lastFileMatch = newStreamedCode.match(/<file path="([^"]+)">([^]*?)$/);
                    if (lastFileMatch && !lastFileMatch[0].includes('</file>')) {
                      const filePath = lastFileMatch[1];
                      const partialContent = lastFileMatch[2];
                      
                      if (!processedFiles.has(filePath)) {
                        const fileExt = filePath.split('.').pop() || '';
                        const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                        fileExt === 'css' ? 'css' :
                                        fileExt === 'json' ? 'json' :
                                        fileExt === 'html' ? 'html' : 'text';
                        
                        updatedState.currentFile = { 
                          path: filePath, 
                          content: partialContent, 
                          type: fileType 
                        };
                        // Only show file status if not in edit mode
                        if (!prev.isEdit) {
                          updatedState.status = `Generating ${filePath}`;
                        }
                      }
                    } else {
                      updatedState.currentFile = undefined;
                    }
                    
                    return updatedState;
                  });
                } else if (data.type === 'complete') {
                  generatedCode = data.generatedCode;
                  explanation = data.explanation;
                  
                  // Save the last generated code
                  setConversationContext(prev => ({
                    ...prev,
                    lastGeneratedCode: generatedCode
                  }));
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
            }
          }
        }
        
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          status: 'Generation complete!'
        }));
        
        if (generatedCode) {
          addChatMessage('AI recreation generated!', 'system');
          
          // Add the explanation to chat if available
          if (explanation && explanation.trim()) {
            addChatMessage(explanation, 'ai');
          }
          
          setPromptInput(generatedCode);
          
          // First application for cloned site should not be in edit mode
          await applyGeneratedCode(generatedCode, false);
          
          addChatMessage(
            `Successfully recreated ${url} as a modern React app${homeContextInput ? ` with your requested context: "${homeContextInput}"` : ''}! The scraped content is now in my context, so you can ask me to modify specific sections or add features based on the original site.`, 
            'ai',
            {
              scrapedUrl: url,
              scrapedContent: scrapeData,
              generatedCode: generatedCode
            }
          );
          
          setConversationContext(prev => ({
            ...prev,
            generatedComponents: [],
            appliedCode: [...prev.appliedCode, {
              files: [],
              timestamp: new Date()
            }]
          }));
        } else {
          throw new Error('Failed to generate recreation');
        }
        
        setUrlInput('');
        _setUrlStatus([]);
        setHomeContextInput('');
        
        // Clear generation progress and all screenshot/design states
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          status: 'Generation complete!'
        }));
        
        // Clear screenshot and preparing design states to prevent them from showing on next run
        setUrlScreenshot(null);
        setIsPreparingDesign(false);
        setTargetUrl('');
        setScreenshotError(null);
        setLoadingStage(null); // Clear loading stage
        
        setTimeout(() => {
          // Switch back to preview tab but keep files
          setActiveTab('preview');
        }, 1000); // Show completion briefly then switch
      } catch (error: any) {
        addChatMessage(`Failed to clone website: ${error.message}`, 'system');
        _setUrlStatus([]);
        setIsPreparingDesign(false);
        // Also clear generation progress on error
        setGenerationProgress(prev => ({
          ...prev,
          isGenerating: false,
          isStreaming: false,
          status: '',
          // Keep files to display in sidebar
          files: prev.files
        }));
      }
    }, 500);
  };

  // Handle prompt-driven generation (no URL cloning)
  const handleHomePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Ensure selected style context (homeContextInput) is included alongside the user's text
    const baseText = homePromptInput.trim();
    const styleText = homeContextInput.trim();
    const promptText = styleText ? `${baseText}\n\n${styleText}` : baseText;
    if (!promptText) return;

    // Enforce authentication before proceeding
    if (!isAuthenticated && !isAuthLoading) {
      login(window.location.pathname, {
        type: 'generate',
        payload: { prompt: promptText }
      });
      return;
    }

    setHomeScreenFading(true);
    setTimeout(async () => {
      setShowHomeScreen(false);
      setHomeScreenFading(false);
      setActiveTab('generation');
      // Start generation immediately; if sandbox fehlt, wird sie parallel erstellt
      void sendChatMessage(promptText);
      // Eingabe zurücksetzen
      setHomePromptInput('');
    }, 200);
  };

  return (
    <>
      {/* Render global header on home screen only */}
      {showHomeScreen && <Header2 />}
      
    <div className={`relative font-sans bg-neutral-950 text-white ${showHomeScreen ? 'pt-16' : ''} h-screen flex flex-col overflow-hidden`}>
      {showHomeScreen && (
        <div className={`fixed inset-0 pt-16 z-40 transition-opacity duration-500 ${homeScreenFading ? 'opacity-0' : 'opacity-100'}`}>
          <div className="absolute inset-0 overflow-hidden bg-neutral-950">
            <div className="absolute left-0 right-0 h-3/5 bottom-[-10%]">
              <ParticleWave className="absolute inset-0 opacity-30" />
            </div>
            {/* Subtle gradient overlays */}
            <div className="absolute top-0 left-0 w-1/2 h-1/2 bg-gradient-to-br from-emerald-500/5 to-transparent" />
            <div className="absolute bottom-0 right-0 w-1/2 h-1/2 bg-gradient-to-tl from-blue-500/5 to-transparent" />
          </div>


          {/* Home screen header - hidden because main header is always visible */}

          <div className="relative z-10 h-full flex justify-center items-start pt-16 md:pt-20 px-4 overflow-y-auto">
            <div className="text-center w-full max-w-5xl mx-auto px-4 sm:px-8 pb-12">
              <div className="mb-12 space-y-6">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className="inline-flex items-center rounded-full bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 backdrop-blur-sm text-emerald-500 px-6 py-2.5 text-label-medium uppercase tracking-[0.2em] font-medium"
                >
                  Chutes AI
                </motion.div>
                <motion.h1 
                  className="text-title-h1 text-balance text-[#f5f5f5] font-medium leading-tight"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
                >
                  Chutes Webcoder
                </motion.h1>
                <motion.p
                  className="text-body-x-large text-[#a3a3a3] max-w-3xl mx-auto leading-relaxed"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: showStyleSelector ? 0.6 : 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                >
                  Build React apps with AI. Describe your idea or clone a URL.
                </motion.p>
              </div>

              <motion.form 
                onSubmit={handleHomePromptSubmit} 
                className="mt-8 w-full max-w-3xl mx-auto"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
              >
                <div className="relative bg-neutral-900 rounded-2xl border border-neutral-700 shadow-xl focus-within:ring-2 focus-within:ring-emerald-500/50 focus-within:border-emerald-500/50 transition-all">
                  <textarea
                    value={homePromptInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      setHomePromptInput(value);
                      const domainRegex = /^(https?:\/\/)?(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(\/?..*)?$/;
                      const hasValidUrl = domainRegex.test(homeUrlInput) && homeUrlInput.length > 5;
                      const hasPrompt = value.trim().length > 5;
                      setShowStyleSelector(hasValidUrl || hasPrompt);
                    }}
                    placeholder="Describe your app idea... (e.g., Build a snake game with neon effects)"
                    className="min-h-[180px] w-full resize-none rounded-2xl bg-transparent px-6 py-5 pb-20 text-lg text-white placeholder-neutral-500 focus:outline-none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        const form = e.currentTarget.closest('form') as HTMLFormElement | null;
                        form?.requestSubmit();
                      }
                    }}
                  />
                  {/* Bottom action bar */}
                  <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
                    <span className="text-sm text-neutral-500 select-none">
                      Press Enter to send
                    </span>
                    <button
                      type="submit"
                      className="flex items-center gap-2 h-12 px-6 rounded-xl bg-emerald-500 text-white font-semibold text-base hover:bg-emerald-600 active:scale-[0.98] transition-all shadow-lg shadow-emerald-500/25"
                      title="Generate"
                    >
                      <span>Generate</span>
                      <svg
                        className="h-5 w-5 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </button>
                  </div>
                </div>
              </motion.form>

              <motion.div 
                className="relative flex items-center justify-center my-12"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: 0.4 }}
              >
                <div className="h-px w-full max-w-3xl bg-neutral-800" />
                <span className="absolute inline-flex items-center justify-center bg-neutral-950 px-6 py-2 text-sm font-medium uppercase tracking-wider text-neutral-500 rounded-full border border-neutral-800">
                  or clone a website
                </span>
              </motion.div>

              <motion.form 
                onSubmit={handleHomePromptSubmit} 
                className="w-full max-w-3xl mx-auto"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.5 }}
              >
                <div className="relative flex items-center bg-neutral-900 rounded-2xl border border-neutral-700 shadow-lg">
                  <ExternalLink className="absolute left-5 w-5 h-5 text-neutral-500" />
                  <input
                    type="text"
                    value={homeUrlInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      setHomeUrlInput(value);
                      const domainRegex = /^(https?:\/\/)?(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(\/?..*)?$/;
                      const hasValidUrl = domainRegex.test(value) && value.length > 5;
                      const hasPrompt = homePromptInput.trim().length > 5;
                      setTimeout(() => {
                        setShowStyleSelector(hasValidUrl || hasPrompt);
                        if (!(hasValidUrl || hasPrompt)) setSelectedStyle(null);
                      }, 100);
                    }}
                    placeholder="https://example.com"
                    className="w-full h-14 bg-transparent pl-14 pr-28 text-base text-white placeholder-neutral-500 focus-visible:outline-none focus:ring-2 focus:ring-emerald-500/50 rounded-2xl"
                  />
                  <button
                    type="submit"
                    className="absolute right-3 flex items-center h-10 px-5 rounded-xl bg-neutral-800 text-sm font-semibold text-white hover:bg-neutral-700 active:scale-[0.98] transition-all border border-neutral-700"
                    title="Clone Website"
                  >
                    Clone
                  </button>
                </div>
              </motion.form>

              {/* Agent & Model Selector */}
              <motion.div
                className="mt-8 w-full max-w-3xl mx-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, ease: 'easeOut', delay: 0.6 }}
              >
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  {/* Agent Selector */}
                  <div className="flex items-center gap-3 px-5 h-12 bg-neutral-900 border border-neutral-700 rounded-xl shadow-lg">
                    <span className="text-sm text-neutral-400 font-medium">Agent:</span>
                    <select
                      value={selectedAgent}
                      onChange={(e) => {
                        const newAgent = e.target.value;
                        setSelectedAgent(newAgent);
                        const params = new URLSearchParams(searchParams);
                        params.set('agent', newAgent);
                        const activeId = getActiveSandboxId();
                        if (activeId) {
                          params.set('sandbox', activeId);
                          params.set('project', activeId);
                        }
                        router.push(`/?${params.toString()}`);
                      }}
                      className="appearance-none bg-transparent text-base text-white font-semibold cursor-pointer focus:outline-none pr-7"
                      style={{ 
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2310b981' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 0 center',
                        backgroundSize: '18px'
                      }}
                    >
                      {appConfig.agents.availableAgents.map(agent => {
                        const displayName = appConfig.agents.agentDisplayNames[agent] || agent;
                        return (
                          <option key={agent} value={agent} className="bg-neutral-900 text-white">
                            {displayName}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  
                  {/* Model Selector */}
                  <div className="flex items-center gap-3 px-5 h-12 bg-neutral-900 border border-neutral-700 rounded-xl shadow-lg">
                    <span className="text-sm text-neutral-400 font-medium">Model:</span>
                    <select
                      value={aiModel}
                      onChange={(e) => {
                        const newModel = e.target.value;
                        setAiModel(newModel);
                        const params = new URLSearchParams(searchParams);
                        params.set('model', newModel);
                        const activeId = getActiveSandboxId();
                        if (activeId) {
                          params.set('sandbox', activeId);
                          params.set('project', activeId);
                        }
                        router.push(`/?${params.toString()}`);
                      }}
                      className="appearance-none bg-transparent text-base text-white font-semibold cursor-pointer focus:outline-none pr-7"
                      style={{ 
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2310b981' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 0 center',
                        backgroundSize: '18px'
                      }}
                    >
                      {appConfig.ai.availableModels.map(model => {
                        const displayName = (appConfig.ai.modelDisplayNames as Record<string, string>)[model] || model;
                        const cleanName = displayName.replace(/\s*\(Chutes\)\s*$/i, '').trim();
                        return (
                          <option key={model} value={model} className="bg-neutral-900 text-white">
                            {cleanName}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              </motion.div>

              <motion.div
                className="mt-6 flex justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, ease: 'easeOut', delay: 0.7 }}
              >
                <button
                  type="button"
                  onClick={() => setGithubDialogOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-5 py-3 text-sm font-semibold text-white hover:bg-neutral-800"
                >
                  <Github className="h-4 w-4" />
                  Import from GitHub
                </button>
              </motion.div>

              {showStyleSelector && (
                <motion.div 
                  className="mt-24 w-full max-w-5xl mx-auto"
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.6 }}
                >
                  <div className="relative">
                    <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/10 via-emerald-600/5 to-emerald-500/10 rounded-3xl blur-sm" />
                    <div className="relative rounded-3xl border border-[#262626]/50 bg-[#262626] bg-opacity-40 backdrop-blur-xl px-8 py-6 shadow-[0_20px_60px_rgba(7,10,16,0.3)]">
                      <div className="text-center mb-12">
                        <h3 className="text-title-h4 text-[#f5f5f5] font-medium mb-3">Choose a style preset</h3>
                        <p className="text-body-medium text-[#a3a3a3] max-w-2xl mx-auto">
                          Select a visual style that matches your app's personality
                        </p>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        {[{ name: 'Moss Glass', description: 'Frosted glass with moss accents' },
                          { name: 'Ink Minimal', description: 'Pure dark minimal layout' },
                          { name: 'Gradient Glow', description: 'Soft gradients and lighting' },
                          { name: 'Neo Grid', description: 'Structured layout with grid lines' },
                          { name: 'Aurora', description: 'Color washed aurora gradients' },
                          { name: 'Retro', description: 'Warm highlights, retro typography' },
                          { name: 'Modern', description: 'Contemporary card surfaces' },
                          { name: 'Monochrome', description: 'Monochrome ink palette' }].map((style) => (
                            <motion.button
                              key={style.name}
                              type="button"
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const form = e.currentTarget.closest('form') as HTMLFormElement | null;
                                  form?.requestSubmit();
                                }
                              }}
                              onClick={() => {
                                if (selectedStyle === style.name) {
                                  setSelectedStyle(null);
                                  const currentAdditional = homeContextInput.replace(/^[^,]+theme\s*,?\s*/, '').trim();
                                  setHomeContextInput(currentAdditional);
                                } else {
                                  setSelectedStyle(style.name);
                                  const currentAdditional = homeContextInput.replace(/^[^,]+theme\s*,?\s*/, '').trim();
                                  setHomeContextInput(style.name.toLowerCase() + ' theme' + (currentAdditional ? ', ' + currentAdditional : ''));
                                }
                              }}
className={`group relative flex flex-col items-start gap-3 rounded-2xl border px-8 py-4 transition-all duration-300 text-left ${
          selectedStyle === style.name
            ? 'border-emerald-500/80 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 text-[#d4d4d4] shadow-[0_12px_40px_rgba(99,210,151,0.15)]'
            : 'border-[#262626]/50 bg-[#262626] bg-opacity-20 text-[#a3a3a3] hover:border-emerald-500/40 hover:bg-[#262626] hover:text-[#d4d4d4] hover:shadow-[0_8px_32px_rgba(7,10,16,0.2)]'
        }`}
                            >
                              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                              <div className="relative">
                                <span className="text-label-large text-[#f5f5f5] font-medium">{style.name}</span>
                                <span className="text-label-small text-[#737373] mt-2 block">{style.description}</span>
                              </div>
                            </motion.button>
                          ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {!showHomeScreen && (
      <>
      {/* Combined Workspace Header - Aligned with content below */}
      <div className="bg-neutral-900 h-14 border-b border-neutral-800 flex">
        {/* Left section: Logo - matches chat panel width (420px on md+) */}
        <div className="flex items-center px-4 w-full md:w-[420px] md:border-r border-neutral-800">
          <Link href="/" className="hover:opacity-90 transition-opacity" title="Back to home">
            <ChutesLogo className="w-7 h-7" />
          </Link>
        </div>
        
        {/* Right section: All controls - above the code/preview area */}
        <div className="hidden md:flex flex-1 items-center justify-between px-4">
          {/* Left: Code/Preview Toggle */}
          <div className="flex relative bg-neutral-800/80 border border-neutral-700/50 rounded-full p-1 shadow-inner">
            <div
              className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-gradient-to-r from-emerald-500/30 to-emerald-400/20 rounded-full shadow-sm border border-emerald-500/30 transition-all duration-200 ease-out ${
                activeTab === 'generation' ? 'left-1' : 'left-[calc(50%+2px)]'
              }`}
            />
            <button
              onClick={() => setActiveTab('generation')}
              className={`relative z-10 flex items-center gap-1.5 px-4 py-2 rounded-full transition-colors duration-200 text-sm font-medium ${
                activeTab === 'generation' ? 'text-emerald-400' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Code2 className="w-4 h-4" />
              <span>Code</span>
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`relative z-10 flex items-center gap-1.5 px-4 py-2 rounded-full transition-colors duration-200 text-sm font-medium ${
                activeTab === 'preview' ? 'text-emerald-400' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Eye className="w-4 h-4" />
              <span>Preview</span>
            </button>
          </div>
          
          {/* Right: Agent Selector, Model Selector, Download, Status, Avatar */}
          <div className="flex items-center gap-2">
          {/* Agent Selector */}
          <div className="hidden lg:block">
            <select
              value={selectedAgent}
              onChange={(e) => {
                const newAgent = e.target.value;
                setSelectedAgent(newAgent);
                const params = new URLSearchParams(searchParams);
                params.set('agent', newAgent);
                const activeId = getActiveSandboxId();
                if (activeId) {
                  params.set('sandbox', activeId);
                  params.set('project', activeId);
                }
                router.push(`/?${params.toString()}`);
              }}
              className="h-10 px-4 text-sm bg-neutral-800 text-white border border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 hover:border-neutral-600 transition-colors font-medium"
            >
              {appConfig.agents.availableAgents.map(agent => {
                const displayName = appConfig.agents.agentDisplayNames[agent] || agent;
                return (
                  <option key={agent} value={agent}>
                    {displayName}
                  </option>
                );
              })}
            </select>
          </div>
          
          {/* Model Selector */}
          <div className="hidden lg:block">
            <select
              value={aiModel}
              onChange={(e) => {
                const newModel = e.target.value;
                setAiModel(newModel);
                const params = new URLSearchParams(searchParams);
                params.set('model', newModel);
                const activeId = getActiveSandboxId();
                if (activeId) {
                  params.set('sandbox', activeId);
                  params.set('project', activeId);
                }
                router.push(`/?${params.toString()}`);
              }}
              className="h-10 px-4 text-sm bg-neutral-800 text-white border border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 hover:border-neutral-600 transition-colors font-medium"
            >
              {appConfig.ai.availableModels.map(model => {
                const displayName = (appConfig.ai.modelDisplayNames as Record<string, string>)[model] || model;
                const cleanName = displayName.replace(/\s*\(Chutes\)\s*$/i, '').trim();
                return (
                  <option key={model} value={model}>
                    {cleanName}
                  </option>
                );
              })}
            </select>
          </div>
          
          {/* Download Button */}
          <button
            onClick={downloadZip}
            disabled={!sandboxData}
            title="Download as ZIP"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-neutral-800 text-white border border-neutral-700 hover:bg-neutral-700 hover:border-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
          </button>

          {/* Share Button */}
          <button
            onClick={shareSandbox}
            disabled={!sandboxData}
            title="Copy share link"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-neutral-800 text-white border border-neutral-700 hover:bg-neutral-700 hover:border-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Share2 className="w-5 h-5" />
          </button>

          {/* GitHub Button */}
          <button
            onClick={() => setGithubDialogOpen(true)}
            title="GitHub import/export"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-neutral-800 text-white border border-neutral-700 hover:bg-neutral-700 hover:border-neutral-600 transition-colors"
          >
            <Github className="w-5 h-5" />
          </button>

          {/* Netlify Button */}
          <button
            onClick={() => setNetlifyDialogOpen(true)}
            title="Deploy to Netlify"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-neutral-800 text-white border border-neutral-700 hover:bg-neutral-700 hover:border-neutral-600 transition-colors"
          >
            <CloudUpload className={`w-5 h-5 ${netlifyDeploying ? 'animate-pulse' : ''}`} />
          </button>
          
          {/* Sandbox Status */}
          <div className="flex items-center gap-2 bg-neutral-800 text-white px-4 h-10 rounded-xl text-sm font-medium border border-neutral-700">
            <span className="hidden sm:inline">{status.text}</span>
            <div className={`w-2.5 h-2.5 rounded-full ${status.active ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
          </div>
          
          {/* User Avatar */}
          <UserAvatar2 />
          </div>
        </div>
      </div>

      <div className="md:hidden bg-[#171717] border-b border-[#262626] px-3 py-2">
        <div className="flex bg-[#0a0a0a] rounded-2xl p-1 w-full max-w-sm mx-auto justify-between">
          <button
            className={`${mobileTab === 'chat' ? 'bg-[#262626] text-[#f5f5f5]' : 'text-[#a3a3a3] hover:text-[#d4d4d4]'} flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-all text-sm`}
            onClick={() => { userTabbedRef.current = true; setMobileTab('chat'); }}
            title="Chat"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden min-[380px]:inline">Chat</span>
          </button>
          <button
            className={`${mobileTab === 'code' ? 'bg-[#262626] text-[#f5f5f5]' : 'text-[#a3a3a3] hover:text-[#d4d4d4]'} flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-all text-sm`}
            onClick={() => { userTabbedRef.current = true; setMobileTab('code'); }}
            title="Code"
          >
            <Code2 className="w-4 h-4" />
            <span className="hidden min-[380px]:inline">Code</span>
          </button>
          <button
            className={`${mobileTab === 'preview' ? 'bg-[#262626] text-[#f5f5f5]' : 'text-[#a3a3a3] hover:text-[#d4d4d4]'} flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-all text-sm`}
            onClick={() => { userTabbedRef.current = true; setMobileTab('preview'); }}
            title="Preview"
          >
            <Eye className="w-4 h-4" />
            <span className="hidden min-[380px]:inline">Preview</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        <div className={`${isMobilePortraitLayout ? (mobileTab === 'chat' ? 'flex' : 'hidden') : 'flex'} flex-1 md:flex-none w-full md:w-[420px] flex flex-col border-b md:border-b-0 md:border-r border-[#262626] bg-[#0a0a0a] min-h-0`}>
          {conversationContext.scrapedWebsites.length > 0 && (
            <div className="p-4 bg-card">
              <div className="flex flex-col gap-2">
                {conversationContext.scrapedWebsites.map((site, idx) => {
                  // Extract favicon and site info from the scraped data
                  const metadata = site.content?.metadata || {};
                  const sourceURL = metadata.sourceURL || site.url;
                  const favicon = metadata.favicon || `https://www.google.com/s2/favicons?domain=${new URL(sourceURL).hostname}&sz=32`;
                  const siteName = metadata.ogSiteName || metadata.title || new URL(sourceURL).hostname;
                  
                  return (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <NextImage
                        src={favicon}
                        alt={siteName}
                        width={20}
                        height={20}
                        className="w-5 h-5 rounded"
                        unoptimized
                        onError={(e) => {
                          const img = e.currentTarget as HTMLImageElement;
                          img.src = `https://www.google.com/s2/favicons?domain=${new URL(sourceURL).hostname}&sz=32`;
                        }}
                      />
                <a 
                        href={sourceURL} 
                        target="_blank" 
                        rel="noopener noreferrer"
                  className="text-foreground hover:text-muted-foreground truncate max-w-full sm:max-w-[250px]"
                        title={sourceURL}
                      >
                        {siteName}
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-3 flex flex-col gap-2 scrollbar-dark scroll-touch overscroll-contain" ref={chatMessagesRef}>
            {chatMessages.map((msg, idx) => {
              // Check if this message is from a successful generation
              const isGenerationComplete = msg.content.includes('Successfully recreated') || 
                                         msg.content.includes('AI recreation generated!') ||
                                         msg.content.includes('Code generated!');
              
              // Get the files from metadata if this is a completion message
              const _completedFiles = msg.metadata?.appliedFiles || [];
              
              return (
                <div key={idx} className="block py-1">
                  <div className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="block max-w-[85%] md:max-w-[70%]">
                      <div className={`block rounded-xl px-4 py-2.5 text-sm leading-relaxed overflow-hidden ${
                        msg.type === 'user' ? 'bg-gradient-to-r from-emerald-600/40 to-emerald-500/30 border border-emerald-600/30 text-[#f5f5f5] rounded-br-md shadow-lg' :
                        msg.type === 'ai' ? 'bg-neutral-800/70 border border-neutral-700/50 text-[#d4d4d4] rounded-bl-md shadow-lg' :
                        msg.type === 'system' ? 'bg-transparent text-[#737373] font-medium text-xs tracking-wide py-1' :
                        msg.type === 'command' ? 'bg-neutral-800/80 border border-neutral-700/50 text-[#d4d4d4] font-mono text-xs px-3 py-2' :
                        msg.type === 'error' ? 'bg-red-500/10 border border-red-500/30 text-red-300 text-sm' :
                        'bg-neutral-800/70 border border-neutral-700/50 text-[#d4d4d4] text-sm'
                      }`}>
                    {msg.type === 'command' ? (
                      <div className="flex items-start gap-2">
                        <span className={`text-xs ${
                          msg.metadata?.commandType === 'input' ? 'text-emerald-500' :
                          msg.metadata?.commandType === 'error' ? 'text-orange-500' :
                          msg.metadata?.commandType === 'success' ? 'text-emerald-600' :
                          'text-[#737373]'
                        }`}>
                          {msg.metadata?.commandType === 'input' ? '$' : '>'}
                        </span>
                        <span className="flex-1 whitespace-pre-wrap text-[#f5f5f5]">{msg.content}</span>
                      </div>
                    ) : msg.type === 'error' ? (
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-emerald-600/20 border border-emerald-600/60 rounded-full flex items-center justify-center">
                            <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold mb-1 text-[#f5f5f5]">Build Errors Detected</div>
                          <div className="whitespace-pre-wrap text-sm text-[#d4d4d4]">{msg.content}</div>
                          <div className="mt-2 text-xs text-[#737373]">Press 'F' or click the Fix button above to resolve</div>
                        </div>
                      </div>
                    ) : (
                      msg.content === 'Waiting for sandbox to be ready...' ? (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-neutral-600 border-t-transparent rounded-full animate-spin" />
                          <span>Waiting for sandbox to be ready...</span>
                        </div>
                      ) : (
                        // Render markdown for AI and system messages
                        msg.type === 'ai' || msg.type === 'system' ? (
                          <div className="whitespace-pre-wrap">{renderMarkdown(msg.content)}</div>
                        ) : (
                          msg.content
                        )
                      )
                    )}
                      </div>
                  
                      {/* Show applied files if this is an apply success message */}
                      {msg.metadata?.appliedFiles && msg.metadata.appliedFiles.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-neutral-700/30">
                          <div className="text-xs text-neutral-400 mb-1.5">
                            {msg.content.includes('Applied') ? 'Files Updated:' : 'Generated Files:'}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.metadata.appliedFiles.map((filePath, fileIdx) => {
                              const fileName = filePath.split('/').pop() || filePath;
                              const fileExt = fileName.split('.').pop() || '';
                              const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                              fileExt === 'css' ? 'css' :
                                              fileExt === 'json' ? 'json' : 'text';

                              return (
                                <span
                                  key={`applied-${fileIdx}`}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-700/50 text-neutral-300 rounded text-xs"
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                    fileType === 'css' ? 'bg-blue-500' :
                                    fileType === 'javascript' ? 'bg-yellow-500' :
                                    fileType === 'json' ? 'bg-green-500' :
                                    'bg-neutral-500'
                                  }`}
                                  />
                                  {fileName}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {isGenerationComplete && generationProgress.files.length > 0 && idx === chatMessages.length - 1 && !msg.metadata?.appliedFiles && !chatMessages.some(m => m.metadata?.appliedFiles) && (
                        <div className="mt-2 pt-2 border-t border-neutral-700/30">
                          <div className="text-xs text-neutral-400 mb-1.5">Generated Files:</div>
                          <div className="flex flex-wrap gap-1.5">
                            {generationProgress.files.map((file, fileIdx) => (
                              <span
                                key={`complete-${fileIdx}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-700/50 text-neutral-300 rounded text-xs"
                              >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                    file.type === 'css' ? 'bg-blue-500' :
                                    file.type === 'javascript' ? 'bg-yellow-500' :
                                    file.type === 'json' ? 'bg-green-500' :
                                    'bg-neutral-500'
                                  }`}
                              />
                                {file.path.split('/').pop()}
                              </span>
                            ))}
                          </div>
                          {!sandboxData && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
                              <div className="w-3 h-3 border-2 border-neutral-600 border-t-transparent rounded-full animate-spin" />
                              <span>Deploying sandbox preview…</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    </div>
                  </div>
              );
            })}
            
            {/* Code application progress */}
            {codeApplicationState.stage && (
              <CodeApplicationProgress state={codeApplicationState} />
            )}
            
            {/* File generation progress - inline display (during generation) */}
            {generationProgress.isGenerating && (
              <div className="inline-block bg-[#171717] rounded-xl p-4 border border-emerald-500/30 shadow-lg shadow-emerald-500/5 animate-pulse-subtle">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <div className="text-sm font-medium text-emerald-400">
                    {generationProgress.status || 'Agent is working...'}
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {/* Show completed files */}
                  {generationProgress.files.map((file, idx) => (
                    <div
                      key={`file-${idx}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-ink-750 text-[#d4d4d4] rounded-full text-xs animate-fade-in-up"
                      style={{ animationDelay: `${idx * 30}ms` }}
                    >
                      <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                      {file.path.split('/').pop()}
                    </div>
                  ))}
                  
                  {/* Show current file being generated */}
                  {generationProgress.currentFile && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#262626] text-[#d4d4d4] rounded-full text-xs animate-pulse"
                      style={{ animationDelay: `${generationProgress.files.length * 30}ms` }}>
                      <div className="w-3 h-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                      {generationProgress.currentFile.path.split('/').pop()}
                    </div>
                  )}
                </div>
                
                {/* Live streaming response display */}
                {generationProgress.streamedCode && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                   className="mt-4 border-t border-[#262626]/70 pt-4"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1 h-1 bg-emerald-600 rounded-full animate-pulse" />
                        <span className="text-xs font-medium text-[#737373]">AI Response Stream</span>
                      </div>
                      <div className="flex-1 h-px bg-gradient-to-r from-neutral-800 to-transparent" />
                    </div>
                   <div className="relative bg-[#171717] bg-opacity-80 border border-[#262626] rounded-2xl scrollbar-dark">
                      <SyntaxHighlighter
                        language="jsx"
                        style={vscDarkPlus}
                        className="scrollbar-dark"
                        customStyle={{
                          margin: 0,
                          padding: '0.75rem',
                          fontSize: '11px',
                          lineHeight: '1.5',
                          background: 'transparent',
                          minHeight: CHAT_STREAM_MIN_HEIGHT,
                          maxHeight: CHAT_STREAM_MAX_HEIGHT,
                          overflow: 'auto'
                        }}
                      >
                        {(() => {
                          const lastContent = generationProgress.streamedCode.slice(-1000);
                          // Show the last part of the stream, starting from a complete tag if possible
                          const startIndex = lastContent.indexOf('<');
                          return startIndex !== -1 ? lastContent.slice(startIndex) : lastContent;
                        })()}
                      </SyntaxHighlighter>
                      <span className="inline-block w-2 h-3 bg-orange-400 ml-3 mb-3 animate-pulse" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-neutral-900 via-neutral-900 to-transparent rounded-b-lg" />
                    </div>
                  </motion.div>
                )}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-neutral-800 bg-neutral-950">
            <div className="relative">
              <Textarea
                className="min-h-[100px] pr-14 pl-4 py-4 resize-y rounded-2xl border border-neutral-700 bg-neutral-900 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                placeholder="Continue the conversation..."
                value={aiChatInput}
                onChange={(e) => setAiChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                  }
                }}
                rows={3}
              />
              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                {generationProgress.isGenerating && (
                  <button
                    onClick={() => void cancelAgentRun()}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-800 text-white hover:bg-neutral-700 transition-colors border border-neutral-700"
                    title="Stop agent"
                  >
                    <Square className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => void sendChatMessage()}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/25"
                  title="Send message (Enter)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 shrink-0"
                    style={{ width: '16px', height: '16px' }}
                    aria-hidden="true"
                  >
                    <polyline points="9 10 4 15 9 20"></polyline>
                    <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className={`${isMobilePortraitLayout ? (mobileTab !== 'chat' ? 'flex' : 'hidden') : 'flex'} flex-1 flex-col overflow-hidden min-h-0 bg-[#171717]`}>
          <div className="flex-1 relative overflow-hidden min-h-0">
            {renderMainContent()}
          </div>
        </div>
      </div>
      </>
      )}

      <Dialog open={githubDialogOpen} onOpenChange={setGithubDialogOpen}>
        <AppDialogContent className="sm:max-w-[520px]" bodyClassName="space-y-6">
          <DialogHeader>
            <DialogTitle>GitHub integration</DialogTitle>
            <DialogDescription>
              Connect your account to import repositories or export your current sandbox.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-xs uppercase tracking-widest text-neutral-500">Step 1 · Connect GitHub</div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
              {githubConnected ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-neutral-100">GitHub connected</div>
                    <div className="text-xs text-neutral-500">You're ready to continue.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void disconnectGithub()}
                    className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-neutral-100">Connect GitHub</div>
                    <div className="text-xs text-neutral-500">Authorize access to your repositories.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => connectGithub()}
                    className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                  >
                    {isAuthenticated ? 'Connect' : 'Sign in to connect'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {githubConnected ? (
            showHomeScreen ? (
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-widest text-neutral-500">Step 2 · Import repository</div>
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span>Select a repo</span>
                  <button
                    type="button"
                    onClick={() => void refreshGithubRepos()}
                    disabled={githubReposLoading}
                    className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                  >
                    {githubReposLoading ? 'Refreshing…' : 'Refresh list'}
                  </button>
                </div>
                {githubReposError && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {githubReposError}
                  </div>
                )}
                {githubRepos.length > 0 ? (
                  <select
                    value={githubRepoSelection || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setGithubRepoSelection(value);
                      if (value === GITHUB_REPO_MANUAL) {
                        setGithubRepoInput('');
                        return;
                      }
                      setGithubRepoInput(value);
                      const repo = githubRepos.find((item) => item.fullName === value);
                      if (repo?.defaultBranch && !githubBranchInput.trim()) {
                        setGithubBranchInput(repo.defaultBranch);
                      }
                    }}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <option value="" disabled>
                      Select a repository
                    </option>
                    {githubRepos.map((repo) => (
                      <option key={repo.id} value={repo.fullName} className="bg-neutral-900">
                        {repo.fullName}{repo.private ? ' (private)' : ''}
                      </option>
                    ))}
                    <option value={GITHUB_REPO_MANUAL} className="bg-neutral-900">
                      Enter manually
                    </option>
                  </select>
                ) : (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">
                    No repositories found. Enter a repo manually below.
                  </div>
                )}
                {(githubRepoSelection === GITHUB_REPO_MANUAL || githubRepos.length === 0) && (
                  <input
                    value={githubRepoInput}
                    onChange={(e) => setGithubRepoInput(e.target.value)}
                    placeholder="owner/repo or https://github.com/owner/repo"
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                )}
                <input
                  value={githubBranchInput}
                  onChange={(e) => setGithubBranchInput(e.target.value)}
                  placeholder="branch (optional)"
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <button
                  type="button"
                  onClick={() => void importGithubRepo()}
                  disabled={githubLoading || !((githubRepoSelection === GITHUB_REPO_MANUAL ? githubRepoInput : githubRepoSelection).trim())}
                  className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {githubLoading ? 'Importing…' : 'Import repo'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-widest text-neutral-500">Step 2 · Export repository</div>
                <input
                  value={githubExportName}
                  onChange={(e) => setGithubExportName(e.target.value)}
                  placeholder="new repo name"
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <input
                  value={githubOwnerInput}
                  onChange={(e) => setGithubOwnerInput(e.target.value)}
                  placeholder="org (optional)"
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <label className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={githubPrivate}
                    onChange={(e) => setGithubPrivate(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
                  />
                  Create as private repo
                </label>
                <button
                  type="button"
                  onClick={() => void exportGithubRepo()}
                  disabled={githubLoading || !githubExportName.trim()}
                  className="w-full rounded-xl bg-neutral-800 py-3 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
                >
                  {githubLoading ? 'Exporting…' : 'Create repo & push'}
                </button>
              </div>
            )
          ) : (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-xs text-neutral-400">
              Connect GitHub to continue.
            </div>
          )}

          <DialogFooter>
            <DialogClose className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">
              Close
            </DialogClose>
          </DialogFooter>
        </AppDialogContent>
      </Dialog>

      <Dialog open={netlifyDialogOpen} onOpenChange={setNetlifyDialogOpen}>
        <AppDialogContent className="sm:max-w-[480px]" bodyClassName="space-y-6">
          <DialogHeader>
            <DialogTitle>Deploy to Netlify</DialogTitle>
            <DialogDescription>
              Build the sandbox and publish the static bundle to Netlify.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
            {netlifyConnected ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-neutral-100">Netlify connected</div>
                  <div className="text-xs text-neutral-500">You're ready to deploy.</div>
                </div>
                <button
                  type="button"
                  onClick={() => void disconnectNetlify()}
                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-neutral-100">Connect Netlify</div>
                  <div className="text-xs text-neutral-500">Authorize access to deploy your site.</div>
                </div>
                <button
                  type="button"
                  onClick={() => connectNetlify()}
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                >
                  {isAuthenticated ? 'Connect' : 'Sign in to connect'}
                </button>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <input
              value={netlifySiteName}
              onChange={(e) => setNetlifySiteName(e.target.value)}
              placeholder="site name (optional)"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <button
              type="button"
              onClick={() => void deployToNetlify()}
              disabled={netlifyDeploying || !netlifyConnected}
              className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {netlifyDeploying ? 'Deploying…' : 'Deploy now'}
            </button>
          </div>
          <DialogFooter>
            <DialogClose className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">
              Close
            </DialogClose>
          </DialogFooter>
        </AppDialogContent>
      </Dialog>
    </div>
    </>
  );
}

export default function AISandboxPage() {
  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-gradient-to-br from-[#050505] via-[#0b0b10] to-[#111216]" />}>
      <AISandboxPageContent />
    </Suspense>
  );
}
