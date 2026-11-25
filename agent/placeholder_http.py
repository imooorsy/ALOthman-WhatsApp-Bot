"""Private-service boundary only. Replace with the AI engineer's agent runtime."""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        expected = os.environ.get("AGENT_API_KEY", "")
        provided = self.headers.get("x-agent-api-key", "")
        code = 503 if self.path == "/respond" and expected and hmac.compare_digest(expected, provided) else 403
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Real agent has not been installed" if code == 503 else "Forbidden"}).encode())

    def log_message(self, *_args):
        pass  # Never log request bodies, tokens or client details.

ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
