import { NextRequest, NextResponse } from 'next/server';
import { parseJavaScriptFile, buildComponentTree } from '@/lib/file-parser';
import { FileManifest, FileInfo, RouteInfo } from '@/types/file-manifest';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { appConfig } from '@/config/app.config';

export async function GET(request: NextRequest) {
  try {
    // Get sandboxId from query parameter (required for session isolation)
    const sandboxId = request.nextUrl.searchParams.get('sandboxId') ||
      request.nextUrl.searchParams.get('project') ||
      request.cookies.get('sandySandboxId')?.value;

    if (!sandboxId) {
      return NextResponse.json({
        success: false,
        error: 'sandboxId query parameter is required for session isolation'
      }, { status: 400 });
    }

    // Get provider by explicit sandboxId (attempt restore if missing)
    let provider = sandboxManager.getProvider(sandboxId);
    if (!provider) {
      try {
        provider = await sandboxManager.getOrCreateProvider(sandboxId);
      } catch {
        provider = null;
      }
    }

    if (!provider?.getSandboxInfo?.()) {
      return NextResponse.json({
        success: false,
        error: `Sandbox ${sandboxId} not found`
      }, { status: 404 });
    }

    console.log('[get-sandbox-files] Fetching and analyzing file structure...');

    const sandboxInfo = provider.getSandboxInfo?.();
    const baseDir = sandboxInfo?.workdir ||
      (sandboxInfo?.provider === 'vercel'
        ? '/vercel/sandbox'
        : sandboxInfo?.provider === 'sandy'
          ? appConfig.sandy.workingDirectory
          : appConfig.e2b.workingDirectory);
    const allowedExtensions = /\.(jsx?|tsx?|css|json)$/;

    const fileListRaw = (await provider.listFiles(baseDir)) as string[];
    const fileList = fileListRaw.filter((file) => allowedExtensions.test(file));

    console.log('[get-sandbox-files] Found', fileList.length, 'files');
    
    // Read content of each file (limit to reasonable sizes)
    const filesContent: Record<string, string> = {};
    
    for (const filePath of fileList) {
      try {
        // Check file size first
        const fullPath = filePath.startsWith('/') ? filePath : `${baseDir}/${filePath}`;
        const statResult = await provider.runCommand(`stat -c %s ${fullPath}`);

        if (statResult.exitCode !== 0) {
          continue;
        }

        const fileSize = parseInt(String(statResult.stdout).trim(), 10);

        // Only read files smaller than 10KB
        if (Number.isFinite(fileSize) && fileSize < 10000) {
          const content = await provider.readFile(fullPath);
          const relativePath = filePath.replace(/^\.\//, '');
          filesContent[relativePath] = content;
        }
      } catch (parseError) {
        console.debug('Error parsing component info:', parseError);
        // Skip files that can't be read
        continue;
      }
    }
    
    // Get directory structure
    const dirs = new Set<string>(['.']);
    for (const filePath of fileList) {
      const parts = filePath.split('/').slice(0, -1);
      let current = '.';
      for (const part of parts) {
        if (!part) continue;
        current = current === '.' ? `./${part}` : `${current}/${part}`;
        dirs.add(current);
      }
    }
    const structure = Array.from(dirs).slice(0, 50).join('\n'); // Limit to 50 lines
    
    // Build enhanced file manifest
    const fileManifest: FileManifest = {
      files: {},
      routes: [],
      componentTree: {},
      entryPoint: '',
      styleFiles: [],
      timestamp: Date.now(),
    };
    
    // Process each file
    for (const [relativePath, content] of Object.entries(filesContent)) {
      const fullPath = `/${relativePath}`;
      
      // Create base file info
      const fileInfo: FileInfo = {
        content: content,
        type: 'utility',
        path: fullPath,
        relativePath,
        lastModified: Date.now(),
      };
      
      // Parse JavaScript/JSX files
      if (relativePath.match(/\.(jsx?|tsx?)$/)) {
        const parseResult = parseJavaScriptFile(content, fullPath);
        Object.assign(fileInfo, parseResult);
        
        // Identify entry point
        if (relativePath === 'src/main.jsx' || relativePath === 'src/index.jsx') {
          fileManifest.entryPoint = fullPath;
        }
        
        // Identify App.jsx
        if (relativePath === 'src/App.jsx' || relativePath === 'App.jsx') {
          fileManifest.entryPoint = fileManifest.entryPoint || fullPath;
        }
      }
      
      // Track style files
      if (relativePath.endsWith('.css')) {
        fileManifest.styleFiles.push(fullPath);
        fileInfo.type = 'style';
      }
      
      fileManifest.files[fullPath] = fileInfo;
    }
    
    // Build component tree
    fileManifest.componentTree = buildComponentTree(fileManifest.files);
    
    // Extract routes (simplified - looks for Route components or page pattern)
    fileManifest.routes = extractRoutes(fileManifest.files);
    
    // NOTE: No longer updating global.sandboxState for session isolation
    // Each sandbox maintains its own state via sandboxManager

    return NextResponse.json({
      success: true,
      files: filesContent,
      structure,
      fileCount: Object.keys(filesContent).length,
      manifest: fileManifest,
    });

  } catch (error) {
    console.error('[get-sandbox-files] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

function extractRoutes(files: Record<string, FileInfo>): RouteInfo[] {
  const routes: RouteInfo[] = [];
  
  // Look for React Router usage
  for (const [path, fileInfo] of Object.entries(files)) {
    if (fileInfo.content.includes('<Route') || fileInfo.content.includes('createBrowserRouter')) {
      // Extract route definitions (simplified)
      const routeMatches = fileInfo.content.matchAll(/path=["']([^"']+)["'].*(?:element|component)={([^}]+)}/g);
      
      for (const match of routeMatches) {
        const [, routePath] = match;
        // componentRef available in match but not used currently
        routes.push({
          path: routePath,
          component: path,
        });
      }
    }
    
    // Check for Next.js style pages
    if (fileInfo.relativePath.startsWith('pages/') || fileInfo.relativePath.startsWith('src/pages/')) {
      const routePath = '/' + fileInfo.relativePath
        .replace(/^(src\/)?pages\//, '')
        .replace(/\.(jsx?|tsx?)$/, '')
        .replace(/index$/, '');
        
      routes.push({
        path: routePath,
        component: path,
      });
    }
  }
  
  return routes;
}
