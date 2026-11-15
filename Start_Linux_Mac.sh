#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
if [ ! -f .venv/READY_V3.txt ]; then
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt
  echo Ready > .venv/READY_V3.txt
fi
.venv/bin/python -m transcriber.api
