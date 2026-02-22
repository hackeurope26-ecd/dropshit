from flask import Flask, request, jsonify
from flasgger import Swagger
from dotenv import load_dotenv
import requests
import os

load_dotenv()

app = Flask(__name__)
Swagger(app)

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = '*'
    return response

BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'

@app.route('/search', methods=['GET', 'OPTIONS'])
def search():
    """
    Proxy web search requests to the Brave Search API.
    ---
    parameters:
      - name: q
        in: query
        required: true
        type: string
        description: Search query string.
      - name: count
        in: query
        required: false
        type: integer
        description: Number of results to return.
      - name: offset
        in: query
        required: false
        type: integer
        description: Offset for pagination.
    responses:
      200:
        description: JSON response from the Brave Search API.
    """
    if request.method == 'OPTIONS':
        return '', 200

    response = requests.get(
        BRAVE_SEARCH_URL,
        headers={
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': os.getenv('BRAVE_SEARCH_KEY'),
        },
        params=request.args # type: ignore
    )

    return jsonify(response.json())

@app.route('/chat', methods=['POST', 'OPTIONS'])
def chat():
    """
    Proxy chat completion requests to the Crusoe Cloud LLM API (OpenAI-compatible).
    ---
    consumes:
      - application/json
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required:
            - model
            - messages
          properties:
            model:
              type: string
              description: Name of the model to use.
            messages:
              type: array
              description: Conversation history.
              items:
                type: object
                required:
                  - role
                  - content
                properties:
                  role:
                    type: string
                    enum: [system, user, assistant]
                  content:
                    type: string
            temperature:
              type: number
              description: Sampling temperature (0–2).
            max_tokens:
              type: integer
              description: Maximum tokens to generate.
    responses:
      200:
        description: JSON response from the Crusoe chat completions API.
    """
    if request.method == 'OPTIONS':
        return '', 200

    body = request.get_json()
    response = requests.post(
        'https://hackeurope.crusoecloud.com/v1/chat/completions',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {os.getenv("CRUSOE_KEY")}'
        },
        json=body
    )

    data = response.json()
    print('[chat] response:', data)
    return jsonify(data)

if __name__ == '__main__':
    app.run(port=3000)
    print('Proxy running on http://localhost:3000')