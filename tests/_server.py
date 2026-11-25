"""Shared helpers for the browser tests: a quiet local server and a tiny check/report utility."""
import functools
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    """Serves the web app from the repository root on a random local port. Returns (server, url)."""
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_port}/"


class Checks:
    """Collects pass/fail lines and the exit code."""

    def __init__(self):
        self.failures = []

    def __call__(self, name, condition):
        print(("ok     " if condition else "FAILED ") + name)
        if not condition:
            self.failures.append(name)

    @property
    def exit_code(self):
        return 1 if self.failures else 0
