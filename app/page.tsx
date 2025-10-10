'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { appConfig } from '@/config/app.config';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
import { MessageSquare, Code2, Eye, ExternalLink, Clipboard } from 'lucide-react';
import CodeApplicationProgress, { type CodeApplicationState } from '@/components/CodeApplicationProgress';
import Link from 'next/link';
import dynamic from 'next/dynamic';
// Lazy-load the wave to avoid impacting TTI
const ParticleWave = dynamic(() => import('@/components/ParticleWave'), { ssr: false });

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
  };
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
  const creatingSandboxRef = useRef<Promise<any> | null>(null);
  const [aiModel, setAiModel] = useState(() => {
    const modelParam = searchParams.get('model');
    return appConfig.ai.availableModels.includes(modelParam || '') ? modelParam! : appConfig.ai.defaultModel;
  });
  const [_urlOverlayVisible, _setUrlOverlayVisible] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [_urlStatus, _setUrlStatus] = useState<string[]>([]);
  const [showHomeScreen, setShowHomeScreen] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['app', 'src', 'src/components']));
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
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
  
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const codeDisplayRef = useRef<HTMLDivElement>(null);
  const applyingRecoveryRef = useRef<boolean>(false);
  const sandboxRecreationCountRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      try {
        if (streamAbortRef.current) {
          streamAbortRef.current.abort();
        }
      } catch {}
    };
  }, []);
  
  const [codeApplicationState, setCodeApplicationState] = useState<CodeApplicationState>({
    stage: null
  });

  // Helpers for robust preview readiness
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const pingSandbox = async (baseUrl?: string) => {
    if (!baseUrl) return false;
    // Use an image ping to bypass CORS; success or error both indicate reachability
    try {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = `${baseUrl.replace(/\/$/, '')}/favicon.ico?t=${Date.now()}`;
      });
      return true;
    } catch {
      return false;
    }
  };
  const fetchSandboxActive = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/sandbox-status', { method: 'GET' });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.active && data?.healthy) {
        if (data.sandboxData && (!sandboxData || sandboxData.sandboxId !== data.sandboxData.sandboxId)) {
          setSandboxData(data.sandboxData);
        }
        return true;
      }
    } catch {}
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
    files: Array<{ path: string; content: string; type: string; completed: boolean }>;
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

  // Clear old conversation data on component mount and create/restore sandbox
  useEffect(() => {
    const initializePage = async () => {
      // Clear old conversation
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
      
      // Check if sandbox ID is in URL
      const sandboxIdParam = searchParams.get('sandbox');
      
      if (sandboxIdParam) {
        // Try to restore existing sandbox
        console.log('[home] Attempting to restore sandbox:', sandboxIdParam);
        if (isMountedRef.current) setLoading(true);
        try {
          // For now, just create a new sandbox - you could enhance this to actually restore
          // the specific sandbox if your backend supports it
          await createSandbox(true, true);
        } catch (error) {
          console.error('[ai-sandbox] Failed to restore sandbox:', error);
          // Create new sandbox on error
          await createSandbox(true, true);
        }
      } else {
        // Automatically create new sandbox
        console.log('[home] No sandbox in URL, creating new sandbox automatically...');
        await createSandbox(true, true);
      }
    };
    
    initializePage();
  }, []); // Run only on mount
  
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
      if (isMountedRef.current) captureUrlScreenshot(screenshotUrl);
    }
  }, [showHomeScreen, homeUrlInput]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    // Only check sandbox status on mount and when user navigates to the page
    checkSandboxStatus();
    
    // Optional: Check status when window regains focus
    const handleFocus = () => {
      checkSandboxStatus();
    };
    
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (!pendingRefresh) return;
      const url = sandboxData?.url;
      if (!url) {
        console.warn('[refresh] No sandbox URL yet; waiting...');
        setTimeout(() => { if (isMountedRef.current) setPendingRefresh({ reason: pendingRefresh.reason }); }, 500);
        return;
      }
      if (!iframeRef.current) {
        console.warn('[refresh] No iframe yet; waiting for render...');
        // Switch to preview tab to ensure iframe is rendered in the right pane
        if (isMountedRef.current) setActiveTab('preview');
        // Re-arm the refresh shortly after switching tabs
        setTimeout(() => { if (isMountedRef.current) setPendingRefresh({ reason: pendingRefresh.reason }); }, 300);
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
        const parent = iframeRef.current.parentElement;
        if (parent) {
          const newIframe = document.createElement('iframe');
          newIframe.className = iframeRef.current.className;
          newIframe.title = iframeRef.current.title;
          newIframe.allow = iframeRef.current.allow;
          const sandboxValue = iframeRef.current.getAttribute('sandbox');
          if (sandboxValue) newIframe.setAttribute('sandbox', sandboxValue);
          iframeRef.current.remove();
          newIframe.src = `${url}?t=${Date.now()}&deferredRecreate=1`;
          parent.appendChild(newIframe);
          (iframeRef as any).current = newIframe;
          await wait(1500);
        }
        // Step 4: final health
        const finalActive = await fetchSandboxActive();
        const finalReachable = await pingSandbox(url);
        console.log('[refresh] Final health active=', finalActive, 'reachable=', finalReachable);
        if (!(finalActive && finalReachable) && sandboxRecreationCountRef.current < 3) {
          sandboxRecreationCountRef.current += 1;
          console.warn('[refresh] Recreating sandbox. attempt=', sandboxRecreationCountRef.current);
          await createSandbox(true, true);
          if (isMountedRef.current && sandboxData?.url && iframeRef.current) {
            iframeRef.current.src = `${sandboxData.url}?t=${Date.now()}&deferredNewSandbox=1`;
          }
        }
      } finally {
        applyingRecoveryRef.current = false;
        if (isMountedRef.current) setPendingRefresh(null);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRefresh, sandboxData?.url]);

  // Only auto-switch to Preview after iframe is fully loaded and user hasn't changed tabs
  useEffect(() => {
    if (!isMobilePortraitLayout) return;
    if (iframeLoaded && !userTabbedRef.current) {
      setActiveTab('preview');
      setMobileTab('preview');
    }
  }, [iframeLoaded, isMobilePortraitLayout]);


  const updateStatus = (text: string, active: boolean) => {
    setStatus({ text, active });
  };

  const log = (message: string, type: 'info' | 'error' | 'command' = 'info') => {
    _setResponseArea(prev => [...prev, `[${type}] ${message}`]);
  };

  const addChatMessage = (content: string, type: ChatMessage['type'], metadata?: ChatMessage['metadata']) => {
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
  };
  
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

  const checkSandboxStatus = async () => {
    try {
      const response = await fetch('/api/sandbox-status');
      const data = await response.json();
      
      if (data.active && data.healthy && data.sandboxData) {
        setSandboxData(data.sandboxData);
        updateStatus('Sandbox active', true);
      } else if (data.active && !data.healthy) {
        // Sandbox exists but not responding
        updateStatus('Sandbox not responding', false);
        // Optionally try to create a new one
      } else {
        setSandboxData(null);
        updateStatus('No sandbox', false);
      }
    } catch (error) {
      console.error('Failed to check sandbox status:', error);
      setSandboxData(null);
      updateStatus('Error', false);
    }
  };

  const createSandbox = async (fromHomeScreen = false, suppressUrlPush = false) => {
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
          body: JSON.stringify({})
        });
        const data = await response.json();
        console.log('[createSandbox] Response data:', data);
        if (data.success) {
          console.log('[createSandbox] SUCCESS sandboxId=', data.sandboxId, 'url=', data.url);
          if (isMountedRef.current) setSandboxData(data);
          if (isMountedRef.current) updateStatus('Sandbox active', true);
          log('Sandbox created successfully!');
          log(`Sandbox ID: ${data.sandboxId}`);
          log(`URL: ${data.url}`);
          // Update URL with sandbox ID
          if (!suppressUrlPush) {
            const newParams = new URLSearchParams(searchParams.toString());
            newParams.set('sandbox', data.sandboxId);
            newParams.set('model', aiModel);
            console.log('[createSandbox] Updating URL with sandbox param');
            router.push(`/?${newParams.toString()}`, { scroll: false });
          } else {
            console.log('[createSandbox] Suppressing URL push during active generation');
          }
          // Fade out loading background after sandbox loads
          setTimeout(() => {
            if (isMountedRef.current) _setShowLoadingBackground(false);
          }, 3000);
          if (data.structure) {
            if (isMountedRef.current) displayStructure(data.structure);
          }
          // Fetch sandbox files after creation
          setTimeout(() => { if (isMountedRef.current) fetchSandboxFiles(); }, 1000);
          // Ensure Vite server is up
          setTimeout(async () => {
            try {
              console.log('[createSandbox] Ensuring Vite server is running...');
              const restartResponse = await fetch('/api/restart-vite', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
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
              iframeRef.current.src = data.url;
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

  const displayStructure = (structure: any) => {
    if (typeof structure === 'object') {
      setStructureContent(JSON.stringify(structure, null, 2));
    } else {
      setStructureContent(structure || 'No structure available');
    }
  };

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
              await fetch('/api/restart-vite', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
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
          await fetchSandboxFiles();
          
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

  const fetchSandboxFiles = async () => {
    if (!sandboxData) return;
    
    try {
      const response = await fetch('/api/get-sandbox-files', {
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
        }
      }
    } catch (error) {
      console.error('[fetchSandboxFiles] Error fetching files:', error);
    }
  };
  
  const _restartViteServer = async () => {
    try {
      addChatMessage('Restarting Vite dev server...', 'system');
      
      const response = await fetch('/api/restart-vite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          addChatMessage('✓ Vite dev server restarted successfully!', 'system');
          
          // Refresh the iframe after a short delay
          setTimeout(() => {
            if (iframeRef.current && sandboxData?.url) {
              iframeRef.current.src = `${sandboxData.url}?t=${Date.now()}`;
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
    if (activeTab === 'generation' && (generationProgress.isGenerating || generationProgress.files.length > 0)) {
      return (
        /* Generation Tab Content */
        <div className="absolute inset-0 flex overflow-hidden">
          {/* File Explorer - Hide during edits */}
          {!generationProgress.isEdit && (
            <div className="hidden sm:flex w-full sm:w-[240px] md:w-[250px] sm:flex-col border-b sm:border-b-0 sm:border-r border-border bg-[hsl(240_8%_7%)] flex-shrink-0">
            <div className="p-3 bg-[hsl(240_8%_10%)] text-foreground flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BsFolderFill className="w-4 h-4" />
                <span className="text-sm font-medium">Explorer</span>
              </div>
            </div>
            
            {/* File Tree */}
            <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
              <div className="text-sm">
                {/* Root app folder */}
                <div 
                  className="flex items-center gap-1 py-1 px-2 hover:bg-[hsl(240_8%_10%)] rounded cursor-pointer text-[hsl(0_0%_90%)]"
                  onClick={() => toggleFolder('app')}
                >
                  {expandedFolders.has('app') ? (
                    <FiChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <FiChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  {expandedFolders.has('app') ? (
                    <BsFolder2Open className="w-4 h-4 text-blue-500" />
                  ) : (
                    <BsFolderFill className="w-4 h-4 text-blue-500" />
                  )}
                  <span className="font-medium text-foreground">app</span>
                </div>
                
                {expandedFolders.has('app') && (
                  <div className="ml-4">
                    {/* Group files by directory */}
                    {(() => {
                      const fileTree: { [key: string]: Array<{ name: string; edited?: boolean }> } = {};
                      
                      // Create a map of edited files
                       const editedFiles = new Set(
                         generationProgress.files
                           // edited flag may not exist on all entries
                           .filter((f: any) => !!(f as any).edited)
                           .map(f => f.path)
                       );
                      
                      // Process all files from generation progress
                      generationProgress.files.forEach(file => {
                        const parts = file.path.split('/');
                        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                        const fileName = parts[parts.length - 1];
                        
                        if (!fileTree[dir]) fileTree[dir] = [];
                         fileTree[dir].push({
                           name: fileName,
                           edited: (file as any).edited || false
                         });
                      });
                      
                      return Object.entries(fileTree).map(([dir, files]) => (
                        <div key={dir} className="mb-1">
                          {dir && (
                            <div 
                              className="flex items-center gap-1 py-1 px-2 hover:bg-[hsl(240_8%_10%)] rounded cursor-pointer text-[hsl(0_0%_90%)]"
                              onClick={() => toggleFolder(dir)}
                            >
                              {expandedFolders.has(dir) ? (
                                <FiChevronDown className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <FiChevronRight className="w-4 h-4 text-muted-foreground" />
                              )}
                              {expandedFolders.has(dir) ? (
                                <BsFolder2Open className="w-4 h-4 text-yellow-600" />
                              ) : (
                                <BsFolderFill className="w-4 h-4 text-yellow-600" />
                              )}
                              <span className="text-[hsl(0_0%_90%)]">{dir.split('/').pop()}</span>
                            </div>
                          )}
                          {(!dir || expandedFolders.has(dir)) && (
                            <div className={dir ? 'ml-6' : ''}>
                              {files.sort((a, b) => a.name.localeCompare(b.name)).map(fileInfo => {
                                const fullPath = dir ? `${dir}/${fileInfo.name}` : fileInfo.name;
                                const isSelected = selectedFile === fullPath;
                                
                                return (
                                  <div 
                                    key={fullPath} 
                                    className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer transition-all ${
                                      isSelected 
                                        ? 'bg-blue-600 text-white' 
                                        : 'text-[hsl(0_0%_90%)] hover:bg-[hsl(240_8%_10%)]'
                                    }`}
                                    onClick={() => handleFileClick(fullPath)}
                                  >
                                    {getFileIcon(fileInfo.name)}
                                    <span className={`text-xs flex items-center gap-1 ${isSelected ? 'font-medium' : ''}`}>
                                      {fileInfo.name}
                                      {fileInfo.edited && (
                                        <span className={`text-[10px] px-1 rounded ${
                                        isSelected ? 'bg-blue-500' : 'bg-primary text-primary-foreground'
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
          </div>
          )}
          
          {/* Code Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Thinking Mode Display - Only show during active generation */}
            {generationProgress.isGenerating && (generationProgress.isThinking || generationProgress.thinkingText) && (
              <div className="px-6 pb-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-purple-600 font-medium flex items-center gap-2">
                    {generationProgress.isThinking ? (
                      <>
                        <div className="w-2 h-2 bg-purple-600 rounded-full animate-pulse" />
                        AI is thinking...
                      </>
                    ) : (
                      <>
                        <span className="text-purple-600">✓</span>
                        Thought for {generationProgress.thinkingDuration || 0} seconds
                      </>
                    )}
                  </div>
                </div>
                {generationProgress.thinkingText && (
                  <div className="bg-purple-950 border border-purple-700 rounded-lg p-4 max-h-48 overflow-y-auto scrollbar-hide">
                    <pre className="text-xs font-mono text-purple-300 whitespace-pre-wrap">
                      {generationProgress.thinkingText}
                    </pre>
                  </div>
                )}
              </div>
            )}
            
            {/* Live Code Display */}
            <div className="flex-1 rounded-lg p-6 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto min-h-0 scrollbar-dark" ref={codeDisplayRef}>
                {/* Show selected file if one is selected */}
                {selectedFile ? (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="bg-[hsl(240_8%_7%)] border border-border rounded-lg overflow-hidden shadow-sm">
                      <div className="px-4 py-2 bg-[#36322F] text-white flex items-center justify-between rounded-t-lg">
                        <div className="flex items-center gap-2">
                          {getFileIcon(selectedFile)}
                          <span className="font-mono text-sm">{selectedFile}</span>
                        </div>
                        <button
                          onClick={() => setSelectedFile(null)}
                          className="hover:bg-black/20 p-1 rounded transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="bg-[hsl(240_8%_5%)] border border-border rounded-b-lg">
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
                          }}
                          showLineNumbers={true}
                        >
                          {(() => {
                            // Find the file content from generated files
                            const file = generationProgress.files.find(f => f.path === selectedFile);
                            return file?.content || '// File content will appear here';
                          })()}
                        </SyntaxHighlighter>
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
                          <div className="w-12 h-12 border-3 border-border border-t-white rounded-full animate-spin mx-auto" />
                        </div>
                        <h3 className="text-xl font-medium text-white mb-2">AI is analyzing your request</h3>
                        <p className="text-muted-foreground text-sm">{generationProgress.status || 'Preparing to generate code...'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[hsl(240_8%_7%)] border border-border rounded-lg overflow-hidden">
                      <div className="px-4 py-2 bg-[hsl(240_8%_10%)] text-foreground flex items-center justify-between rounded-t-lg">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                          <span className="font-mono text-sm">Streaming code...</span>
                        </div>
                      </div>
                      <div className="p-4 bg-[hsl(240_8%_5%)] rounded-b-lg">
                        <SyntaxHighlighter
                          language="jsx"
                          style={vscDarkPlus}
                          className="scrollbar-dark"
                          customStyle={{
                            margin: 0,
                            padding: '1rem',
                            fontSize: '0.875rem',
                            background: 'transparent',
                          }}
                          showLineNumbers={true}
                        >
                          {generationProgress.streamedCode || 'Starting code generation...'}
                        </SyntaxHighlighter>
                        <span className="inline-block w-2 h-4 bg-orange-400 ml-1 animate-pulse" />
                      </div>
                    </div>
                  )
                ) : (
                  <div className="space-y-4">
                    {/* Show current file being generated */}
                    {generationProgress.currentFile && (
                      <div className="bg-[hsl(240_8%_7%)] border-2 border-border rounded-lg overflow-hidden shadow-sm">
                        <div className="px-4 py-2 bg-[#36322F] text-white flex items-center justify-between rounded-t-lg">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span className="font-mono text-sm">{generationProgress.currentFile.path}</span>
                            <span className={`px-2 py-0.5 text-xs rounded ${
                              generationProgress.currentFile.type === 'css' ? 'bg-blue-600 text-white' :
                              generationProgress.currentFile.type === 'javascript' ? 'bg-yellow-600 text-white' :
                              generationProgress.currentFile.type === 'json' ? 'bg-green-600 text-white' :
                              'bg-[hsl(240_8%_12%)] text-[hsl(0_0%_90%)]'
                            }`}>
                              {generationProgress.currentFile.type === 'javascript' ? 'JSX' : generationProgress.currentFile.type.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      <div className="bg-[hsl(240_8%_5%)] border border-border rounded-b-lg">
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
                            }}
                            showLineNumbers={true}
                          >
                            {generationProgress.currentFile.content}
                          </SyntaxHighlighter>
                          <span className="inline-block w-2 h-3 bg-orange-400 ml-4 mb-4 animate-pulse" />
                        </div>
                      </div>
                    )}
                    
                    {/* Show completed files */}
                    {generationProgress.files.map((file, idx) => (
                      <div key={idx} className="bg-[hsl(240_8%_7%)] border border-border rounded-lg overflow-hidden">
                        <div className="px-4 py-2 bg-[#36322F] text-white flex items-center justify-between rounded-t-lg">
                          <div className="flex items-center gap-2">
                            <span className="text-green-500">✓</span>
                            <span className="font-mono text-sm">{file.path}</span>
                          </div>
                          <span className={`px-2 py-0.5 text-xs rounded ${
                            file.type === 'css' ? 'bg-blue-600 text-white' :
                            file.type === 'javascript' ? 'bg-yellow-600 text-white' :
                            file.type === 'json' ? 'bg-green-600 text-white' :
                            'bg-[hsl(240_8%_12%)] text-[hsl(0_0%_90%)]'
                          }`}>
                            {file.type === 'javascript' ? 'JSX' : file.type.toUpperCase()}
                          </span>
                        </div>
                        <div className="bg-[hsl(240_8%_5%)] border border-border  max-h-48 overflow-y-auto scrollbar-dark rounded-b-lg">
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
                            }}
                            showLineNumbers={true}
                            wrapLongLines={true}
                          >
                            {file.content}
                          </SyntaxHighlighter>
                        </div>
                      </div>
                    ))}
                    
                    {/* Show remaining raw stream if there's content after the last file */}
                    {!generationProgress.currentFile && generationProgress.streamedCode.length > 0 && generationProgress.isGenerating && (
                      <div className="bg-[hsl(240_8%_7%)] border border-border rounded-lg overflow-hidden">
                        <div className="px-4 py-2 bg-[#36322F] text-white flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-border border-t-transparent rounded-full animate-spin" />
                            <span className="font-mono text-sm">Processing...</span>
                          </div>
                        </div>
                        <div className="bg-[hsl(240_8%_5%)] border border-border rounded-b-lg">
                          <SyntaxHighlighter
                            language="jsx"
                            style={vscDarkPlus}
                            className="scrollbar-dark"
                            customStyle={{
                              margin: 0,
                              padding: '1rem',
                              fontSize: '0.75rem',
                              background: 'transparent',
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
                <div className="h-2 bg-[hsl(240_6%_14%)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-300"
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
      if (urlScreenshot && (loading || generationProgress.isGenerating || !sandboxData?.url || isPreparingDesign)) {
        return (
          <div className="absolute inset-0 w-full h-full bg-[hsl(240_8%_10%)]">
            <img 
              src={urlScreenshot} 
              alt="Website preview" 
              className="w-full h-full object-contain"
            />
            {(generationProgress.isGenerating || isPreparingDesign) && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="text-center bg-[hsl(240_8%_7%)]/80 rounded-lg p-6 backdrop-blur-sm border border-border">
                  <div className="w-12 h-12 border-3 border-border border-t-white rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-foreground text-sm font-medium">
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
          <div className="absolute inset-0 w-full h-full bg-[hsl(240_8%_10%)] flex items-center justify-center">
            <div className="text-center">
              <div className="mb-8">
                <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto"></div>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                {loadingStage === 'gathering' && 'Gathering website information...'}
                {loadingStage === 'planning' && 'Planning your design...'}
                {(loadingStage === 'generating' || generationProgress.isGenerating) && 'Generating your application...'}
              </h3>
              <p className="text-muted-foreground text-sm">
                {loadingStage === 'gathering' && 'Analyzing the website structure and content'}
                {loadingStage === 'planning' && 'Creating the optimal React component architecture'}
                {(loadingStage === 'generating' || generationProgress.isGenerating) && 'Writing clean, modern code for your app'}
              </p>
            </div>
          </div>
        );
      }
      
      // Show sandbox iframe only when not in any loading state
      if (sandboxData?.url && !loading) {
        return (
          <div className="absolute inset-0 w-full h-full">
            <iframe
              ref={iframeRef}
              src={sandboxData.url}
              className="w-full h-full border-none"
              title="Chutes Webcoder Sandbox"
              allow="clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              onLoad={() => setIframeLoaded(true)}
            />
            {/* Refresh button */}
            <button
              onClick={() => {
                if (iframeRef.current && sandboxData?.url) {
                  console.log('[Manual Refresh] Forcing iframe reload...');
                  const newSrc = `${sandboxData.url}?t=${Date.now()}&manual=true`;
                  iframeRef.current.src = newSrc;
                }
              }}
              className="absolute bottom-4 right-4 bg-card/90 hover:bg-card text-foreground p-2 rounded-lg shadow-lg transition-all duration-200 hover:scale-105 border border-border"
              title="Refresh sandbox"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        );
      }
      
      // Show loading animation when capturing screenshot
      if (isCapturingScreenshot) {
        return (
          <div className="flex items-center justify-center h-full bg-[hsl(240_8%_7%)]">
            <div className="text-center">
              <div className="w-12 h-12 border-3 border-gray-600 border-t-white rounded-full animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white">Gathering website information</h3>
            </div>
          </div>
        );
      }
      
      // Default state when no sandbox and no screenshot
      return (
        <div className="flex items-center justify-center h-full bg-[hsl(240_8%_10%)] text-muted-foreground text-lg">
          {screenshotError ? (
            <div className="text-center">
              <p className="mb-2">Failed to capture screenshot</p>
              <p className="text-sm text-gray-500">{screenshotError}</p>
            </div>
          ) : sandboxData ? (
            <div className="text-muted-foreground">
              <div className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
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

  const sendChatMessage = async (overrideMessage?: string) => {
    const message = (overrideMessage ?? aiChatInput).trim();
    if (!message) return;
    
    if (!aiEnabled) {
      addChatMessage('AI is disabled. Please enable it first.', 'system');
      return;
    }
    
    addChatMessage(message, 'user');
    if (!overrideMessage) {
      setAiChatInput('');
    }
    
    // Check for special commands
    const lowerMessage = message.toLowerCase().trim();
    if (lowerMessage === 'check packages' || lowerMessage === 'install packages' || lowerMessage === 'npm install') {
      if (!sandboxData) {
        // Start or wait for sandbox implicitly
        await createSandbox(true, true);
      }
      await checkAndInstallPackages();
      return;
    }
    
    // Start sandbox creation in parallel if needed
    let sandboxPromise: Promise<{ sandboxId: string; url: string }> | null = null;
    let sandboxCreating = false;
    
    if (!sandboxData) {
      sandboxCreating = true;
      // In-Progress Hinweis für den Benutzer
      addChatMessage('Creating sandbox...', 'system');
      // Parallel starten, nicht blockieren
      sandboxPromise = createSandbox(true, true).catch((error: any) => {
        addChatMessage(`Failed to create sandbox: ${error.message}`, 'system');
        throw error;
      }) as Promise<{ sandboxId: string; url: string }>;
    }
    
    // Determine if this is an edit
    const isEdit = conversationContext.appliedCode.length > 0;
    
    try {
      // Generation tab is already active from scraping phase
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
        sandboxId: sandboxData?.sandboxId || (sandboxCreating ? 'pending' : null),
        structure: structureContent,
        recentMessages: chatMessages.slice(-20),
        conversationContext: conversationContext,
        currentCode: promptInput,
        sandboxUrl: sandboxData?.url,
        sandboxCreating: sandboxCreating
      };
      
      // Debug what we're sending
      console.log('[chat] Sending context to AI:');
      console.log('[chat] - sandboxId:', fullContext.sandboxId);
      console.log('[chat] - isEdit:', conversationContext.appliedCode.length > 0);
      
      const response = await fetch('/api/generate-ai-code-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: message,
          model: aiModel,
          context: fullContext,
          isEdit: conversationContext.appliedCode.length > 0
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let generatedCode = '';
      let explanation = '';
      let aggregatedStream = '';
      
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
          // Wenn Sandbox gerade erstellt wird, UI-Status kombinieren
          if (sandboxCreating && data.message?.toLowerCase().includes('planning')) {
            addChatMessage('Waiting for sandbox to be ready...', 'system');
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
                } else if (data.type === 'error') {
                  throw new Error(data.error);
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
            }
          }
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
        let createdSandbox: { sandboxId: string; url: string } | null = null;
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
        const sandboxParam = searchParams.get('sandbox');
        const effectiveSandbox = (sandboxData && sandboxData.sandboxId)
          ? sandboxData
          : (createdSandbox && createdSandbox.sandboxId)
            ? createdSandbox
            : (sandboxParam ? { sandboxId: sandboxParam, url: `https://5173-${sandboxParam}.e2b.app` } as any : null);
        
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
        // do not immediately switch to preview; wait for apply flow to refresh
    } catch (error: any) {
      setChatMessages(prev => prev.filter(msg => msg.content !== 'Thinking...'));
      addChatMessage(`Error: ${error.message}`, 'system');
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
        link.download = data.fileName || 'e2b-project.zip';
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

  const handleFileClick = async (filePath: string) => {
    setSelectedFile(filePath);
    // TODO: Add file content fetching logic here
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    
    if (ext === 'jsx' || ext === 'js') {
      return <SiJavascript className="w-4 h-4 text-yellow-500" />;
    } else if (ext === 'tsx' || ext === 'ts') {
      return <SiReact className="w-4 h-4 text-blue-500" />;
    } else if (ext === 'css') {
      return <SiCss3 className="w-4 h-4 text-blue-500" />;
    } else if (ext === 'json') {
      return <SiJson className="w-4 h-4 text-muted-foreground" />;
    } else {
      return <FiFile className="w-4 h-4 text-muted-foreground" />;
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
    <div className="relative font-sans bg-background text-foreground min-h-[100svh] md:min-h-screen flex flex-col">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-[#030712] via-[#040015] to-[#0c1028] opacity-95" />
      {/* Home Screen Overlay */}
      {showHomeScreen && (
        <div className={`fixed inset-0 z-50 transition-opacity duration-500 ${homeScreenFading ? 'opacity-0' : 'opacity-100'}`}>
          {/* Background */}
          <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#030712] via-[#040015] to-[#0c1028]">
            {/* Subtle, performant particle wave covering lower portion, shifted down 10% */}
            <div className="absolute left-0 right-0 h-3/5" style={{ bottom: '-10%' }}>
              <ParticleWave className="absolute inset-0" />
            </div>
          </div>
          
          
          {/* Close button on hover */}
          <button
            onClick={() => {
              setHomeScreenFading(true);
              setTimeout(() => {
                setShowHomeScreen(false);
                setHomeScreenFading(false);
              }, 500);
            }}
            className="absolute top-8 right-8 text-muted-foreground hover:text-foreground transition-all duration-300 opacity-0 hover:opacity-100 bg-card/80 backdrop-blur-sm p-2 rounded-lg shadow-sm border border-border"
            style={{ opacity: 0 }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0'}
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-20 px-8 py-6 flex items-center justify-between animate-[fadeIn_0.8s_ease-out]">
            <Link href="/" className="w-20 h-20 text-white cursor-pointer flex items-center justify-center">
            <svg className="w-full h-full" width="62" height="41" viewBox="0 0 62 41" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M38.01 39.6943C37.1263 41.1364 35.2525 41.4057 34.0442 40.2642L28.6738 35.1904C27.4656 34.049 27.4843 32.0273 28.7133 30.9115L34.1258 25.9979C40.1431 20.5352 48.069 18.406 55.6129 20.2255L59.6853 21.2078C59.8306 21.2428 59.9654 21.3165 60.0771 21.422C60.6663 21.9787 60.3364 23.0194 59.552 23.078L59.465 23.0845C52.0153 23.6409 45.1812 27.9913 40.9759 34.8542L38.01 39.6943Z" fill="currentColor"></path><path d="M15.296 36.5912C14.1726 37.8368 12.2763 37.7221 11.2913 36.349L0.547139 21.3709C-0.432786 20.0048 -0.0547272 18.0273 1.34794 17.1822L22.7709 4.27482C29.6029 0.158495 37.7319 -0.277291 44.8086 3.0934L60.3492 10.4956C60.5897 10.6101 60.7997 10.7872 60.9599 11.0106C61.8149 12.2025 60.8991 13.9056 59.5058 13.7148L50.2478 12.4467C42.8554 11.4342 35.4143 14.2848 30.1165 20.1587L15.296 36.5912Z" fill="url(#paint0_linear_10244_130)"></path><defs><linearGradient id="paint0_linear_10244_130" x1="33.8526" y1="0.173618" x2="25.5505" y2="41.4493" gradientUnits="userSpaceOnUse"><stop stopColor="currentColor"></stop><stop offset="1" stopColor="currentColor"></stop></linearGradient></defs></svg>
            </Link>
            <div />
          </div>
          
          {/* Main content */}
          <div className="relative z-10 h-full flex justify-center items-start pt-32 md:pt-40 px-4">
            <div className="text-center w-full max-w-5xl mx-auto px-4">
              {/* Firecrawl-style Header */}
              <div className="text-center mb-10">
                <h1 className="text-5xl lg:text-6xl text-center text-white font-bold tracking-tight leading-tight mb-4 animate-[fadeIn_0.8s_ease-out]">
                  Chutes Webcoder
                </h1>
                <motion.p 
                  className="text-lg lg:text-xl max-w-2xl mx-auto text-gray-300 text-center"
                  animate={{
                    opacity: showStyleSelector ? 0.7 : 1
                  }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  Build React apps with AI. Describe your idea or clone a URL.
                </motion.p>
              </div>
              
              {/* Prompt form */}
              <form onSubmit={handleHomePromptSubmit} className="mt-8 w-full max-w-4xl mx-auto">
                <div className="w-full relative group">
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
                    placeholder="Describe your app idea (e.g., Build a fun snake game with glowing snakes that eat apples and oranges)"
                    className="min-h-[200px] w-full resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-2xl text-lg leading-[1.6] text-white placeholder-gray-400 px-7 pr-16 py-6 pb-16 border-2 border-gray-600/40 bg-[hsl(240_10%_12%)] hover:border-gray-500/50 transition-all"
                    style={{
                      boxShadow: '0 0 0 1px rgba(139,92,246,0.15), 0 10px 24px rgba(0,0,0,0.45)',
                    }}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        const form = e.currentTarget.closest('form');
                        if (form) (form as HTMLFormElement).requestSubmit();
                      }
                    }}
                  />
                  <span className="absolute bottom-4 left-5 text-xs text-gray-400 select-none pointer-events-none">
                    Press Enter to send, Shift+Enter for linebreaks
                  </span>
                  <button
                    type="submit"
                    disabled={!homePromptInput.trim()}
                    className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shadow-lg"
                    title="Send"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <polyline points="9 10 4 15 9 20"></polyline>
                      <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
                    </svg>
                  </button>
                </div>
                
              </form>

              {/* Separator */}
                <div className="relative my-10">
                <div className="border-t border-gray-600/50" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="bg-[hsl(240_10%_8%)] px-5 py-1 text-base text-gray-300 font-semibold rounded-lg">OR</span>
                </div>
              </div>

              {/* URL clone form */}
              <form onSubmit={handleHomeScreenSubmit} className="w-full max-w-4xl mx-auto">
                  <div className="w-full relative group">
                  <input
                    type="text"
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
                    className="h-16 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-2xl text-lg leading-[1.6] text-white placeholder-gray-400 px-7 pr-16 border-2 border-gray-600/40 bg-[hsl(240_10%_12%)] hover:border-gray-500/50 transition-all"
                    style={{
                      boxShadow: '0 0 0 1px rgba(139,92,246,0.15), 0 10px 24px rgba(0,0,0,0.45)',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!homeUrlInput.trim()}
                    className="absolute top-1/2 transform -translate-y-1/2 right-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shadow-lg"
                    title="Clone Website"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <polyline points="9 10 4 15 9 20"></polyline>
                      <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
                    </svg>
                  </button>
                </div>
              </form>
              
              {/* Style Selector - Slides out when valid domain is entered */}
              {showStyleSelector && (
                <>
                <div className="overflow-hidden mt-10 max-w-4xl mx-auto w-full">
                <div className={`transition-all duration-500 ease-out transform ${showStyleSelector ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
                <div className="bg-card/80 backdrop-blur-sm border border-border rounded-xl p-4 shadow-sm">
                  <p className="text-sm text-muted-foreground mb-3 font-medium">How do you want your site to look?</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { name: 'Neobrutalist', description: 'Bold colors, thick borders' },
                      { name: 'Glassmorphism', description: 'Frosted glass effects' },
                      { name: 'Minimalist', description: 'Clean and simple' },
                      { name: 'Dark Mode', description: 'Dark theme' },
                      { name: 'Gradient', description: 'Colorful gradients' },
                      { name: 'Retro', description: '80s/90s aesthetic' },
                      { name: 'Modern', description: 'Contemporary design' },
                      { name: 'Monochrome', description: 'Black and white' }
                    ].map((style) => (
                      <button
                        key={style.name}
                        type="button"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            // Submit the form
                            const form = e.currentTarget.closest('form');
                            if (form) {
                              form.requestSubmit();
                            }
                          }
                        }}
                        onClick={() => {
                          if (selectedStyle === style.name) {
                            // Deselect if clicking the same style
                            setSelectedStyle(null);
                            // Keep only additional context, remove the style theme part
                            const currentAdditional = homeContextInput.replace(/^[^,]+theme\s*,?\s*/, '').trim();
                            setHomeContextInput(currentAdditional);
                          } else {
                            // Select new style
                            setSelectedStyle(style.name);
                            // Extract any additional context (everything after the style theme)
                            const currentAdditional = homeContextInput.replace(/^[^,]+theme\s*,?\s*/, '').trim();
                            setHomeContextInput(style.name.toLowerCase() + ' theme' + (currentAdditional ? ', ' + currentAdditional : ''));
                          }
                        }}
                        className={`p-3 rounded-lg border transition-all ${
                          selectedStyle === style.name
                            ? 'border-ring bg-[hsl(240_8%_10%)] text-foreground shadow-sm'
                            : 'border-border bg-[hsl(240_8%_7%)] hover:border-ring hover:bg-[hsl(240_8%_10%)] text-[hsl(0_0%_90%)]'
                        }`}
                      >
                        <div className="text-sm font-medium">{style.name}</div>
                        <div className="text-xs text-muted-foreground mt-1">{style.description}</div>
                      </button>
                    ))}
                  </div>
                  
                  {/* Additional context input - part of the style selector */}
                  <div className="mt-4 mb-2">
                    <input
                      type="text"
                      value={(() => {
                        if (!selectedStyle) return homeContextInput;
                        // Extract additional context by removing the style theme part
                        const additional = homeContextInput.replace(new RegExp('^' + selectedStyle.toLowerCase() + ' theme\\s*,?\\s*', 'i'), '');
                        return additional;
                      })()}
                      onChange={(e) => {
                        const additionalContext = e.target.value;
                        if (selectedStyle) {
                          setHomeContextInput(selectedStyle.toLowerCase() + ' theme' + (additionalContext.trim() ? ', ' + additionalContext : ''));
                        } else {
                          setHomeContextInput(additionalContext);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const form = e.currentTarget.closest('form');
                          if (form) {
                            form.requestSubmit();
                          }
                        }
                      }}
                      placeholder="Add more details: specific features, color preferences..."
                      className="w-full px-4 py-2 text-sm bg-[hsl(240_8%_7%)] border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 transition-all duration-200"
                    />
                  </div>
                </div>
                  </div>
                </div>
                {/* Mobile quick start button when a style is selected */}
                {selectedStyle && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleHomePromptSubmit({ preventDefault: () => {} } as any);
                    }}
                    className="fixed md:hidden bottom-6 right-6 z-50 rounded-full bg-primary text-primary-foreground w-12 h-12 flex items-center justify-center shadow-lg border border-border"
                    title="Start"
                    aria-label="Start generation"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                  </button>
                )}
              </>
              )}
              
              {/* Advanced - Model Selector (collapsed by default) */}
              <details className="mt-6 animate-[fadeIn_1s_ease-out]">
                <summary className="cursor-pointer text-sm text-muted-foreground text-center">Advanced</summary>
                <div className="mt-2 text-left w-full max-w-4xl mx-auto flex flex-col items-center">
                  <label className="block text-xs text-muted-foreground mb-1">AI Model:</label>
                  <select
                    value={aiModel}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      setAiModel(newModel);
                      const params = new URLSearchParams(searchParams);
                      params.set('model', newModel);
                      if (sandboxData?.sandboxId) {
                        params.set('sandbox', sandboxData.sandboxId);
                      }
                      router.push(`/?${params.toString()}`);
                    }}
                    className="px-3 py-1.5 text-sm bg-[hsl(240_8%_7%)] text-foreground border border-border rounded-[12px] focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                    style={{
                      boxShadow: '0 0 0 1px color-mix(in oklab, white 5%, transparent)'
                    }}
                  >
                    {appConfig.ai.availableModels.map(model => (
                      <option key={model} value={model}>
                        {(appConfig.ai.modelDisplayNames as Record<string, string>)[model] || model}
                      </option>
                    ))}
                  </select>
                </div>
              </details>
            </div>
            {/* ParticleWave removed */}
          </div>
        </div>
      )}
      
      {!showHomeScreen && (
      <>
      <div className="bg-card/80 backdrop-blur px-4 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="h-8 w-auto text-[hsl(0_0%_92%)] cursor-pointer">
            <svg className="h-8 w-auto" width="62" height="41" viewBox="0 0 62 41" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M38.01 39.6943C37.1263 41.1364 35.2525 41.4057 34.0442 40.2642L28.6738 35.1904C27.4656 34.049 27.4843 32.0273 28.7133 30.9115L34.1258 25.9979C40.1431 20.5352 48.069 18.406 55.6129 20.2255L59.6853 21.2078C59.8306 21.2428 59.9654 21.3165 60.0771 21.422C60.6663 21.9787 60.3364 23.0194 59.552 23.078L59.465 23.0845C52.0153 23.6409 45.1812 27.9913 40.9759 34.8542L38.01 39.6943Z" fill="currentColor"></path><path d="M15.296 36.5912C14.1726 37.8368 12.2763 37.7221 11.2913 36.349L0.547139 21.3709C-0.432786 20.0048 -0.0547272 18.0273 1.34794 17.1822L22.7709 4.27482C29.6029 0.158495 37.7319 -0.277291 44.8086 3.0934L60.3492 10.4956C60.5897 10.6101 60.7997 10.7872 60.9599 11.0106C61.8149 12.2025 60.8991 13.9056 59.5058 13.7148L50.2478 12.4467C42.8554 11.4342 35.4143 14.2848 30.1165 20.1587L15.296 36.5912Z" fill="url(#paint0_linear_10244_130)"></path><defs><linearGradient id="paint0_linear_10244_130" x1="33.8526" y1="0.173618" x2="25.5505" y2="41.4493" gradientUnits="userSpaceOnUse"><stop stopColor="currentColor"></stop><stop offset="1" stopColor="currentColor"></stop></linearGradient></defs></svg>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {/* Advanced - Model Selector (collapsed by default) */}
              {/* Permanent model selector on main app view */}
              <div className="hidden md:block">
                <label className="sr-only">AI Model</label>
                <select
                  value={aiModel}
                  onChange={(e) => {
                    const newModel = e.target.value;
                    setAiModel(newModel);
                    const params = new URLSearchParams(searchParams);
                    params.set('model', newModel);
                    if (sandboxData?.sandboxId) {
                      params.set('sandbox', sandboxData.sandboxId);
                    }
                    router.push(`/?${params.toString()}`);
                  }}
                  className="px-3 py-1.5 text-sm bg-[hsl(240_8%_7%)] text-foreground border border-border rounded-[12px] focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                >
                  {appConfig.ai.availableModels.map(model => (
                    <option key={model} value={model}>
                      {(appConfig.ai.modelDisplayNames as Record<string, string>)[model] || model}
                    </option>
                  ))}
                </select>
              </div>
          <Button 
            variant="code"
            onClick={() => createSandbox()}
            size="sm"
            title="Create new sandbox"
            className="cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </Button>
          {false && (
            <Button 
              variant="code"
              onClick={async () => {}}
              size="sm"
              title="Deploy your app"
              className="cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          )}
          <Button 
            variant="code"
            onClick={reapplyLastGeneration}
            size="sm"
            title="Re-apply last generation"
            disabled={!conversationContext.lastGeneratedCode || !sandboxData}
            className="cursor-pointer"
          >
            <Clipboard className="w-4 h-4" />
          </Button>
          <Button 
            variant="code"
            onClick={downloadZip}
            disabled={!sandboxData}
            size="sm"
            title="Download your Vite app as ZIP"
            className="cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
          </Button>
          <div className="inline-flex items-center gap-2 bg-[#36322F] text-white px-3 py-1.5 rounded-[10px] text-sm font-medium [box-shadow:inset_0px_-2px_0px_0px_#171310,_0px_1px_6px_0px_rgba(58,_33,_8,_58%)]">
            <span id="status-text">{status.text}</span>
            <div className={`w-2 h-2 rounded-full ${status.active ? 'bg-green-500' : 'bg-[hsl(240_6%_25%)]'}`} />
          </div>
        </div>
      </div>

      {/* Mobile portrait global tabs */}
      <div className="md:hidden bg-card/80 backdrop-blur border-b border-border px-2 py-2">
        <div className="flex bg-[#36322F] rounded-lg p-1 w-full max-w-sm mx-auto justify-between">
          <button
            className={`${mobileTab === 'chat' ? 'bg-black text-white' : 'text-[hsl(0_0%_85%)] hover:text-white hover:bg-[hsl(240_8%_12%)]'} flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-md transition-all`}
            onClick={() => { userTabbedRef.current = true; setMobileTab('chat'); }}
            title="Chat"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden min-[380px]:inline">Chat</span>
          </button>
          <button
            className={`${mobileTab === 'code' ? 'bg-black text-white' : 'text-[hsl(0_0%_85%)] hover:text-white hover:bg-[hsl(240_8%_12%)]'} flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-md transition-all`}
            onClick={() => { userTabbedRef.current = true; setMobileTab('code'); }}
            title="Code"
          >
            <Code2 className="w-4 h-4" />
            <span className="hidden min-[380px]:inline">Code</span>
          </button>
          <button
            className={`${mobileTab === 'preview' ? 'bg-black text-white' : 'text-[hsl(0_0%_85%)] hover:text-white hover:bg-[hsl(240_8%_12%)]'} flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-md transition-all`}
            onClick={() => { userTabbedRef.current = true; setMobileTab('preview'); }}
            title="Preview"
          >
            <Eye className="w-4 h-4" />
            <span className="hidden min-[380px]:inline">Preview</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Center Panel - AI Chat (1/3 of remaining width) */}
        <div className={`${isMobilePortraitLayout ? (mobileTab === 'chat' ? 'flex' : 'hidden') : 'flex'} flex-1 md:flex-none w-full md:w-[400px] flex flex-col border-b md:border-b-0 md:border-r border-border bg-[rgba(9,12,25,0.9)] backdrop-blur min-h-0`}>
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
                      <img 
                        src={favicon} 
                        alt={siteName}
                        className="w-4 h-4 rounded"
                        onError={(e) => {
                          e.currentTarget.src = `https://www.google.com/s2/favicons?domain=${new URL(sourceURL).hostname}&sz=32`;
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

          <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-1 scrollbar-dark scroll-touch overscroll-contain" ref={chatMessagesRef}>
            {chatMessages.map((msg, idx) => {
              // Check if this message is from a successful generation
              const isGenerationComplete = msg.content.includes('Successfully recreated') || 
                                         msg.content.includes('AI recreation generated!') ||
                                         msg.content.includes('Code generated!');
              
              // Get the files from metadata if this is a completion message
              const _completedFiles = msg.metadata?.appliedFiles || [];
              
              return (
                <div key={idx} className="block">
                  <div className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} mb-1`}>
                    <div className="block">
                      <div className={`block rounded-[10px] px-4 py-2 ${
                        msg.type === 'user' ? 'bg-gradient-to-r from-purple-600/20 to-blue-600/20 border border-purple-500/30 text-white ml-auto max-w-[80%]' :
                        msg.type === 'ai' ? 'bg-[hsl(240_8%_15%)] border border-gray-600/30 text-gray-100 mr-auto max-w-[80%]' :
                        msg.type === 'system' ? 'bg-transparent text-gray-400 font-medium text-sm' :
                        msg.type === 'command' ? 'bg-gray-800 border border-gray-700 text-gray-100 font-mono text-sm' :
                        msg.type === 'error' ? 'bg-red-900/30 border border-red-600 text-red-100 text-sm' :
                        'bg-gray-800 border border-gray-700 text-gray-100 text-sm'
                      }`}>
                    {msg.type === 'command' ? (
                      <div className="flex items-start gap-2">
                        <span className={`text-xs ${
                          msg.metadata?.commandType === 'input' ? 'text-blue-400' :
                          msg.metadata?.commandType === 'error' ? 'text-red-400' :
                          msg.metadata?.commandType === 'success' ? 'text-green-400' :
                          'text-[hsl(240_5%_65%)]'
                        }`}>
                          {msg.metadata?.commandType === 'input' ? '$' : '>'}
                        </span>
                        <span className="flex-1 whitespace-pre-wrap text-white">{msg.content}</span>
                      </div>
                    ) : msg.type === 'error' ? (
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-red-800 rounded-full flex items-center justify-center">
                            <svg className="w-5 h-5 text-red-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold mb-1">Build Errors Detected</div>
                          <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                          <div className="mt-2 text-xs opacity-70">Press 'F' or click the Fix button above to resolve</div>
                        </div>
                      </div>
                    ) : (
                      msg.content === 'Waiting for sandbox to be ready...' ? (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Waiting for sandbox to be ready...</span>
                        </div>
                      ) : (
                        msg.content
                      )
                    )}
                      </div>
                  
                      {/* Show applied files if this is an apply success message */}
                      {msg.metadata?.appliedFiles && msg.metadata.appliedFiles.length > 0 && (
                    <div className="mt-2 inline-block bg-[hsl(240_8%_10%)] rounded-[10px] p-3 border border-border">
                      <div className="text-xs font-medium mb-1 text-foreground">
                        {msg.content.includes('Applied') ? 'Files Updated:' : 'Generated Files:'}
                      </div>
                      <div className="flex flex-wrap items-start gap-1">
                        {msg.metadata.appliedFiles.map((filePath, fileIdx) => {
                          const fileName = filePath.split('/').pop() || filePath;
                          const fileExt = fileName.split('.').pop() || '';
                          const fileType = fileExt === 'jsx' || fileExt === 'js' ? 'javascript' :
                                          fileExt === 'css' ? 'css' :
                                          fileExt === 'json' ? 'json' : 'text';
                          
                          return (
                            <div
                              key={`applied-${fileIdx}`}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-[#36322F] text-white rounded-[10px] text-xs animate-fade-in-up"
                              style={{ animationDelay: `${fileIdx * 30}ms` }}
                            >
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                                fileType === 'css' ? 'bg-blue-400' :
                                fileType === 'javascript' ? 'bg-yellow-400' :
                                fileType === 'json' ? 'bg-green-400' :
                                'bg-[hsl(240_6%_30%)]'
                              }`} />
                              {fileName}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                      {/* Show generated files for completion messages - but only if no appliedFiles already shown */}
                      {isGenerationComplete && generationProgress.files.length > 0 && idx === chatMessages.length - 1 && !msg.metadata?.appliedFiles && !chatMessages.some(m => m.metadata?.appliedFiles) && (
                    <div className="mt-2 inline-block bg-[hsl(240_8%_10%)] rounded-[10px] p-3 border border-border">
                      <div className="text-xs font-medium mb-1 text-foreground">Generated Files:</div>
                      <div className="flex flex-wrap items-start gap-1">
                        {generationProgress.files.map((file, fileIdx) => (
                          <div
                            key={`complete-${fileIdx}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-[#36322F] text-white rounded-[10px] text-xs animate-fade-in-up"
                            style={{ animationDelay: `${fileIdx * 30}ms` }}
                          >
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                              file.type === 'css' ? 'bg-blue-400' :
                              file.type === 'javascript' ? 'bg-yellow-400' :
                              file.type === 'json' ? 'bg-green-400' :
                              'bg-[hsl(240_6%_30%)]'
                            }`} />
                            {file.path.split('/').pop()}
                          </div>
                        ))}
                      </div>
                      {!sandboxData && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <div className="w-3 h-3 border-2 border-border border-t-white rounded-full animate-spin" />
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
              <div className="inline-block bg-[hsl(240_8%_10%)] rounded-lg p-3 border border-border">
                <div className="text-sm font-medium mb-2 text-foreground">
                  {generationProgress.status}
                </div>
                <div className="flex flex-wrap items-start gap-1">
                  {/* Show completed files */}
                  {generationProgress.files.map((file, idx) => (
                    <div
                      key={`file-${idx}`}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-[#36322F] text-white rounded-[10px] text-xs animate-fade-in-up"
                      style={{ animationDelay: `${idx * 30}ms` }}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                      {file.path.split('/').pop()}
                    </div>
                  ))}
                  
                  {/* Show current file being generated */}
                  {generationProgress.currentFile && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-[#36322F]/70 text-white rounded-[10px] text-xs animate-pulse"
                      style={{ animationDelay: `${generationProgress.files.length * 30}ms` }}>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
                   className="mt-3 border-t border-border pt-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-xs font-medium text-muted-foreground">AI Response Stream</span>
                      </div>
                      <div className="flex-1 h-px bg-gradient-to-r from-gray-300 to-transparent" />
                    </div>
                   <div className="bg-[hsl(240_8%_5%)] border border-border rounded max-h-32 overflow-y-auto scrollbar-dark">
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
                          maxHeight: '8rem',
                          overflow: 'hidden'
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
                    </div>
                  </motion.div>
                )}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-border bg-card">
            <div className="relative">
              <Textarea
                className="min-h-[60px] pr-12 resize-y border-2 border-black focus:outline-none"
                placeholder=""
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
              <button
                onClick={() => void sendChatMessage()}
                className="absolute right-2 bottom-2 p-2 bg-transparent text-white hover:text-zinc-300 transition-colors cursor-pointer"
                title="Send message (Enter)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <polyline points="9 10 4 15 9 20"></polyline>
                  <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Preview or Generation (2/3 of remaining width) */}
        <div className={`${isMobilePortraitLayout ? (mobileTab !== 'chat' ? 'flex' : 'hidden') : 'flex'} flex-1 flex-col overflow-hidden min-h-0 bg-[rgba(6,9,20,0.92)] backdrop-blur-sm`}>
            <div className="px-2 sm:px-4 py-2 bg-card/80 backdrop-blur border-b border-border flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="hidden md:flex bg-[#36322F] rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('generation')}
                  className={`p-2 rounded-md transition-all ${
                    activeTab === 'generation' 
                      ? 'bg-black text-white' 
                      : 'text-[hsl(0_0%_85%)] hover:text-white hover:bg-[hsl(240_8%_12%)]'
                  }`}
                  title="Code"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </button>
                <button
                  onClick={() => setActiveTab('preview')}
                  className={`p-2 rounded-md transition-all ${
                    activeTab === 'preview' 
                      ? 'bg-black text-white' 
                      : 'text-[hsl(0_0%_85%)] hover:text-white hover:bg-[hsl(240_8%_12%)]'
                  }`}
                  title="Preview"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {/* Live Code Generation Status - Moved to far right */}
              {activeTab === 'generation' && (generationProgress.isGenerating || generationProgress.files.length > 0) && (
                <div className="flex items-center gap-3">
                  {!generationProgress.isEdit && (
                    <div className="text-muted-foreground text-sm">
                      {generationProgress.files.length} files generated
                    </div>
                  )}
                  <div className={`inline-flex items-center justify-center whitespace-nowrap rounded-[10px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-[#36322F] text-white hover:bg-[#36322F] [box-shadow:inset_0px_-2px_0px_0px_#171310,_0px_1px_6px_0px_rgba(58,_33,_8,_58%)] hover:translate-y-[1px] hover:scale-[0.98] hover:[box-shadow:inset_0px_-1px_0px_0px_#171310,_0px_1px_3px_0px_rgba(58,_33,_8,_40%)] active:translate-y-[2px] active:scale-[0.97] active:[box-shadow:inset_0px_1px_1px_0px_#171310,_0px_1px_2px_0px_rgba(58,_33,_8,_30%)] disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:scale-100 h-8 px-3 py-1 text-sm gap-2`}>
                    {generationProgress.isGenerating ? (
                      <>
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                        {generationProgress.isEdit ? 'Editing code' : 'Live code generation'}
                      </>
                    ) : (
                      <>
                        <div className="w-2 h-2 bg-[hsl(240_6%_30%)] rounded-full" />
                        COMPLETE
                      </>
                    )}
                  </div>
                </div>
              )}
              {sandboxData && !generationProgress.isGenerating && (
                <>
                  <Button
                    variant="code"
                    size="sm"
                    asChild
                  >
                    <a 
                      href={sandboxData.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      title="Open in new tab"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </Button>
                </>
              )}
            </div>
          </div>
        <div className="flex-1 relative overflow-hidden min-h-0">
            {renderMainContent()}
          </div>
        </div>
      </div>
      </>
      )}




    </div>
  );
}

export default function AISandboxPage() {
  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-gradient-to-br from-[#030712] via-[#040015] to-[#0c1028]" />}>
      <AISandboxPageContent />
    </Suspense>
  );
}