from flask import Flask, request, jsonify
from flasgger import Swagger
from dotenv import load_dotenv
import requests
import os
from db import record_detection, lookup_product

load_dotenv()

app = Flask(__name__)
Swagger(app)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


@app.route("/search", methods=["GET", "OPTIONS"])
def search():
    if request.method == "OPTIONS":
        return "", 200
    response = requests.get(
        BRAVE_SEARCH_URL,
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": os.getenv("BRAVE_SEARCH_KEY"),
        },
        params=request.args,  # type: ignore
    )
    return jsonify(response.json())


@app.route("/chat", methods=["POST", "OPTIONS"])
def chat():
    if request.method == "OPTIONS":
        return "", 200
    response = requests.post(
        "https://hackeurope.crusoecloud.com/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {os.getenv('CRUSOE_KEY')}",
        },
        json=request.get_json(),
    )
    return jsonify(response.json())


@app.route("/lens", methods=["POST", "OPTIONS"])
def lens():
    if request.method == "OPTIONS":
        return "", 200
    body = request.get_json()
    image_url = body.get("imageUrl")
    if not image_url:
        return jsonify({"error": "imageUrl is required"}), 400
    response = requests.get(
        "https://serpapi.com/search",
        params={
            "engine": "google_lens",
            "url": image_url,
            "api_key": os.getenv("SERP_API_KEY"),
        },
    )
    return jsonify(response.json())


@app.route("/db/lookup", methods=["POST", "OPTIONS"])
def db_lookup():
    if request.method == "OPTIONS":
        return "", 200
    body = request.get_json()
    result = lookup_product(
        title=body.get("product_name") or "",
        tags=body.get("tags") or [],
        image_url=body.get("image_url") or "",
    )
    return jsonify(result or {})


@app.route("/db/record", methods=["POST", "OPTIONS"])
def db_record():
    if request.method == "OPTIONS":
        return "", 200
    data = request.get_json()
    result = record_detection(data)
    return jsonify(result)


if __name__ == "__main__":
    print("Proxy running on http://localhost:3000")
    app.run(port=3000, debug=True)
