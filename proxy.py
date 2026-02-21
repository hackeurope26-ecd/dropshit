from flask import Flask, request, jsonify
from dotenv import load_dotenv
import requests
import os

load_dotenv()

app = Flask(__name__)

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = '*'
    return response

@app.route('/chat', methods=['POST', 'OPTIONS'])
def chat():
    if request.method == 'OPTIONS':
        return '', 200

    response = requests.post(
        'https://hackeurope.crusoecloud.com/v1/chat/completions',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {os.getenv("CRUSOE_KEY")}'
        },
        json=request.get_json()
    )

    return jsonify(response.json())

if __name__ == '__main__':
    app.run(port=3000)
    print('Proxy running on http://localhost:3000')