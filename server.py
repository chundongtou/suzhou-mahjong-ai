# -*- coding: utf-8 -*-
"""苏州麻将AI军师 - 本地服务端(静态服务 + Ollama 转发)
本地模式: 双击 start.bat 启动本服务, 浏览器自动打开
Pages模式: GitHub Pages 直开时前端直连 127.0.0.1:11434 (本服务可不启动)
"""
import os
import json
import socket
import threading
import urllib.request
import webbrowser

from flask import Flask, jsonify, request, send_from_directory

APP_DIR = os.path.dirname(os.path.abspath(__file__))
OLLAMA_BASE = "http://127.0.0.1:11434"
TIMEOUT = 600

app = Flask(__name__, static_folder=os.path.join(APP_DIR, "static"), static_url_path="")


def ollama_post(path, payload, timeout=None, method="POST"):
    """Ollama REST API, ProxyHandler({}) 绕过系统代理(Clash等)"""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        OLLAMA_BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    resp = opener.open(req, timeout=timeout or TIMEOUT)
    return json.loads(resp.read())


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/health")
def health():
    try:
        tags = ollama_post("/api/tags", None, timeout=8, method="GET")
        models = [m["name"] for m in tags.get("models", [])]
        return jsonify({"ok": True, "models": models})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/generate", methods=["POST"])
def generate():
    """转发给 Ollama: {model, prompt, images?}"""
    data = request.get_json(force=True)
    payload = {
        "model": data.get("model", "qwen2.5vl:7b"),
        "prompt": data.get("prompt", ""),
        "stream": False,
        "options": data.get("options", {"temperature": 0.2}),
    }
    if data.get("images"):
        payload["images"] = data["images"]
    try:
        result = ollama_post("/api/generate", payload, timeout=TIMEOUT)
        return jsonify({"ok": True, "text": result.get("response", "")})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="苏州麻将AI军师")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    url = "http://127.0.0.1:%d" % args.port
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print("=" * 52)
    print("  苏州麻将AI军师 已启动!")
    print("  本机访问: %s" % url)
    print("  局域网访问: http://%s:%d" % (get_lan_ip(), args.port))
    print("  按 Ctrl+C 退出")
    print("=" * 52)
    app.run(host="0.0.0.0", port=args.port, threaded=True, debug=False)
