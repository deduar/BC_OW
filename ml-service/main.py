from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import numpy as np
from sentence_transformers import SentenceTransformer
import joblib
import os
from pathlib import Path

app = FastAPI(title="Bank Reconciliation ML Service")

# Load model
MODEL_CACHE_DIR = os.getenv("MODEL_CACHE_DIR", "./models")
model_path = Path(MODEL_CACHE_DIR) / "sentence-transformer-model"

try:
    if model_path.exists():
        model = SentenceTransformer(str(model_path))
    else:
        model = SentenceTransformer('all-MiniLM-L6-v2')
        model.save(str(model_path))
except Exception as e:
    print(f"Error loading model: {e}")
    model = SentenceTransformer('all-MiniLM-L6-v2')

class EmbeddingRequest(BaseModel):
    texts: List[str]

class EmbeddingResponse(BaseModel):
    embeddings: List[List[float]]

class SimilarityRequest(BaseModel):
    embedding1: List[float]
    embedding2: List[float]

class SimilarityResponse(BaseModel):
    similarity: float

class RetrainRequest(BaseModel):
    positive_pairs: List[List[str]]  # Pairs of similar texts
    negative_pairs: List[List[str]]  # Pairs of dissimilar texts

@app.post("/embeddings", response_model=EmbeddingResponse)
async def generate_embeddings(request: EmbeddingRequest):
    """Generate embeddings for a list of texts"""
    try:
        embeddings = model.encode(request.texts, convert_to_numpy=True)
        return EmbeddingResponse(embeddings=embeddings.tolist())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding generation failed: {str(e)}")

@app.post("/similarity", response_model=SimilarityResponse)
async def calculate_similarity(request: SimilarityRequest):
    """Calculate cosine similarity between two embeddings"""
    try:
        emb1 = np.array(request.embedding1)
        emb2 = np.array(request.embedding2)

        # Cosine similarity
        dot_product = np.dot(emb1, emb2)
        norm1 = np.linalg.norm(emb1)
        norm2 = np.linalg.norm(emb2)

        if norm1 == 0 or norm2 == 0:
            similarity = 0.0
        else:
            similarity = dot_product / (norm1 * norm2)

        return SimilarityResponse(similarity=float(similarity))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Similarity calculation failed: {str(e)}")

@app.post("/batch_similarity")
async def calculate_batch_similarity(request: EmbeddingRequest):
    """Calculate similarity matrix for multiple texts"""
    try:
        embeddings = model.encode(request.texts, convert_to_numpy=True)
        # Calculate pairwise similarities
        norms = np.linalg.norm(embeddings, axis=1)
        normalized_embeddings = embeddings / norms[:, np.newaxis]

        similarity_matrix = np.dot(normalized_embeddings, normalized_embeddings.T)

        return {
            "similarity_matrix": similarity_matrix.tolist(),
            "texts": request.texts
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch similarity failed: {str(e)}")

@app.post("/retrain")
async def retrain_model(request: RetrainRequest):
    """Retrain model with feedback data (placeholder for future implementation)"""
    try:
        # This is a placeholder - full retraining would require more complex implementation
        # For now, just acknowledge the request
        return {
            "status": "acknowledged",
            "message": "Model retraining scheduled",
            "positive_pairs_count": len(request.positive_pairs),
            "negative_pairs_count": len(request.negative_pairs)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Retraining failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "model_loaded": model is not None}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)