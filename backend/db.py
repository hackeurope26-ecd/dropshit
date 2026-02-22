import base64
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import chromadb
import requests
from chromadb import Collection

CHROMA_PATH = "./backend/data/chroma"
SIMILARITY_THRESHOLD = 0.995  # cosine similarity for deduplication
CACHE_THRESHOLD = 0.995       # bar for skipping inference on lookup

CRUSOE_URL = "https://hackeurope.crusoecloud.com/v1/chat/completions"
CRUSOE_MODEL = "NVFP4/Qwen3-235B-A22B-Instruct-2507-FP4"
EMBED_MODEL = "text-embedding-3-small"

_client: Optional[chromadb.ClientAPI] = None # type: ignore
_clusters: Optional[Collection] = None
_sightings: Optional[Collection] = None


def _init() -> tuple[Collection, Collection]:
    global _client, _clusters, _sightings
    if _clusters is not None and _sightings is not None:
        return _clusters, _sightings

    # No embedding_function — we supply embeddings manually so we can use vision descriptions
    _client = chromadb.PersistentClient(path=CHROMA_PATH)
    _clusters = _client.get_or_create_collection(
        name="product_clusters_v2",
        metadata={"hnsw:space": "cosine"},
    )
    _sightings = _client.get_or_create_collection(
        name="product_sightings_v2",
        metadata={"hnsw:space": "cosine"},
    )
    return _clusters, _sightings


def _describe_image(image_url: str) -> str:
    """Download image and ask Qwen vision for a product description suited for similarity search."""
    resp = requests.get(image_url, timeout=10)
    resp.raise_for_status()
    b64 = base64.b64encode(resp.content).decode()
    mime = resp.headers.get("content-type", "image/jpeg").split(";")[0]

    vision_resp = requests.post(
        CRUSOE_URL,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {os.getenv('CRUSOE_KEY')}",
        },
        json={
            "model": CRUSOE_MODEL,
            "messages": [{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "You are a product forensics system. Your output will be converted to a vector embedding "
                            "and used to find visually identical products across different websites. "
                            "Describe every observable visual detail of this product with maximum specificity. "
                            "Cover all of the following — omit nothing that is visible:\n"
                            "- PRODUCT TYPE: exact category and sub-category (e.g. 'stainless steel insulated travel mug with lid', not just 'mug')\n"
                            "- COLOURS: every colour present, exact shade (e.g. 'matte charcoal grey body, brushed silver lid, black rubber base ring'), finish on each surface\n"
                            "- SHAPE & GEOMETRY: silhouette, proportions, aspect ratio, curvature, taper, edges (rounded vs sharp), symmetry\n"
                            "- DIMENSIONS & SCALE: estimated size relative to visible context clues or standard objects\n"
                            "- MATERIALS & TEXTURE: each surface's material and texture (smooth plastic, ribbed rubber grip, woven fabric, etc.)\n"
                            "- TEXT & BRANDING: transcribe every word, number, logo, icon, or label visible on the product exactly as written\n"
                            "- PATTERNS & GRAPHICS: describe any print, embossing, etching, stitching pattern, or decorative element in detail\n"
                            "- HARDWARE & COMPONENTS: buttons, zips, clasps, hinges, ports, seams, stitching colour, attachment points\n"
                            "- UNIQUE IDENTIFIERS: any feature that would appear on this exact SKU and not on a generic version of the same product type\n"
                            "Write in dense, factual prose. No filler words. No opinions. Do not say 'the image shows' — just describe the product directly."
                        ),
                    },
                ],
            }],
            "temperature": 0.1,
            "max_tokens": 600,
        },
        timeout=30,
    )
    vision_resp.raise_for_status()
    return vision_resp.json()["choices"][0]["message"]["content"].strip()


