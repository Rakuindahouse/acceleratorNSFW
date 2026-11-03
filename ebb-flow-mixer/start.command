#!/bin/sh
# ebb flow mixer を起動します（mac / Linux）
cd "$(dirname "$0")"
( sleep 2; open http://localhost:8787/ 2>/dev/null || xdg-open http://localhost:8787/ ) &
python3 -m http.server 8787
