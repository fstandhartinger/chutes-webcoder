import { SandboxProvider } from './types';
import { SandboxFactory } from './factory';

interface SandboxInfo {
  sandboxId: string;
  provider: SandboxProvider;
  createdAt: Date;
  lastAccessed: Date;
}

class SandboxManager {
  private sandboxes: Map<string, SandboxInfo> = new Map();
  // NOTE: activeSandboxId removed - each session must track its own sandboxId
  // to prevent sandbox sharing between concurrent users/sessions

  /**
   * Get or create a sandbox provider for the given sandbox ID
   */
  async getOrCreateProvider(sandboxId: string): Promise<SandboxProvider> {
    // Check if we already have this sandbox
    const existing = this.sandboxes.get(sandboxId);
    if (existing) {
      existing.lastAccessed = new Date();
      return existing.provider;
    }

    // Try to reconnect to existing sandbox

    try {
      const provider = SandboxFactory.create();

      if (typeof (provider as any).reconnect === 'function') {
        const reconnected = await (provider as any).reconnect(sandboxId);
        if (reconnected) {
          this.sandboxes.set(sandboxId, {
            sandboxId,
            provider,
            createdAt: new Date(),
            lastAccessed: new Date()
          });
          // NOTE: No longer setting activeSandboxId - session isolation
          return provider;
        }
      }

      // For Vercel or if reconnection failed, return the new provider
      // The caller will need to handle creating a new sandbox
      return provider;
    } catch (error) {
      console.error(`[SandboxManager] Error reconnecting to sandbox ${sandboxId}:`, error);
      throw error;
    }
  }

  /**
   * Register a new sandbox
   */
  registerSandbox(sandboxId: string, provider: SandboxProvider): void {
    this.sandboxes.set(sandboxId, {
      sandboxId,
      provider,
      createdAt: new Date(),
      lastAccessed: new Date()
    });
    // NOTE: No longer setting activeSandboxId - each session tracks its own
    console.log(`[SandboxManager] Registered sandbox ${sandboxId}. Total sandboxes: ${this.sandboxes.size}`);
  }

  /**
   * Get the active sandbox provider
   * @deprecated Use getProvider(sandboxId) instead - this method returns null to enforce session isolation
   */
  getActiveProvider(): SandboxProvider | null {
    console.warn('[SandboxManager] DEPRECATED: getActiveProvider() called - use getProvider(sandboxId) instead for session isolation');
    // Return null to force callers to use explicit sandboxId
    return null;
  }

  /**
   * Get a specific sandbox provider
   */
  getProvider(sandboxId: string): SandboxProvider | null {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox) {
      sandbox.lastAccessed = new Date();
      return sandbox.provider;
    }
    return null;
  }

  /**
   * Set the active sandbox
   * @deprecated No longer used - each session tracks its own sandboxId
   */
  setActiveSandbox(sandboxId: string): boolean {
    console.warn('[SandboxManager] DEPRECATED: setActiveSandbox() called - no-op for session isolation');
    // No-op - each session should track its own sandboxId
    return this.sandboxes.has(sandboxId);
  }

  /**
   * Terminate a sandbox
   */
  async terminateSandbox(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox) {
      try {
        await sandbox.provider.terminate();
        console.log(`[SandboxManager] Terminated sandbox ${sandboxId}`);
      } catch (error) {
        console.error(`[SandboxManager] Error terminating sandbox ${sandboxId}:`, error);
      }
      this.sandboxes.delete(sandboxId);
    }
  }

  /**
   * Terminate all sandboxes
   */
  async terminateAll(): Promise<void> {
    console.log(`[SandboxManager] Terminating all ${this.sandboxes.size} sandboxes`);
    const promises = Array.from(this.sandboxes.values()).map(sandbox =>
      sandbox.provider.terminate().catch(err =>
        console.error(`[SandboxManager] Error terminating sandbox ${sandbox.sandboxId}:`, err)
      )
    );

    await Promise.all(promises);
    this.sandboxes.clear();
  }

  /**
   * Clean up old sandboxes (older than maxAge milliseconds)
   */
  async cleanup(maxAge: number = 3600000): Promise<void> {
    const now = new Date();
    const toDelete: string[] = [];
    
    for (const [id, info] of this.sandboxes.entries()) {
      const age = now.getTime() - info.lastAccessed.getTime();
      if (age > maxAge) {
        toDelete.push(id);
      }
    }
    
    for (const id of toDelete) {
      await this.terminateSandbox(id);
    }
  }
}

// Export singleton instance
export const sandboxManager = new SandboxManager();

// Also maintain backward compatibility with global state
declare global {
  var sandboxManager: SandboxManager;
}

// Ensure the global reference points to our singleton
global.sandboxManager = sandboxManager;
