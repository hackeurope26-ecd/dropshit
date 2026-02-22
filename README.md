# Dropshit

![Backend Checks](https://github.com/hackeurope26-ecd/dropshit/actions/workflows/ci.yml/badge.svg?job=backend)
![Extension Lint](https://github.com/hackeurope26-ecd/dropshit/actions/workflows/ci.yml/badge.svg?job=extension)
![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python&logoColor=white)
![Chrome MV3](https://img.shields.io/badge/chrome-mv3-yellow?logo=googlechrome&logoColor=white)
![Flask](https://img.shields.io/badge/flask-3.x-black?logo=flask)
![ChromaDB](https://img.shields.io/badge/chromadb-vector--db-orange)

## API Keys
Make sure to set values for your dotenv file. Run:

```bash
cp .env.example .env
```

And then fill in the blanks with your keys.

## Running the Extension

You must run the proxy and then start the extension.

Install Python and uv. Then,

```bash
uv sync
. .venv/bin/activate
python backend/proxy.py
```

To start the extension, navigate to `chrome://extensions/` in Chrome. Then, toggle 'developer mode', select 'load unpacked', and load `dropshit/extension`.

## Data Flow Diagram

![](.github/assets/system-diagram.png)
