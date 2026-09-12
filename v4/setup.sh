#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
revision=dce236d4e2057422d0791d9a973a58765eb46f65
if [ ! -d lib/periphery ]; then
  git clone https://github.com/Uniswap/v4-periphery.git lib/periphery
fi
git -C lib/periphery checkout --detach "$revision"
git -C lib/periphery submodule update --init --recursive
forge build