def _embed(text: str) -> list[float]:
    """Embed text with OpenAI text-embedding-3-small."""
    resp = requests.post(
        "https://api.openai.com/v1/embeddings",
        headers={
            "Authorization": f"Bearer {os.getenv('OPENAI_EMBED_KEY')}",
            "Content-Type": "application/json",
        },
        json={"model": EMBED_MODEL, "input": text},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["data"][0]["embedding"]


def _image_embedding(image_url: str, fallback_text: str) -> tuple[list[float], str]:
    """
    Describe image via vision LLM then embed the description.
    Falls back to embedding fallback_text if the image is unreachable.
    Returns (embedding, document_text).
    """
    try:
        description = _describe_image(image_url)
        return _embed(description), description
    except Exception as e:
        print(f"[db] Image embed failed ({e}), falling back to text")
        return _embed(fallback_text), fallback_text


def record_detection(data: dict) -> dict:
    """
    Record a confirmed dropship detection. Finds or creates a product cluster,
    updates running stats, and appends a sighting record.

    Returns { cluster_id, detection_count, is_new_cluster }.
    """
    clusters, sightings = _init()

    title = data.get("product_name") or ""
    tags = data.get("tags") or []
    wholesale_domain = data.get("wholesale_domain") or ""
    wholesale_url = data.get("wholesale_url") or ""
    fallback_text = f"{title} {' '.join(tags)} {wholesale_domain}".strip()

    retail_price = float(data.get("retail_price") or 0)
    wholesale_price = float(data.get("wholesale_price") or 0)
    markup_pct = float(data.get("markup_pct") or 0)
    confidence = float(data.get("synthesis_confidence") or 0)
    retail_domain = data.get("retail_domain") or ""
    now = datetime.now(timezone.utc).isoformat()

    cluster_id = None

    # 1. Exact match on wholesale_url (no embedding needed)
    if wholesale_url:
        existing = clusters.get(where={"wholesale_url": wholesale_url})
        if existing["ids"]:
            cluster_id = existing["ids"][0]

    # 2. Fuzzy match via image embedding similarity
    if not cluster_id and clusters.count() > 0:
        image_url = data.get("wholesale_image_url") or data.get("retail_image_url") or ""
        embedding, embed_doc = _image_embedding(image_url, fallback_text)
        results = clusters.query(
            query_embeddings=[embedding],
            n_results=1,
            include=["distances", "metadatas"],
        )
        if results["ids"][0]:
            distance = results["distances"][0][0] # type: ignore
            if distance <= (1 - SIMILARITY_THRESHOLD):
                cluster_id = results["ids"][0][0]
    else:
        image_url = data.get("wholesale_image_url") or data.get("retail_image_url") or ""
        embedding, embed_doc = _image_embedding(image_url, fallback_text)

    # 3a. Update existing cluster
    if cluster_id:
        existing = clusters.get(ids=[cluster_id])
        meta = existing["metadatas"][0] # type: ignore
        n = int(meta.get("centroid_n", 1))  # type: ignore[arg-type]
        new_n = n + 1
        detection_count = int(meta.get("detection_count", 1)) + 1  # type: ignore[arg-type]

        avg_markup = (meta.get("avg_markup_pct", 0) * n + markup_pct) / new_n  # type: ignore[operator]
        avg_conf = (meta.get("avg_confidence", 0) * n + confidence) / new_n  # type: ignore[operator]

        price_min = min(float(meta.get("wholesale_price_min") or wholesale_price), wholesale_price) if wholesale_price else meta.get("wholesale_price_min", 0)  # type: ignore[arg-type]
        price_max = max(float(meta.get("wholesale_price_max") or wholesale_price), wholesale_price) if wholesale_price else meta.get("wholesale_price_max", 0)  # type: ignore[arg-type]

        retailers = set(filter(None, (meta.get("retailer_domains") or "").split(",")))  # type: ignore[union-attr]
        retailers.add(retail_domain)

        updated_meta = {
            **meta,
            "centroid_n": new_n,
            "detection_count": detection_count,
            "avg_markup_pct": avg_markup,
            "avg_confidence": avg_conf,
            "wholesale_price_min": price_min,
            "wholesale_price_max": price_max,
            "retailer_domains": ",".join(filter(None, retailers)),
            "unique_retailer_count": len(retailers),
            "last_detected_at": now,
        }
        # Promote canonical fields if this detection is more confident
        if confidence > meta.get("avg_confidence", 0):  # type: ignore[operator]
            if title:
                updated_meta["canonical_name"] = title
            if data.get("retail_image_url"):
                updated_meta["canonical_image_url"] = data["retail_image_url"]
            if data.get("wholesale_image_url"):
                updated_meta["wholesale_image_url"] = data["wholesale_image_url"]

        clusters.update(ids=[cluster_id], metadatas=[updated_meta])
        is_new = False

    # 3b. Create new cluster
    else:
        cluster_id = str(uuid.uuid4())
        detection_count = 1
        is_new = True

        clusters.add(
            ids=[cluster_id],
            embeddings=[embedding],
            documents=[embed_doc],
            metadatas=[{
                "canonical_name": title,
                "canonical_image_url": data.get("retail_image_url") or "",
                "wholesale_url": wholesale_url,
                "wholesale_domain": wholesale_domain,
                "wholesale_image_url": data.get("wholesale_image_url") or "",
                "wholesale_price_min": wholesale_price,
                "wholesale_price_max": wholesale_price,
                "detection_count": 1,
                "centroid_n": 1,
                "avg_markup_pct": markup_pct,
                "avg_confidence": confidence,
                "retailer_domains": retail_domain,
                "unique_retailer_count": 1,
                "first_detected_at": now,
                "last_detected_at": now,
            }],
        )

    # 4. Always append a sighting record (use same embedding)
    sightings.add(
        ids=[str(uuid.uuid4())],
        embeddings=[embedding],
        documents=[embed_doc],
        metadatas=[{
            "cluster_id": cluster_id,
            "retail_image_url": data.get("retail_image_url") or "",
            "retail_url": data.get("retail_url") or "",
            "retail_domain": retail_domain,
            "retail_price": retail_price,
            "retail_currency": data.get("retail_currency") or "",
            "wholesale_image_url": data.get("wholesale_image_url") or "",
            "wholesale_url": wholesale_url,
            "wholesale_price": wholesale_price,
            "markup_pct": markup_pct,
            "visual_match_score": float(data.get("visual_match_score") or 0),
            "synthesis_confidence": confidence,
            "evidence": " | ".join(data.get("evidence") or []),
            "detected_at": now,
        }],
    )

    return {
        "cluster_id": cluster_id,
        "detection_count": detection_count,
        "is_new_cluster": is_new,
    }


def lookup_product(title: str, tags: list[str], image_url: str = "") -> dict | None:
    """
    Check whether a product is already in the DB before running inference.
    Describes the image via vision LLM, embeds the description, and searches
    for a cluster above CACHE_THRESHOLD.

    Returns cluster metadata + similarity score, or None if no confident match.
    """
    clusters, _ = _init()

    if clusters.count() == 0:
        return None

    fallback_text = f"{title} {' '.join(tags)}".strip()
    if not fallback_text and not image_url:
        return None

    embedding, _ = _image_embedding(image_url, fallback_text) if image_url else (_embed(fallback_text), fallback_text)

    results = clusters.query(
        query_embeddings=[embedding],
        n_results=1,
        include=["distances", "metadatas"],
    )

    if not results["ids"][0]:
        return None

    distance = results["distances"][0][0] # type: ignore
    similarity = 1 - distance

    if similarity < CACHE_THRESHOLD:
        return None

    return {
        "cluster_id": results["ids"][0][0],
        "similarity": round(similarity, 4),
        **results["metadatas"][0][0], # type: ignore
    }
