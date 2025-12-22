/**
 * Chutes IDP Authentication Library
 * 
 * Implements OAuth2 Authorization Code + PKCE flow for "Sign in with Chutes"
 */

import crypto from 'crypto';

// Chutes IDP Configuration
export const CHUTES_IDP_CONFIG = {
  issuer: 'https://api.chutes.ai',
  authorizationEndpoint: 'https://api.chutes.ai/idp/authorize',
  tokenEndpoint: 'https://api.chutes.ai/idp/token',
  userInfoEndpoint: 'https://api.chutes.ai/idp/userinfo',
  revocationEndpoint: 'https://api.chutes.ai/idp/token/revoke',
  // IDP host for inference calls with user's token
  idpHost: 'https://idp.chutes.ai',
  llmHost: 'llm.chutes.ai',
};

// OAuth client credentials (from environment)
export function getClientCredentials() {
  return {
    clientId: process.env.CHUTES_IDP_CLIENT_ID || '',
    clientSecret: process.env.CHUTES_IDP_CLIENT_SECRET || '',
    redirectUri: process.env.CHUTES_IDP_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/callback`,
  };
}

// Scopes to request
export const SCOPES = ['openid', 'profile', 'chutes:invoke'];

// Session cookie name
export const SESSION_COOKIE_NAME = 'chutes_webcoder_session';
export const AUTH_STATE_COOKIE_NAME = 'chutes_webcoder_auth_state';

// Types
export interface ChutesUser {
  sub: string;
  username: string;
  created_at?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
}

export interface AuthSession {
  user: ChutesUser;
  tokens: AuthTokens;
  createdAt: number;
}

export interface AuthState {
  state: string;
  codeVerifier?: string; // Optional - PKCE disabled due to Chutes IDP bug
  returnTo?: string;
  pendingRequest?: {
    type: string;
    payload: any;
  };
}

// PKCE utilities
export function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

// Build the authorization URL
// NOTE: PKCE is disabled due to a bug in Chutes IDP that returns 502 with code_challenge
export function buildAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = getClientCredentials();
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state: state,
  });
  
  return `${CHUTES_IDP_CONFIG.authorizationEndpoint}?${params.toString()}`;
}

// Exchange authorization code for tokens
// NOTE: code_verifier is optional - PKCE is disabled due to Chutes IDP bug
export async function exchangeCodeForTokens(code: string, codeVerifier?: string): Promise<AuthTokens> {
  const { clientId, clientSecret, redirectUri } = getClientCredentials();
  
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });
  
  // Add code_verifier if PKCE was used
  if (codeVerifier) {
    params.append('code_verifier', codeVerifier);
  }
  
  // Add client secret if available (confidential client)
  if (clientSecret) {
    params.append('client_secret', clientSecret);
  }
  
  const response = await fetch(CHUTES_IDP_CONFIG.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
    tokenType: data.token_type || 'Bearer',
  };
}

// Refresh access token
export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  const { clientId, clientSecret } = getClientCredentials();
  
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  
  if (clientSecret) {
    params.append('client_secret', clientSecret);
  }
  
  const response = await fetch(CHUTES_IDP_CONFIG.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in * 1000),
    tokenType: data.token_type || 'Bearer',
  };
}

// Get user info from Chutes IDP
export async function getUserInfo(accessToken: string): Promise<ChutesUser> {
  const response = await fetch(CHUTES_IDP_CONFIG.userInfoEndpoint, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }
  
  return response.json();
}

// Revoke token
export async function revokeToken(token: string): Promise<void> {
  const { clientId, clientSecret } = getClientCredentials();
  
  const params = new URLSearchParams({
    token: token,
    client_id: clientId,
  });
  
  if (clientSecret) {
    params.append('client_secret', clientSecret);
  }
  
  await fetch(CHUTES_IDP_CONFIG.revocationEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
}

// In-memory session store (for development - use Redis/DB in production)
const sessionStore = new Map<string, AuthSession>();

export function createSession(session: AuthSession): string {
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessionStore.set(sessionId, session);
  return sessionId;
}

export function getSession(sessionId: string): AuthSession | null {
  return sessionStore.get(sessionId) || null;
}

export function deleteSession(sessionId: string): void {
  sessionStore.delete(sessionId);
}

export function updateSessionTokens(sessionId: string, tokens: AuthTokens): void {
  const session = sessionStore.get(sessionId);
  if (session) {
    session.tokens = tokens;
    sessionStore.set(sessionId, session);
  }
}

// Check if tokens need refresh (5 min buffer)
export function tokensNeedRefresh(tokens: AuthTokens): boolean {
  return tokens.expiresAt - Date.now() < 5 * 60 * 1000;
}

// Make authenticated API call using user's Chutes account
export async function callChutesApiWithUserToken(
  accessToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${CHUTES_IDP_CONFIG.idpHost}${endpoint}`;
  
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`,
      'Host': CHUTES_IDP_CONFIG.llmHost,
    },
  });
}
