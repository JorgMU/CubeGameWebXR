# Static server for CubeGameWebXR that never lets the browser (or the
# Cloudflare tunnel in front of it) cache a file.
#
# Plain `py -m http.server` sends no Cache-Control header, so browsers
# cache files by Last-Modified heuristics and the tunnel edge can cache
# them too. That is what made a changed file not show up even after
# Ctrl+F5 or a new tab: the old copy was served from cache, and the
# build-time loader's own Last-Modified check could read the cached
# copy and never see the change.
#
# This server sends `Cache-Control: no-store, no-cache, must-revalidate`
# on every response, so every load goes to disk. It is a dev server
# only — for local testing on this PC and through the trycloudflare
# tunnel, not for publishing.
#
# Usage (run by StartCubeGameWebXR.ps1, or by hand):
#   py CubeGameWebXRServer.py [port] [bind] [directory]
# Defaults: port 8001, bind 127.0.0.1, directory ./app
import http.server
import sys
from functools import partial


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    bind = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    directory = sys.argv[3] if len(sys.argv) > 3 else "app"
    handler = partial(NoCacheHandler, directory=directory)
    with http.server.ThreadingHTTPServer((bind, port), handler) as httpd:
        print(f"Serving {directory} on http://{bind}:{port} (Cache-Control: no-store)")
        httpd.serve_forever()
