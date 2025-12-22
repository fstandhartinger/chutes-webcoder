'use client';

import React, { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';

export interface User {
  id: string;
  username: string;
  createdAt?: string;
}

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasInvokeScope: boolean;
}

export interface PendingRequest {
  type: string;
  payload: any;
}

interface AuthContextValue extends AuthState {
  login: (returnTo?: string, pendingRequest?: PendingRequest) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  checkAuthAndProceed: <T>(
    action: () => Promise<T>,
    requestType: string,
    requestPayload: unknown
  ) => Promise<T | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
    hasInvokeScope: false,
  });

  // Fetch current user on mount
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me');
      if (response.ok) {
        const data = await response.json();
        setState({
          user: data.user,
          isLoading: false,
          isAuthenticated: !!data.user,
          hasInvokeScope: data.hasInvokeScope || false,
        });
      } else {
        setState({
          user: null,
          isLoading: false,
          isAuthenticated: false,
          hasInvokeScope: false,
        });
      }
    } catch (error) {
      console.error('[useAuth] Failed to fetch user:', error);
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        hasInvokeScope: false,
      });
    }
  }, []);

  useEffect(() => {
    refresh();
    
    // Check for pending request in URL (after OAuth callback)
    const urlParams = new URLSearchParams(window.location.search);
    const pendingRequestParam = urlParams.get('pendingRequest');
    
    if (pendingRequestParam) {
      try {
        const pendingRequest = JSON.parse(decodeURIComponent(pendingRequestParam));
        // Store pending request for the app to handle
        sessionStorage.setItem('pendingAuthRequest', JSON.stringify(pendingRequest));
        
        // Clean up URL
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('pendingRequest');
        window.history.replaceState({}, '', newUrl.toString());
      } catch (e) {
        console.error('[useAuth] Failed to parse pending request:', e);
      }
    }
    
    // Check for auth error in URL
    const authError = urlParams.get('authError');
    if (authError) {
      console.error('[useAuth] Auth error:', authError);
      // Clean up URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('authError');
      window.history.replaceState({}, '', newUrl.toString());
    }
  }, [refresh]);

  // Login function - redirects to login page
  const login = useCallback((returnTo?: string, pendingRequest?: PendingRequest) => {
    let loginUrl = '/api/auth/login';
    const params = new URLSearchParams();
    
    if (returnTo) {
      params.set('returnTo', returnTo);
    }
    
    if (pendingRequest) {
      params.set('pendingRequestType', pendingRequest.type);
      params.set('pendingRequestPayload', encodeURIComponent(JSON.stringify(pendingRequest.payload)));
    }
    
    if (params.toString()) {
      loginUrl += `?${params.toString()}`;
    }
    
    window.location.href = loginUrl;
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        hasInvokeScope: false,
      });
    } catch (error) {
      console.error('[useAuth] Logout failed:', error);
    }
  }, []);

  // Check auth before proceeding with an action
  // If not authenticated, redirect to login with the request saved
  // After successful login, the request can be resumed
  const checkAuthAndProceed = useCallback(
    async function<T>(
      action: () => Promise<T>,
      requestType: string,
      requestPayload: unknown
    ): Promise<T | null> {
      // Wait for auth state to load
      if (state.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
        // If still loading after a brief wait, let it proceed
      }
      
      if (!state.isAuthenticated) {
        // Store the pending request and redirect to login
        login(window.location.pathname, {
          type: requestType,
          payload: requestPayload,
        });
        return null;
      }
      
      // User is authenticated, proceed with the action
      return action();
    },
    [state.isLoading, state.isAuthenticated, login]
  );

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        refresh,
        checkAuthAndProceed,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Hook to get and clear pending auth request
export function usePendingAuthRequest(): {
  pendingRequest: PendingRequest | null;
  clearPendingRequest: () => void;
} {
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('pendingAuthRequest');
    if (stored) {
      try {
        setPendingRequest(JSON.parse(stored));
      } catch (e) {
        console.error('[usePendingAuthRequest] Failed to parse:', e);
      }
    }
  }, []);

  const clearPendingRequest = useCallback(() => {
    sessionStorage.removeItem('pendingAuthRequest');
    setPendingRequest(null);
  }, []);

  return { pendingRequest, clearPendingRequest };
}
