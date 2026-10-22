# SigLIP2 Python Microservice

Stand-alone multimodal embedding microservice for College RAG Image / Diagram Retrieval using **Google SigLIP2** (`google/siglip2-so400m-patch14-384`).

## Features
- **Local Files Only**: Loads directly from the local machine cache without downloading new models.
- **Model**: `google/siglip2-so400m-patch14-384`
- **Embedding Dimension**: 1152 (dynamically detected)
- **Framework**: FastAPI + Uvicorn
- **Supported Endpoints**:
  - `GET /health`: Health status, device, model path, and embedding dimension.
  - `POST /embed/text`: Generates 1152-dim L2-normalized text embedding.
  - `POST /embed/image`: Generates 1152-dim L2-normalized image embedding from multipart upload, JSON path, or base64.

## Setup & Running

### 1. Requirements
Ensure Python 3.10+ is installed with PyTorch and Transformers:
```bash
cd siglip-service
pip install -r requirements.txt
```

### 2. Start the Service
```bash
python -m uvicorn app:app --host 127.0.0.1 --port 5001
```

### 3. Verification
```bash
curl http://127.0.0.1:5001/health
```
Expected output:
```json
{
  "status": "healthy",
  "model": "google/siglip2-so400m-patch14-384",
  "device": "cpu",
  "embedding_dimension": 1152
}
```
