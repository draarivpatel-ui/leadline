#!/bin/sh
# Rebuilds every reference fixture. Needs a Python venv with pyEDFlib, MNE, scipy and numpy:
#   python3 -m venv .scratch/venv && .scratch/venv/bin/pip install -r scripts/golden/requirements.txt
set -eu
cd "$(dirname "$0")/../.."
PY="${PYTHON:-.scratch/venv/bin/python}"
"$PY" scripts/golden/make_synthetic.py test-data/synthetic
"$PY" scripts/golden/make_golden.py test-data test-data/golden.json
if [ -f scripts/golden/make_dsp.py ]; then "$PY" scripts/golden/make_dsp.py test-data test-data/golden-dsp.json; fi
