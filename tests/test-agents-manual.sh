#!/bin/bash
# Manual test script for CLI agents on Sandy sandbox
# 
# Usage: ./tests/test-agents-manual.sh
#
# Prerequisites:
# - SANDY_BASE_URL, SANDY_API_KEY, CHUTES_API_KEY environment variables set
# - curl and jq installed

set -e

SANDY_BASE_URL="${SANDY_BASE_URL:-https://sandy.65.109.49.103.nip.io}"
CHUTES_API_KEY="${CHUTES_API_KEY:-}"
SANDY_API_KEY="${SANDY_API_KEY:-}"

if [ -z "$CHUTES_API_KEY" ] || [ -z "$SANDY_API_KEY" ]; then
    echo "Error: CHUTES_API_KEY and SANDY_API_KEY must be set"
    exit 1
fi

echo "=== Agent CLI Test Script ==="
echo "SANDY_BASE_URL: $SANDY_BASE_URL"
echo ""

# Create a sandbox
echo "Creating sandbox..."
SANDBOX_RESPONSE=$(curl -s -X POST "$SANDY_BASE_URL/api/sandboxes" \
    -H "Authorization: Bearer $SANDY_API_KEY" \
    -H "Content-Type: application/json")

SANDBOX_ID=$(echo "$SANDBOX_RESPONSE" | jq -r '.sandboxId')
echo "Sandbox ID: $SANDBOX_ID"

if [ "$SANDBOX_ID" == "null" ] || [ -z "$SANDBOX_ID" ]; then
    echo "Error: Failed to create sandbox"
    echo "$SANDBOX_RESPONSE"
    exit 1
fi

# Cleanup function
cleanup() {
    echo ""
    echo "Terminating sandbox $SANDBOX_ID..."
    curl -s -X POST "$SANDY_BASE_URL/api/sandboxes/$SANDBOX_ID/terminate" \
        -H "Authorization: Bearer $SANDY_API_KEY" > /dev/null 2>&1 || true
}
trap cleanup EXIT

# Wait for sandbox to be ready
echo "Waiting for sandbox to be ready..."
sleep 3

# Function to exec command in sandbox
exec_in_sandbox() {
    local command="$1"
    local env_json="$2"
    
    curl -s -X POST "$SANDY_BASE_URL/api/sandboxes/$SANDBOX_ID/exec" \
        -H "Authorization: Bearer $SANDY_API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"command\": \"$command\", \"cwd\": \"/workspace\", \"env\": $env_json, \"timeoutMs\": 120000}"
}

# Test 1: Check if CLI tools are installed
echo ""
echo "=== Test 1: Check CLI tools ==="

echo "Checking Claude Code..."
RESULT=$(exec_in_sandbox "claude --version 2>&1 || echo 'not found'" "{}")
echo "Claude: $(echo "$RESULT" | jq -r '.stdout' | head -1)"

echo "Checking OpenAI Codex..."
RESULT=$(exec_in_sandbox "codex --version 2>&1 || echo 'not found'" "{}")
echo "Codex: $(echo "$RESULT" | jq -r '.stdout' | head -1)"

echo "Checking Aider..."
RESULT=$(exec_in_sandbox "aider --version 2>&1 || echo 'not found'" "{}")
echo "Aider: $(echo "$RESULT" | jq -r '.stdout' | head -1)"

# Test 2: Test Aider with simple prompt
echo ""
echo "=== Test 2: Aider Simple Test ==="

AIDER_ENV='{
    "OPENAI_API_KEY": "'$CHUTES_API_KEY'",
    "OPENAI_API_BASE": "https://llm.chutes.ai/v1",
    "AIDER_MODEL": "openai/zai-org/GLM-4.7-TEE",
    "NO_COLOR": "1",
    "TERM": "dumb"
}'

echo "Running Aider with GLM-4.7-TEE..."
RESULT=$(exec_in_sandbox "aider --yes --no-git --no-auto-commits --no-show-model-warnings --no-pretty --no-stream --message 'Create a file hello.txt with Hello World' 2>&1" "$AIDER_ENV")

EXIT_CODE=$(echo "$RESULT" | jq -r '.exitCode')
STDOUT=$(echo "$RESULT" | jq -r '.stdout' | head -20)
STDERR=$(echo "$RESULT" | jq -r '.stderr' | head -5)

echo "Exit code: $EXIT_CODE"
echo "Stdout (first 20 lines):"
echo "$STDOUT"
if [ -n "$STDERR" ] && [ "$STDERR" != "null" ]; then
    echo "Stderr:"
    echo "$STDERR"
fi

# Check if file was created
echo ""
echo "Checking if hello.txt was created..."
RESULT=$(exec_in_sandbox "cat /workspace/hello.txt 2>&1 || echo 'file not found'" "{}")
echo "hello.txt content: $(echo "$RESULT" | jq -r '.stdout')"

# Test 3: Test Claude Code with simple prompt
echo ""
echo "=== Test 3: Claude Code Simple Test ==="

CLAUDE_ENV='{
    "ANTHROPIC_BASE_URL": "https://claude.chutes.ai",
    "ANTHROPIC_AUTH_TOKEN": "'$CHUTES_API_KEY'",
    "ANTHROPIC_API_KEY": "'$CHUTES_API_KEY'",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "zai-org/GLM-4.7-TEE",
    "API_TIMEOUT_MS": "120000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
}'

echo "Running Claude Code with GLM-4.7-TEE..."
RESULT=$(exec_in_sandbox "claude -p 'Create a file called test.txt with the text Test File' --output-format text --allowedTools Read,Write,Bash --permission-mode acceptEdits 2>&1" "$CLAUDE_ENV")

EXIT_CODE=$(echo "$RESULT" | jq -r '.exitCode')
STDOUT=$(echo "$RESULT" | jq -r '.stdout' | head -20)
STDERR=$(echo "$RESULT" | jq -r '.stderr' | head -5)

echo "Exit code: $EXIT_CODE"
echo "Stdout (first 20 lines):"
echo "$STDOUT"
if [ -n "$STDERR" ] && [ "$STDERR" != "null" ]; then
    echo "Stderr:"
    echo "$STDERR"
fi

echo ""
echo "=== Tests Complete ==="



















