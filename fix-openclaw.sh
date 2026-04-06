#!/usr/bin/env bash
# OpenClaw Installation Fix Script (Linux/macOS)
# Fixes common OpenClaw startup/crash issues.

set -e

echo "============================================"
echo "  OpenClaw Installation Fix Script"
echo "============================================"
echo

# Step 1: Verify Node.js
if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found. Please install Node.js 18+ first."
    exit 1
fi
echo "[OK] Node.js found: $(node --version)"

# Step 2: Reinstall openclaw globally
echo
echo "Reinstalling OpenClaw..."
npm install -g openclaw@latest
echo "[OK] OpenClaw installed"

# Step 3: Run setup to create state directory and config
echo
echo "Running OpenClaw setup..."
openclaw setup
echo "[OK] Setup complete"

# Step 4: Set gateway mode to local
echo
echo "Configuring gateway mode..."
openclaw config set gateway.mode local
echo "[OK] Gateway mode set to local"

# Step 5: Set agent model to a valid model
echo
echo "Configuring agent model..."
openclaw config set agents.defaults.model "openai/gpt-5.4"
echo "[OK] Agent model set"

# Step 6: Create memory workspace directory
echo
echo "Creating memory directory..."
mkdir -p ~/.openclaw/workspace/memory
echo "[OK] Memory directory ready"

# Step 7: Run doctor --fix
echo
echo "Running doctor --fix..."
openclaw doctor --fix
echo

# Step 8: Verify
echo
echo "============================================"
echo "  Verification"
echo "============================================"
openclaw --version
openclaw health 2>/dev/null || true
echo
echo "Fix complete. Run: openclaw gateway"
