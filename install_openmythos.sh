#!/usr/bin/env bash
set -euo pipefail

# Clone + install kyegomez/OpenMythos — a theoretical reconstruction
# of the rumored "Claude Mythos" Recurrent-Depth Transformer.
# Repo: https://github.com/kyegomez/OpenMythos

REPO_URL="https://github.com/kyegomez/OpenMythos.git"
TARGET_DIR="${TARGET_DIR:-external/OpenMythos}"

mkdir -p "$(dirname "$TARGET_DIR")"

if [ -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

pip install --user 'torch>=2.1.0'
pip install --user -e "$TARGET_DIR"

python3 - <<'PY'
import torch
from open_mythos.main import OpenMythos, MythosConfig

cfg = MythosConfig(
    vocab_size=1000, dim=256, n_heads=8, n_kv_heads=2, max_seq_len=128,
    max_loop_iters=4, prelude_layers=1, coda_layers=1,
    n_experts=8, n_shared_experts=1, n_experts_per_tok=2,
    expert_dim=64, lora_rank=8, attn_type="mla",
)
model = OpenMythos(cfg)
ids = torch.randint(0, cfg.vocab_size, (2, 16))
logits = model(ids, n_loops=4)
print("OK | logits:", tuple(logits.shape), "| params:", sum(p.numel() for p in model.parameters()))
PY
