export interface ParsedResponse {
  explanation: string;
  template: string;
  files: Array<{ path: string; content: string }>;
  packages: string[];
  commands: string[];
  structure: string | null;
}

export interface ParseAIResponseOptions {
  /**
   * Whether to scan extracted files for import statements and collect package names.
   * Enabled by default so streaming + non-streaming flows both benefit.
   */
  detectPackages?: boolean;
}

/**
 * Shared parser for AI XML-ish responses used in both streaming and non-streaming flows.
 * This collapses the duplicated logic that previously lived inside the API routes and
 * makes it simple to exercise via unit tests without exporting symbols from Next.js routes.
 */
export function parseAIResponse(response: string, options: ParseAIResponseOptions = {}): ParsedResponse {
  const detectPackages = options.detectPackages ?? true;

  const sections: ParsedResponse = {
    files: [],
    commands: [],
    packages: [],
    structure: null,
    explanation: '',
    template: ''
  };

  const fileMap = new Map<string, { content: string; isComplete: boolean }>();

  const extractPackagesFromCode = (content: string) => {
    if (!detectPackages) return;

    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.') || importPath.startsWith('/') || importPath === 'react' || importPath === 'react-dom' || importPath.startsWith('@/')) {
        continue;
      }

      const packageName = importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0];

      if (!sections.packages.includes(packageName)) {
        sections.packages.push(packageName);
      }
    }
  };

  const fileRegex = /<file path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(response)) !== null) {
    const filePath = match[1];
    const content = match[2].trim();
    const hasClosingTag = response.substring(match.index, match.index + match[0].length).includes('</file>');

    const existing = fileMap.get(filePath);
    let shouldReplace = false;
    if (!existing) {
      shouldReplace = true;
    } else if (!existing.isComplete && hasClosingTag) {
      shouldReplace = true;
      console.log(`[parseAIResponse] Replacing incomplete ${filePath} with complete version`);
    } else if (existing.isComplete && hasClosingTag && content.length > existing.content.length) {
      shouldReplace = true;
      console.log(`[parseAIResponse] Replacing ${filePath} with longer complete version`);
    } else if (!existing.isComplete && !hasClosingTag && content.length > existing.content.length) {
      shouldReplace = true;
    }

    if (shouldReplace) {
      if (content.includes('...') && !content.includes('...props') && !content.includes('...rest')) {
        console.warn(`[parseAIResponse] Warning: ${filePath} contains ellipsis, may be truncated`);
        if (!existing) {
          fileMap.set(filePath, { content, isComplete: hasClosingTag });
        }
      } else {
        fileMap.set(filePath, { content, isComplete: hasClosingTag });
      }
    }
  }

  for (const [path, { content, isComplete }] of fileMap.entries()) {
    if (!isComplete) {
      console.log(`[parseAIResponse] Warning: File ${path} appears to be truncated (no closing tag)`);
    }

    sections.files.push({ path, content });
    extractPackagesFromCode(content);
  }

  // Markdown blocks like ```file path="src/foo.tsx" ...```
  const markdownFileRegex = /```(?:file )?path="([^"]+)"\n([\s\S]*?)```/g;
  while ((match = markdownFileRegex.exec(response)) !== null) {
    const filePath = match[1];
    const content = match[2].trim();

    sections.files.push({ path: filePath, content });
    extractPackagesFromCode(content);
  }

  // Plain text declarations "Generated Files: Foo.tsx, Bar.tsx"
  const generatedFilesMatch = response.match(/Generated Files?:\s*([^\n]+)/i);
  if (generatedFilesMatch) {
    const filesList = generatedFilesMatch[1]
      .split(',')
      .map(f => f.trim())
      .filter(f => /\.(jsx?|tsx?|css|json|html)$/.test(f));

    for (const fileName of filesList) {
      const fileContentRegex = new RegExp(`${fileName}[\s\S]*?(?:import[\s\S]+?)(?=Generated Files:|Applying code|$)`, 'i');
      const fileContentMatch = response.match(fileContentRegex);
      if (fileContentMatch) {
        const codeMatch = fileContentMatch[0].match(/^(import[\s\S]+)$/m);
        if (codeMatch) {
          const filePath = fileName.includes('/') ? fileName : `src/components/${fileName}`;
          sections.files.push({ path: filePath, content: codeMatch[1].trim() });
          extractPackagesFromCode(codeMatch[1]);
        }
      }
    }
  }

  // Raw code blocks without explicit path, optionally hint via comments
  const codeBlockRegex = /```(?:jsx?|tsx?|javascript|typescript)?\n([\s\S]*?)```/g;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    const content = match[1].trim();
    const fileNameMatch = content.match(/\/\/\s*(?:File:|Component:)\s*([^\n]+)/);

    if (fileNameMatch) {
      const fileName = fileNameMatch[1].trim();
      const filePath = fileName.includes('/') ? fileName : `src/components/${fileName}`;

      if (!sections.files.some(f => f.path === filePath)) {
        sections.files.push({ path: filePath, content });
        extractPackagesFromCode(content);
      }
    }
  }

  // Commands & packages expressed in XML tags
  const cmdRegex = /<command>(.*?)<\/command>/g;
  while ((match = cmdRegex.exec(response)) !== null) {
    sections.commands.push(match[1].trim());
  }

  const pkgRegex = /<package>(.*?)<\/package>/g;
  while ((match = pkgRegex.exec(response)) !== null) {
    const pkg = match[1].trim();
    if (!sections.packages.includes(pkg)) {
      sections.packages.push(pkg);
    }
  }

  const packagesRegex = /<packages>([\s\S]*?)<\/packages>/;
  const packagesMatch = response.match(packagesRegex);
  if (packagesMatch) {
    packagesMatch[1]
      .split(/[\n,]+/)
      .map(pkg => pkg.trim())
      .filter(Boolean)
      .forEach(pkg => {
        if (!sections.packages.includes(pkg)) {
          sections.packages.push(pkg);
        }
      });
  }

  const structureMatch = response.match(/<structure>([\s\S]*?)<\/structure>/);
  if (structureMatch) {
    sections.structure = structureMatch[1].trim();
  }

  const explanationMatch = response.match(/<explanation>([\s\S]*?)<\/explanation>/);
  if (explanationMatch) {
    sections.explanation = explanationMatch[1].trim();
  }

  const templateMatch = response.match(/<template>(.*?)<\/template>/);
  if (templateMatch) {
    sections.template = templateMatch[1].trim();
  }

  return sections;
}
