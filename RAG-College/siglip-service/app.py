import os
import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoProcessor, AutoModel
from typing import Optional

app = FastAPI(title="SigLIP2 Service")

# CPU threads control
cpu_cores = os.cpu_count() or 4
torch.set_num_threads(max(1, cpu_cores // 2))

MODEL_ID = "google/siglip2-so400m-patch14-384"
device = "cpu"

print(f"[SigLIP2] Loading model: {MODEL_ID} on {device}...")
processor = AutoProcessor.from_pretrained(MODEL_ID)
model = AutoModel.from_pretrained(MODEL_ID).to(device)
model.eval()

print("=" * 55)
print("SigLIP2 Optimized Service Ready")
print(f"Device: {device} | Active Threads: {torch.get_num_threads()}")
print("=" * 55)


class BatchImageRequest(BaseModel):
    image_paths: list[str]


@app.post("/embed-images-batch")
def embed_images_batch(payload: BatchImageRequest):
    if not payload.image_paths:
        return {"embeddings": []}

    try:
        pil_images = []
        for path in payload.image_paths:
            if not os.path.exists(path):
                raise HTTPException(status_code=400, detail=f"Image not found: {path}")
            with Image.open(path) as img:
                pil_images.append(img.convert("RGB"))

        all_embeddings = []
        SUB_BATCH_SIZE = 3

        with torch.inference_mode():
            for i in range(0, len(pil_images), SUB_BATCH_SIZE):
                sub_group = pil_images[i : i + SUB_BATCH_SIZE]
                inputs = processor(images=sub_group, return_tensors="pt").to(device)
                
                outputs = model.get_image_features(**inputs)

                if torch.is_tensor(outputs):
                    feats = outputs
                elif hasattr(outputs, "pooler_output") and outputs.pooler_output is not None:
                    feats = outputs.pooler_output
                elif hasattr(outputs, "image_embeds") and outputs.image_embeds is not None:
                    feats = outputs.image_embeds
                elif hasattr(outputs, "last_hidden_state"):
                    feats = outputs.last_hidden_state[:, 0, :]
                else:
                    feats = outputs[0]

                norm_feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
                all_embeddings.extend(norm_feats.cpu().numpy().tolist())

        return {"embeddings": all_embeddings}

    except Exception as e:
        print(f"[SigLIP Error] {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class SingleImageRequest(BaseModel):
    image_path: Optional[str] = None
    imagePath: Optional[str] = None

@app.post("/embed/image")
@app.post("/embed-image")
def embed_single_image(payload: SingleImageRequest):
    img_path = payload.image_path or payload.imagePath
    res = embed_images_batch(BatchImageRequest(image_paths=[img_path]))
    return {"embedding": res["embeddings"][0]}


class SingleTextRequest(BaseModel):
    text: str


@app.post("/embed/text")
@app.post("/embed-text")
def embed_text(payload: SingleTextRequest):
    if not payload.text or not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text query is required")

    try:
        with torch.inference_mode():
            inputs = processor(text=[payload.text.strip()], return_tensors="pt", padding="max_length", max_length=64).to(device)
            outputs = model.get_text_features(**inputs)

            if torch.is_tensor(outputs):
                feats = outputs
            elif hasattr(outputs, "pooler_output") and outputs.pooler_output is not None:
                feats = outputs.pooler_output
            elif hasattr(outputs, "text_embeds") and outputs.text_embeds is not None:
                feats = outputs.text_embeds
            else:
                feats = outputs[0]

            norm_feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
            return {"embedding": norm_feats.cpu().numpy()[0].tolist()}

    except Exception as e:
        print(f"[SigLIP Text Error] {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "model": MODEL_ID,
        "device": device,
        "embedding_dimension": 1152
    }