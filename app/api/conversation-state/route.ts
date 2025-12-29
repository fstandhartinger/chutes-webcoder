import { NextRequest, NextResponse } from 'next/server';
import type { ConversationState } from '@/types/conversation';

declare global {
  var conversationState: ConversationState | null;
  var conversationStateBySandbox: Record<string, ConversationState> | undefined;
}

function getConversationStore() {
  if (!global.conversationStateBySandbox) {
    global.conversationStateBySandbox = {};
  }
  return global.conversationStateBySandbox;
}

// GET: Retrieve current conversation state
export async function GET(request: NextRequest) {
  try {
    const sandboxId = request.nextUrl.searchParams.get('sandboxId') || 'default';
    const store = getConversationStore();
    const state = store[sandboxId] || global.conversationState;

    if (!state) {
      return NextResponse.json({
        success: true,
        state: null,
        message: 'No active conversation'
      });
    }
    
    return NextResponse.json({
      success: true,
      state
    });
  } catch (error) {
    console.error('[conversation-state] Error getting state:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

// POST: Reset or update conversation state
export async function POST(request: NextRequest) {
  try {
    const { action, data, sandboxId } = await request.json();
    const store = getConversationStore();
    const key = sandboxId || 'default';
    
    switch (action) {
      case 'reset':
        store[key] = {
          conversationId: `conv-${Date.now()}`,
          startedAt: Date.now(),
          lastUpdated: Date.now(),
          context: {
            messages: [],
            edits: [],
            projectEvolution: { majorChanges: [] },
            userPreferences: {}
          }
        };
        
        console.log('[conversation-state] Reset conversation state');
        
        return NextResponse.json({
          success: true,
          message: 'Conversation state reset',
          state: store[key]
        });
        
      case 'clear-old':
        // Clear old conversation data but keep recent context
        if (!store[key]) {
          // Initialize conversation state if it doesn't exist
          store[key] = {
            conversationId: `conv-${Date.now()}`,
            startedAt: Date.now(),
            lastUpdated: Date.now(),
            context: {
              messages: [],
              edits: [],
              projectEvolution: { majorChanges: [] },
              userPreferences: {}
            }
          };
          
          console.log('[conversation-state] Initialized new conversation state for clear-old');
          
          return NextResponse.json({
            success: true,
            message: 'New conversation state initialized',
            state: store[key]
          });
        }
        
        // Keep only recent data
        store[key].context.messages = store[key].context.messages.slice(-5);
        store[key].context.edits = store[key].context.edits.slice(-3);
        store[key].context.projectEvolution.majorChanges =
          store[key].context.projectEvolution.majorChanges.slice(-2);
        
        console.log('[conversation-state] Cleared old conversation data');
        
        return NextResponse.json({
          success: true,
          message: 'Old conversation data cleared',
          state: store[key]
        });
        
      case 'update':
        if (!store[key]) {
          return NextResponse.json({
            success: false,
            error: 'No active conversation to update'
          }, { status: 400 });
        }
        
        // Update specific fields if provided
        if (data) {
          if (data.currentTopic) {
            store[key].context.currentTopic = data.currentTopic;
          }
          if (data.userPreferences) {
            store[key].context.userPreferences = {
              ...store[key].context.userPreferences,
              ...data.userPreferences
            };
          }
          
          store[key].lastUpdated = Date.now();
        }
        
        return NextResponse.json({
          success: true,
          message: 'Conversation state updated',
          state: store[key]
        });
        
      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid action. Use "reset" or "update"'
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[conversation-state] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

// DELETE: Clear conversation state
export async function DELETE() {
  try {
    global.conversationState = null;
    global.conversationStateBySandbox = {};
    
    console.log('[conversation-state] Cleared conversation state');
    
    return NextResponse.json({
      success: true,
      message: 'Conversation state cleared'
    });
  } catch (error) {
    console.error('[conversation-state] Error clearing state:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
