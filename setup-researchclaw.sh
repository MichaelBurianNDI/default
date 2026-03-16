#!/usr/bin/env bash
# Setup script for AutoResearchClaw
# Usage: bash setup-researchclaw.sh

set -euo pipefail

REPO_DIR="AutoResearchClaw"

echo "=== AutoResearchClaw Setup ==="

# Check Python version
python3 -c "import sys; assert sys.version_info >= (3, 11), f'Python 3.11+ required, got {sys.version}'" 2>/dev/null || {
    echo "ERROR: Python 3.11+ is required"
    exit 1
}

# Create virtual environment if it doesn't exist
if [ ! -d "$REPO_DIR/.venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$REPO_DIR/.venv"
fi

# Install the package
echo "Installing researchclaw..."
source "$REPO_DIR/.venv/bin/activate"
pip install -e "$REPO_DIR" --quiet
pip install matplotlib --quiet

# Copy example config if no config exists
if [ ! -f "config.arc.yaml" ]; then
    cp "$REPO_DIR/config.researchclaw.example.yaml" config.arc.yaml
    echo "Created config.arc.yaml from example template"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Set your LLM API key:  export OPENAI_API_KEY='your-key-here'"
echo "  2. Edit config.arc.yaml to set your research topic and LLM provider"
echo "  3. Activate the venv:      source $REPO_DIR/.venv/bin/activate"
echo "  4. Run the pipeline:       researchclaw run --config config.arc.yaml --topic 'Your topic' --auto-approve"
echo ""
echo "Other useful commands:"
echo "  researchclaw validate --config config.arc.yaml   # Validate config"
echo "  researchclaw doctor --config config.arc.yaml     # Check environment health"
echo "  researchclaw report                              # Generate run report"
