import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

export async function POST(request: NextRequest) {
  try {
    const { files } = await request.json();
    
    if (!files || typeof files !== 'object') {
      return NextResponse.json({ 
        success: false, 
        error: 'Files object is required' 
      }, { status: 400 });
    }

    const provider = sandboxManager.getActiveProvider() || (global as any).activeSandboxProvider;
    if (!provider) {
      return NextResponse.json({
        success: false,
        error: 'No active sandbox'
      }, { status: 404 });
    }

    console.log('[detect-and-install-packages] Processing files:', Object.keys(files));

    // Extract all import statements from the files
    const imports = new Set<string>();
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*,?\s*)*(?:from\s+)?['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(['"]([^'"]+)['"]\)/g;

    for (const [filePath, content] of Object.entries(files)) {
      if (typeof content !== 'string') continue;
      
      // Skip non-JS/JSX/TS/TSX files
      if (!filePath.match(/\.(jsx?|tsx?)$/)) continue;

      // Find ES6 imports
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        imports.add(match[1]);
      }

      // Find CommonJS requires
      while ((match = requireRegex.exec(content)) !== null) {
        imports.add(match[1]);
      }
    }

    console.log('[detect-and-install-packages] Found imports:', Array.from(imports));
    
    // Log specific heroicons imports
    const heroiconImports = Array.from(imports).filter(imp => imp.includes('heroicons'));
    if (heroiconImports.length > 0) {
      console.log('[detect-and-install-packages] Heroicon imports:', heroiconImports);
    }

    // Filter out relative imports and built-in modules
    const packages = Array.from(imports).filter(imp => {
      // Skip relative imports
      if (imp.startsWith('.') || imp.startsWith('/')) return false;
      
      // Skip built-in Node modules
      const builtins = ['fs', 'path', 'http', 'https', 'crypto', 'stream', 'util', 'os', 'url', 'querystring', 'child_process'];
      if (builtins.includes(imp)) return false;
      
      return true;
    });

    // Extract just the package names (without subpaths)
    const packageNames = packages.map(pkg => {
      if (pkg.startsWith('@')) {
        // Scoped package: @scope/package or @scope/package/subpath
        const parts = pkg.split('/');
        return parts.slice(0, 2).join('/');
      } else {
        // Regular package: package or package/subpath
        return pkg.split('/')[0];
      }
    });

    // Remove duplicates
    const uniquePackages = [...new Set(packageNames)];

    console.log('[detect-and-install-packages] Packages to install:', uniquePackages);

    if (uniquePackages.length === 0) {
      return NextResponse.json({
        success: true,
        packagesInstalled: [],
        message: 'No new packages to install'
      });
    }

    // Check which packages are already installed via package.json dependencies
    const installed: string[] = [];
    const missing: string[] = [];

    try {
      const packageJson = await provider.readFile('package.json');
      const parsed = JSON.parse(packageJson || '{}');
      const dependencies = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };

      for (const packageName of uniquePackages) {
        if (dependencies[packageName]) {
          installed.push(packageName);
        } else {
          missing.push(packageName);
        }
      }
    } catch (error) {
      console.warn('[detect-and-install-packages] Failed to read package.json, installing all packages', error);
      missing.push(...uniquePackages);
    }

    console.log('[detect-and-install-packages] Package status:', { installed, missing });

    if (missing.length === 0) {
      return NextResponse.json({
        success: true,
        packagesInstalled: [],
        packagesAlreadyInstalled: installed,
        message: 'All packages already installed'
      });
    }

    // Install missing packages using provider
    console.log('[detect-and-install-packages] Installing packages:', missing);
    const installResult = await provider.installPackages(missing);

    // Verify installation by re-reading package.json
    let finalInstalled: string[] = [];
    let failed: string[] = [];

    try {
      const packageJson = await provider.readFile('package.json');
      const parsed = JSON.parse(packageJson || '{}');
      const dependencies = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };

      finalInstalled = missing.filter(pkg => dependencies[pkg]);
      failed = missing.filter(pkg => !dependencies[pkg]);
    } catch (error) {
      console.error('[detect-and-install-packages] Verification failed, marking all missing as installed');
      finalInstalled = missing;
    }

    return NextResponse.json({
      success: installResult.success,
      packagesInstalled: finalInstalled,
      packagesFailed: failed,
      packagesAlreadyInstalled: installed,
      message: installResult.success
        ? `Installed ${finalInstalled.length} packages`
        : 'Package installation encountered issues',
      logs: installResult.stdout || installResult.stderr
    });

  } catch (error) {
    console.error('[detect-and-install-packages] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
