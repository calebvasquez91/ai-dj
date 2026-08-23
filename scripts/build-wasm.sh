#!/usr/bin/env bash
# Rebuilds public/wasm/analysis.{js,wasm} from native/analysis.cpp.
#
# Requires an Emscripten SDK checkout with `emsdk_env.sh` sourced first, e.g.:
#   git clone https://github.com/emscripten-core/emsdk.git
#   ./emsdk/emsdk install latest && ./emsdk/emsdk activate latest
#   source ./emsdk/emsdk_env.sh
#   ./scripts/build-wasm.sh
#
# The compiled output is committed to public/wasm/ — this script is not part
# of `npm run build`, so contributors without Emscripten installed can still
# build and run the app normally; they just can't regenerate the WASM module.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v em++ >/dev/null || {
  echo "error: em++ not found on PATH — source emsdk_env.sh first" >&2
  exit 1
}

mkdir -p public/wasm

em++ native/analysis.cpp -o public/wasm/analysis.js \
  --bind \
  -O3 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createAnalysisModule \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s FILESYSTEM=0 \
  -s NO_EXIT_RUNTIME=1

echo "wrote public/wasm/analysis.js + analysis.wasm"
