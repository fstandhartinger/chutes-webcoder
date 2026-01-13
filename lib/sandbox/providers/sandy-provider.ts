import { Agent } from 'undici';
import { SandboxProvider, SandboxInfo, CommandResult } from '../types';
import { appConfig } from '@/config/app.config';

interface SandyExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const sandyDispatcherCache = new Map<number, Agent>();

function getSandyDispatcher(timeoutMs: number): Agent {
  const cached = sandyDispatcherCache.get(timeoutMs);
  if (cached) {
    return cached;
  }

  const agent = new Agent({
    connectTimeout: timeoutMs,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  sandyDispatcherCache.set(timeoutMs, agent);
  return agent;
}

export class SandyProvider extends SandboxProvider {
  private existingFiles: Set<string> = new Set();

  private getBaseUrl(): string {
    const baseUrl = this.config.sandy?.baseUrl || process.env.SANDY_BASE_URL;
    if (!baseUrl) {
      throw new Error('SANDY_BASE_URL is not configured');
    }
    return baseUrl.replace(/\/+$/, '');
  }

  private getApiKey(): string | undefined {
    return this.config.sandy?.apiKey || process.env.SANDY_API_KEY;
  }

  private resolveWorkdir(): string {
    return (
      this.config.sandy?.workdir ||
      process.env.SANDY_WORKDIR ||
      appConfig.sandy.workingDirectory
    );
  }

  private resolveTimeoutMs(): number {
    return this.config.sandy?.timeoutMs || appConfig.sandy.timeoutMs;
  }

  private resolveCreateTimeoutMs(): number {
    const configured = this.config.sandy?.createTimeoutMs;
    if (typeof configured === 'number') {
      return configured;
    }
    const fallback = appConfig.sandy.createTimeoutMs;
    return Math.max(fallback, appConfig.api.requestTimeout);
  }

  private resolveRequestTimeoutMs(): number {
    return Math.max(appConfig.api.requestTimeout, this.resolveTimeoutMs());
  }

  private resolveHostSuffix(): string {
    const raw = (this.config.sandy?.hostSuffix ||
      process.env.SANDY_HOST_SUFFIX ||
      process.env.NEXT_PUBLIC_SANDBOX_HOST_SUFFIX ||
      '').trim();
    if (!raw) {
      return '.sandy.localhost';
    }
    return raw.startsWith('.') ? raw : `.${raw}`;
  }

  private resolveAllowedHosts(): true {
    // Allow all hosts for sandbox environments
    // This is safe for sandboxed containers and avoids issues with
    // various host names like host.docker.internal, etc.
    return true;
  }

  private async request<T>(
    path: string,
    options: (Omit<RequestInit, 'body'> & { body?: any }) = {},
    timeoutMs: number = appConfig.api.requestTimeout
  ): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const url = new URL(path, baseUrl).toString();
    const headers = new Headers(options.headers || {});
    const apiKey = this.getApiKey();
    if (apiKey) {
      headers.set('Authorization', `Bearer ${apiKey}`);
    }

    let body = options.body;
    if (body && typeof body !== 'string' && !(body instanceof FormData)) {
      body = JSON.stringify(body);
      headers.set('Content-Type', 'application/json');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const dispatcher = getSandyDispatcher(timeoutMs);
      const requestInit: RequestInit & { dispatcher?: Agent } = {
        ...options,
        headers,
        body,
        signal: controller.signal,
        dispatcher
      };
      const response = await fetch(url, requestInit);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Sandy API error ${response.status}: ${text || response.statusText}`);
      }

      const text = await response.text();
      if (!text.trim()) {
        return {} as T;
      }
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        throw new Error('Sandy API returned non-JSON response');
      }
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      const suffix = controller.signal.aborted ? ' (aborted)' : '';
      const method = options.method || 'GET';
      throw new Error(
        `Sandy request failed ${method} ${url} timeoutMs=${timeoutMs} elapsedMs=${elapsedMs}${suffix}: ${message}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireSandboxId(): string {
    if (!this.sandboxInfo?.sandboxId) {
      throw new Error('No active sandbox');
    }
    return this.sandboxInfo.sandboxId;
  }

  async reconnect(sandboxId: string): Promise<boolean> {
    try {
      const data = await this.request<{
        sandboxId: string;
        url: string;
        createdAt?: string;
      }>(`/api/sandboxes/${sandboxId}`, { method: 'GET' });

      if (!data?.sandboxId) {
        return false;
      }

      this.sandboxInfo = {
        sandboxId: data.sandboxId,
        url: data.url,
        provider: 'sandy',
        createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        workdir: this.resolveWorkdir()
      };
      return true;
    } catch (error) {
      console.error(`[SandyProvider] Failed to reconnect to sandbox ${sandboxId}:`, error);
      return false;
    }
  }

  async createSandbox(): Promise<SandboxInfo> {
    if (this.sandboxInfo) {
      await this.terminate();
    }

    this.existingFiles.clear();

    const data = await this.request<{
      sandboxId: string;
      url: string;
      createdAt?: string;
    }>('/api/sandboxes', {
      method: 'POST',
      body: {
        priority: 1,      // HIGH priority for user-facing webcoder
        preemptable: false // Don't preempt user sessions
      }
    }, this.resolveCreateTimeoutMs());

    this.sandboxInfo = {
      sandboxId: data.sandboxId,
      url: data.url,
      provider: 'sandy',
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
      workdir: this.resolveWorkdir()
    };

    return this.sandboxInfo;
  }

  async runCommand(command: string): Promise<CommandResult> {
    const sandboxId = this.requireSandboxId();
    const requestTimeout = Math.max(appConfig.api.requestTimeout, this.resolveTimeoutMs());
    const data = await this.request<SandyExecResponse>(
      `/api/sandboxes/${sandboxId}/exec`,
      {
        method: 'POST',
        body: {
          command,
          cwd: this.resolveWorkdir(),
          timeoutMs: this.resolveTimeoutMs()
        }
      },
      requestTimeout
    );

    const exitCode = typeof data.exitCode === 'number' ? data.exitCode : 0;

    return {
      stdout: data.stdout ?? '',
      stderr: data.stderr ?? '',
      exitCode,
      success: exitCode === 0
    };
  }

  async writeFile(path: string, content: string): Promise<void> {
    const sandboxId = this.requireSandboxId();
    await this.request(`/api/sandboxes/${sandboxId}/files/write`, {
      method: 'POST',
      body: {
        path,
        content
      }
    }, this.resolveRequestTimeoutMs());
    this.existingFiles.add(path);
  }

  async readFile(path: string): Promise<string> {
    const sandboxId = this.requireSandboxId();
    const query = new URLSearchParams({ path }).toString();
    const data = await this.request<{ content: string }>(
      `/api/sandboxes/${sandboxId}/files/read?${query}`,
      { method: 'GET' },
      this.resolveRequestTimeoutMs()
    );
    return data.content ?? '';
  }

  async listFiles(directory: string = this.resolveWorkdir()): Promise<string[]> {
    const sandboxId = this.requireSandboxId();
    const query = new URLSearchParams({ path: directory }).toString();
    const data = await this.request<{ files: string[] }>(
      `/api/sandboxes/${sandboxId}/files/list?${query}`,
      { method: 'GET' },
      this.resolveRequestTimeoutMs()
    );
    return data.files ?? [];
  }

  async installPackages(packages: string[]): Promise<CommandResult> {
    const flags = appConfig.packages.useLegacyPeerDeps ? '--legacy-peer-deps ' : '';
    const installCmd = `npm install ${flags}${packages.join(' ')}`;
    const result = await this.request<SandyExecResponse>(
      `/api/sandboxes/${this.requireSandboxId()}/exec`,
      {
        method: 'POST',
        body: {
          command: installCmd,
          cwd: this.resolveWorkdir(),
          timeoutMs: appConfig.packages.installTimeout
        }
      },
      appConfig.packages.installTimeout + 5_000
    );

    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 0;

    if (appConfig.packages.autoRestartVite && exitCode === 0) {
      await this.restartViteServer();
    }

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode,
      success: exitCode === 0
    };
  }

  async setupViteApp(): Promise<void> {
    const packageJson = {
      name: 'sandbox-app',
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite --host',
        build: 'vite build',
        preview: 'vite preview'
      },
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0'
      },
      devDependencies: {
        '@vitejs/plugin-react': '^4.0.0',
        vite: '^4.3.9',
        tailwindcss: '^3.3.0',
        postcss: '^8.4.31',
        autoprefixer: '^10.4.16'
      }
    };

    const sandboxId = this.sandboxInfo?.sandboxId || '';
    const hostSuffix = this.resolveHostSuffix();
    const sandboxHost = sandboxId ? `${sandboxId}${hostSuffix}` : '';
    const baseProtocol = this.getBaseUrl().startsWith('https') ? 'https' : 'http';
    const hmrProtocol = baseProtocol === 'https' ? 'wss' : 'ws';
    const hmrClientPort = baseProtocol === 'https' ? 443 : 80;
    const hmrConfig = sandboxHost
      ? `hmr: {
    host: '${sandboxHost}',
    protocol: '${hmrProtocol}',
    clientPort: ${hmrClientPort}
  },
  origin: '${baseProtocol}://${sandboxHost}',`
      : 'hmr: false,';

    const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: ${appConfig.sandy.vitePort},
    strictPort: true,
    ${hmrConfig}
    allowedHosts: true,
    watch: {
      usePolling: true,
      interval: 1000
    }
  }
})`;

    const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}`;

    const postcssConfig = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`;

    const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sandbox App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;

    const mainJsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`;

    const appJsx = `function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
      <div className="text-center max-w-2xl">
        <p className="text-lg text-gray-400">
          Sandy Sandbox Ready<br/>
          Start building your React app with Vite and Tailwind CSS!
        </p>
      </div>
    </div>
  )
}

export default App`;

    const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background-color: rgb(17 24 39);
}`;

    const templateDir = '/opt/sandy/template';
    const templateCheck = await this.runCommand(
      `[ -f ${templateDir}/package.json ] && [ -d ${templateDir}/node_modules ]`
    );
    const hasTemplate = templateCheck.success;

    if (hasTemplate) {
      await this.runCommand(`cp -R ${templateDir}/. ${this.resolveWorkdir()}`);
    } else {
      await this.writeFile('package.json', JSON.stringify(packageJson, null, 2));
      await this.writeFile('tailwind.config.js', tailwindConfig);
      await this.writeFile('postcss.config.js', postcssConfig);
      await this.writeFile('index.html', indexHtml);
      await this.writeFile('src/main.jsx', mainJsx);
      await this.writeFile('src/App.jsx', appJsx);
      await this.writeFile('src/index.css', indexCss);

      const installResult = await this.request<SandyExecResponse>(
        `/api/sandboxes/${this.requireSandboxId()}/exec`,
        {
          method: 'POST',
          body: {
            command: 'npm install',
            cwd: this.resolveWorkdir(),
            timeoutMs: appConfig.packages.installTimeout
          }
        },
        appConfig.packages.installTimeout + 5_000
      );
      const installExitCode = typeof installResult.exitCode === 'number' ? installResult.exitCode : 0;
      if (installExitCode !== 0) {
        throw new Error(`npm install failed: ${installResult.stderr || installResult.stdout}`);
      }
    }

    await this.writeFile('vite.config.js', viteConfig);

    await this.runCommand('pkill -f vite || true');
    await this.runCommand('CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1000 nohup npm run dev > /tmp/vite.log 2>&1 &');

    await new Promise(resolve => setTimeout(resolve, appConfig.sandy.viteStartupDelay));

    this.existingFiles.add('src/App.jsx');
    this.existingFiles.add('src/main.jsx');
    this.existingFiles.add('src/index.css');
    this.existingFiles.add('index.html');
    this.existingFiles.add('package.json');
    this.existingFiles.add('vite.config.js');
    this.existingFiles.add('tailwind.config.js');
    this.existingFiles.add('postcss.config.js');
  }

  async restartViteServer(): Promise<void> {
    await this.runCommand('pkill -f vite || true');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await this.runCommand('CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1000 nohup npm run dev > /tmp/vite.log 2>&1 &');
    await new Promise(resolve => setTimeout(resolve, appConfig.sandy.viteStartupDelay));
  }

  getSandboxUrl(): string | null {
    return this.sandboxInfo?.url || null;
  }

  getSandboxInfo(): SandboxInfo | null {
    return this.sandboxInfo;
  }

  async terminate(): Promise<void> {
    if (!this.sandboxInfo) {
      return;
    }
    const sandboxId = this.sandboxInfo.sandboxId;
    try {
      await this.request(`/api/sandboxes/${sandboxId}/terminate`, { method: 'POST' });
    } catch (error) {
      console.error('[SandyProvider] Failed to terminate sandbox:', error);
    } finally {
      this.sandboxInfo = null;
    }
  }

  isAlive(): boolean {
    return !!this.sandboxInfo;
  }
}
