import { NextRequest, NextResponse } from 'next/server';
import { parseMorphEdits, applyMorphEditToFile } from '@/lib/morph-fast-apply';
import { parseAIResponse } from '@/lib/ai-response';
// Sandbox import not needed - using global sandbox from sandbox-manager
import type { SandboxState } from '@/types/sandbox';
import type { ConversationState } from '@/types/conversation';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { resolveSandboxUrls } from '@/lib/server/sandbox-preview';

declare global {
  var conversationState: ConversationState | null;
  var activeSandboxProvider: any;
  var existingFiles: Set<string>;
  var sandboxState: SandboxState;
}


export async function POST(request: NextRequest) {
  try {
    const { response, isEdit = false, packages = [], sandboxId } = await request.json();

    if (!response) {
      return NextResponse.json({
        error: 'response is required'
      }, { status: 400 });
    }

    // sandboxId is now REQUIRED for session isolation
    if (!sandboxId) {
      console.error('[apply-ai-code-stream] Missing sandboxId - required for session isolation');
      return NextResponse.json({
        error: 'sandboxId is required for session isolation'
      }, { status: 400 });
    }

    // Debug log the response
    console.log('[apply-ai-code-stream] Received response to parse:');
    console.log('[apply-ai-code-stream] Response length:', response.length);
    console.log('[apply-ai-code-stream] Response preview:', response.substring(0, 500));
    console.log('[apply-ai-code-stream] isEdit:', isEdit);
    console.log('[apply-ai-code-stream] packages:', packages);

    // Parse the AI response
    const parsed = parseAIResponse(response);
    const morphEnabled = Boolean(isEdit && process.env.MORPH_API_KEY);
    const morphEdits = morphEnabled ? parseMorphEdits(response) : [];
    console.log('[apply-ai-code-stream] Morph Fast Apply mode:', morphEnabled);
    if (morphEnabled) {
      console.log('[apply-ai-code-stream] Morph edits found:', morphEdits.length);
    }
    
    // Log what was parsed
    console.log('[apply-ai-code-stream] Parsed result:');
    console.log('[apply-ai-code-stream] Files found:', parsed.files.length);
    if (parsed.files.length > 0) {
      parsed.files.forEach(f => {
        console.log(`[apply-ai-code-stream] - ${f.path} (${f.content.length} chars)`);
      });
    }
    console.log('[apply-ai-code-stream] Packages found:', parsed.packages);

    // Get provider from sandbox manager by explicit sandboxId (no fallback to globals)
    console.log(`[apply-ai-code-stream] Looking up provider for sandbox: ${sandboxId}`);
    let provider = sandboxManager.getProvider(sandboxId);

    // If no provider found, try to reconnect or create
    if (!provider) {
      console.log(`[apply-ai-code-stream] No provider found for sandbox ${sandboxId}, attempting to get or create...`);

      try {
        provider = await sandboxManager.getOrCreateProvider(sandboxId);

        // If we got a new provider (not reconnected), we need to create a new sandbox
        if (!provider.getSandboxInfo()) {
          console.log(`[apply-ai-code-stream] Creating new sandbox since reconnection failed for ${sandboxId}`);
          await provider.createSandbox();
          await provider.setupViteApp();
          sandboxManager.registerSandbox(sandboxId, provider);
        }

        // NOTE: No longer updating legacy global state for session isolation
        console.log(`[apply-ai-code-stream] Successfully got provider for sandbox ${sandboxId}`);
      } catch (providerError) {
        console.error(`[apply-ai-code-stream] Failed to get or create provider for sandbox ${sandboxId}:`, providerError);
        return NextResponse.json({
          success: false,
          error: `Failed to create sandbox provider for ${sandboxId}. The sandbox may have expired.`,
          results: {
            filesCreated: [],
            packagesInstalled: [],
            commandsExecuted: [],
            errors: [`Sandbox provider creation failed: ${(providerError as Error).message}`]
          },
          explanation: parsed.explanation,
          structure: parsed.structure,
          parsedFiles: parsed.files,
          message: `Parsed ${parsed.files.length} files but couldn't apply them - sandbox reconnection failed.`
        }, { status: 500 });
      }
    }

    // If we still don't have a provider, return error (don't create a new sandbox with different ID)
    if (!provider) {
      console.error(`[apply-ai-code-stream] Sandbox ${sandboxId} not found and could not be reconnected`);
      return NextResponse.json({
        success: false,
        error: `Sandbox ${sandboxId} not found. The sandbox may have expired. Please create a new sandbox.`,
        results: {
          filesCreated: [],
          packagesInstalled: [],
          commandsExecuted: [],
          errors: [`Sandbox ${sandboxId} not found - please create a new sandbox`]
        },
        explanation: parsed.explanation,
        structure: parsed.structure,
        parsedFiles: parsed.files,
        message: `Parsed ${parsed.files.length} files but couldn't apply them - sandbox not found.`
      }, { status: 404 });
    }

    // Create a response stream for real-time updates
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Function to send progress updates
    const sendProgress = async (data: any) => {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(message));
    };

    // Start processing in background (pass provider and request to the async function)
    (async (providerInstance, req) => {
      const results = {
        filesCreated: [] as string[],
        filesUpdated: [] as string[],
        packagesInstalled: [] as string[],
        packagesAlreadyInstalled: [] as string[],
        packagesFailed: [] as string[],
        commandsExecuted: [] as string[],
        errors: [] as string[]
      };

      try {
        await sendProgress({
          type: 'start',
          message: 'Starting code application...',
          totalSteps: 3
        });
        if (morphEnabled) {
          await sendProgress({ type: 'info', message: 'Morph Fast Apply enabled' });
          await sendProgress({ type: 'info', message: `Parsed ${morphEdits.length} Morph edits` });
          if (morphEdits.length === 0) {
            console.warn('[apply-ai-code-stream] Morph enabled but no <edit> blocks found; falling back to full-file flow');
            await sendProgress({ type: 'warning', message: 'Morph enabled but no <edit> blocks found; falling back to full-file flow' });
          }
        }
        
        // Step 1: Install packages
        const packagesArray = Array.isArray(packages) ? packages : [];
        const parsedPackages = Array.isArray(parsed.packages) ? parsed.packages : [];

        // Combine and deduplicate packages
        const allPackages = [...packagesArray.filter(pkg => pkg && typeof pkg === 'string'), ...parsedPackages];

        // Use Set to remove duplicates, then filter out pre-installed packages
        const uniquePackages = [...new Set(allPackages)]
          .filter(pkg => pkg && typeof pkg === 'string' && pkg.trim() !== '') // Remove empty strings
          .filter(pkg => pkg !== 'react' && pkg !== 'react-dom'); // Filter pre-installed

        // Log if we found duplicates
        if (allPackages.length !== uniquePackages.length) {
          console.log(`[apply-ai-code-stream] Removed ${allPackages.length - uniquePackages.length} duplicate packages`);
          console.log(`[apply-ai-code-stream] Original packages:`, allPackages);
          console.log(`[apply-ai-code-stream] Deduplicated packages:`, uniquePackages);
        }

        if (uniquePackages.length > 0) {
          await sendProgress({
            type: 'step',
            step: 1,
            message: `Installing ${uniquePackages.length} packages...`,
            packages: uniquePackages
          });

          // Use streaming package installation
          try {
            // Construct the API URL properly for both dev and production
            const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
            const host = req.headers.get('host') || 'localhost:3000';
            const apiUrl = `${protocol}://${host}/api/install-packages`;

            const installResponse = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                packages: uniquePackages,
                sandboxId: sandboxId || providerInstance.getSandboxInfo()?.sandboxId
              })
            });

            if (installResponse.ok && installResponse.body) {
              const reader = installResponse.body.getReader();
              const decoder = new TextDecoder();

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                if (!chunk) continue;
                const lines = chunk.split('\n');

                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    try {
                      const data = JSON.parse(line.slice(6));

                      // Forward package installation progress
                      await sendProgress({
                        type: 'package-progress',
                        ...data
                      });

                      // Track results
                      if (data.type === 'success' && data.installedPackages) {
                        results.packagesInstalled = data.installedPackages;
                      }
                    } catch (parseError) {
                      console.debug('Error parsing terminal output:', parseError);
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.error('[apply-ai-code-stream] Error installing packages:', error);
            await sendProgress({
              type: 'warning',
              message: `Package installation skipped (${(error as Error).message}). Continuing with file creation...`
            });
            results.errors.push(`Package installation failed: ${(error as Error).message}`);
          }
        } else {
          await sendProgress({
            type: 'step',
            step: 1,
            message: 'No additional packages to install, skipping...'
          });
        }

        // Step 2: Create/update files
        const filesArray = Array.isArray(parsed.files) ? parsed.files : [];
        await sendProgress({
          type: 'step',
          step: 2,
          message: `Creating ${filesArray.length} files...`
        });

        // Filter out config files that shouldn't be created
        const configFiles = ['tailwind.config.js', 'vite.config.js', 'package.json', 'package-lock.json', 'tsconfig.json', 'postcss.config.js'];
        let filteredFiles = filesArray.filter(file => {
          if (!file || typeof file !== 'object') return false;
          const fileName = (file.path || '').split('/').pop() || '';
          return !configFiles.includes(fileName);
        });

        // If Morph is enabled and we have edits, apply them before file writes
        const morphUpdatedPaths = new Set<string>();
        if (morphEnabled && morphEdits.length > 0) {
          const morphSandbox = (global as any).activeSandbox || providerInstance;
          if (!morphSandbox) {
            console.warn('[apply-ai-code-stream] No sandbox available to apply Morph edits');
            await sendProgress({ type: 'warning', message: 'No sandbox available to apply Morph edits' });
          } else {
            await sendProgress({ type: 'info', message: `Applying ${morphEdits.length} fast edits via Morph...` });
            for (const [idx, edit] of morphEdits.entries()) {
              try {
                await sendProgress({ type: 'file-progress', current: idx + 1, total: morphEdits.length, fileName: edit.targetFile, action: 'morph-applying' });
                const result = await applyMorphEditToFile({
                  sandbox: morphSandbox,
                  targetPath: edit.targetFile,
                  instructions: edit.instructions,
                  updateSnippet: edit.update
                });
                if (result.success && result.normalizedPath) {
                  console.log('[apply-ai-code-stream] Morph updated', result.normalizedPath);
                  morphUpdatedPaths.add(result.normalizedPath);
                  if (results.filesUpdated) results.filesUpdated.push(result.normalizedPath);
                  await sendProgress({ type: 'file-complete', fileName: result.normalizedPath, action: 'morph-updated' });
                } else {
                  const msg = result.error || 'Unknown Morph error';
                  console.error('[apply-ai-code-stream] Morph apply failed for', edit.targetFile, msg);
                  if (results.errors) results.errors.push(`Morph apply failed for ${edit.targetFile}: ${msg}`);
                  await sendProgress({ type: 'file-error', fileName: edit.targetFile, error: msg });
                }
              } catch (err) {
                const msg = (err as Error).message;
                console.error('[apply-ai-code-stream] Morph apply exception for', edit.targetFile, msg);
                if (results.errors) results.errors.push(`Morph apply exception for ${edit.targetFile}: ${msg}`);
                await sendProgress({ type: 'file-error', fileName: edit.targetFile, error: msg });
              }
            }
          }
        }

        // Avoid overwriting Morph-updated files in the file write loop
        if (morphUpdatedPaths.size > 0) {
          filteredFiles = filteredFiles.filter(file => {
            if (!file?.path) return true;
            let normalizedPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
            const fileName = normalizedPath.split('/').pop() || '';
            if (!normalizedPath.startsWith('src/') &&
                !normalizedPath.startsWith('public/') &&
                normalizedPath !== 'index.html' &&
                !configFiles.includes(fileName)) {
              normalizedPath = 'src/' + normalizedPath;
            }
            return !morphUpdatedPaths.has(normalizedPath);
          });
        }
        
        for (const [index, file] of filteredFiles.entries()) {
          try {
            // Send progress for each file
            await sendProgress({
              type: 'file-progress',
              current: index + 1,
              total: filteredFiles.length,
              fileName: file.path,
              action: 'creating'
            });

            // Normalize the file path
            let normalizedPath = file.path;
            if (normalizedPath.startsWith('/')) {
              normalizedPath = normalizedPath.substring(1);
            }
            if (!normalizedPath.startsWith('src/') &&
              !normalizedPath.startsWith('public/') &&
              normalizedPath !== 'index.html' &&
              !configFiles.includes(normalizedPath.split('/').pop() || '')) {
              normalizedPath = 'src/' + normalizedPath;
            }

            const isUpdate = global.existingFiles.has(normalizedPath);

            // Remove any CSS imports from JSX/JS files (we're using Tailwind)
            let fileContent = file.content;
            if (file.path.endsWith('.jsx') || file.path.endsWith('.js') || file.path.endsWith('.tsx') || file.path.endsWith('.ts')) {
              fileContent = fileContent.replace(/import\s+['"]\.\/[^'"]+\.css['"];?\s*\n?/g, '');
            }

            // Fix common Tailwind CSS errors in CSS files
            if (file.path.endsWith('.css')) {
              // Replace shadow-3xl with shadow-2xl (shadow-3xl doesn't exist)
              fileContent = fileContent.replace(/shadow-3xl/g, 'shadow-2xl');
              // Replace any other non-existent shadow utilities
              fileContent = fileContent.replace(/shadow-4xl/g, 'shadow-2xl');
              fileContent = fileContent.replace(/shadow-5xl/g, 'shadow-2xl');
            }

            // Create directory if needed
            const dirPath = normalizedPath.includes('/') ? normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) : '';
            if (dirPath) {
              await providerInstance.runCommand(`mkdir -p ${dirPath}`);
            }

            // Write the file using provider
            await providerInstance.writeFile(normalizedPath, fileContent);

            // Update file cache
            if (global.sandboxState?.fileCache) {
              global.sandboxState.fileCache.files[normalizedPath] = {
                content: fileContent,
                lastModified: Date.now()
              };
            }

            if (isUpdate) {
              if (results.filesUpdated) results.filesUpdated.push(normalizedPath);
            } else {
              if (results.filesCreated) results.filesCreated.push(normalizedPath);
              if (global.existingFiles) global.existingFiles.add(normalizedPath);
            }

            await sendProgress({
              type: 'file-complete',
              fileName: normalizedPath,
              action: isUpdate ? 'updated' : 'created'
            });
          } catch (error) {
            if (results.errors) {
              results.errors.push(`Failed to create ${file.path}: ${(error as Error).message}`);
            }
            await sendProgress({
              type: 'file-error',
              fileName: file.path,
              error: (error as Error).message
            });
          }
        }

        // Step 3: Execute commands
        const commandsArray = Array.isArray(parsed.commands) ? parsed.commands : [];
        if (commandsArray.length > 0) {
          await sendProgress({
            type: 'step',
            step: 3,
            message: `Executing ${commandsArray.length} commands...`
          });

          for (const [index, cmd] of commandsArray.entries()) {
            try {
              await sendProgress({
                type: 'command-progress',
                current: index + 1,
                total: parsed.commands.length,
                command: cmd,
                action: 'executing'
              });

              // Use provider runCommand
              const result = await providerInstance.runCommand(cmd);

              // Get command output from provider result
              const stdout = result.stdout;
              const stderr = result.stderr;

              if (stdout) {
                await sendProgress({
                  type: 'command-output',
                  command: cmd,
                  output: stdout,
                  stream: 'stdout'
                });
              }

              if (stderr) {
                await sendProgress({
                  type: 'command-output',
                  command: cmd,
                  output: stderr,
                  stream: 'stderr'
                });
              }

              if (results.commandsExecuted) {
                results.commandsExecuted.push(cmd);
              }

              await sendProgress({
                type: 'command-complete',
                command: cmd,
                exitCode: result.exitCode,
                success: result.exitCode === 0
              });
            } catch (error) {
              if (results.errors) {
                results.errors.push(`Failed to execute ${cmd}: ${(error as Error).message}`);
              }
              await sendProgress({
                type: 'command-error',
                command: cmd,
                error: (error as Error).message
              });
            }
          }
        }

        // Send final results
        await sendProgress({
          type: 'complete',
          results,
          explanation: parsed.explanation,
          structure: parsed.structure,
          message: `Successfully applied ${results.filesCreated.length} files`
        });

        // Track applied files in conversation state
        if (global.conversationState && results.filesCreated.length > 0) {
          const messages = global.conversationState.context.messages;
          if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'user') {
              lastMessage.metadata = {
                ...lastMessage.metadata,
                editedFiles: results.filesCreated
              };
            }
          }

          // Track applied code in project evolution
          if (global.conversationState.context.projectEvolution) {
            global.conversationState.context.projectEvolution.majorChanges.push({
              timestamp: Date.now(),
              description: parsed.explanation || 'Code applied',
              filesAffected: results.filesCreated || []
            });
          }

          global.conversationState.lastUpdated = Date.now();
        }

      } catch (error) {
        await sendProgress({
          type: 'error',
          error: (error as Error).message
        });
      } finally {
        await writer.close();
      }
    })(provider, request);

    // Return the stream
    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Apply AI code stream error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse AI code' },
      { status: 500 }
    );
  }
}
