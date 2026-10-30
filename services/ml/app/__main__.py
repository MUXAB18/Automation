import os

import uvicorn

from .main import create_app

if __name__ == "__main__":
    # Local only by default; put it behind the private network (or a reverse proxy) to expose it.
    uvicorn.run(create_app(), host=os.environ.get("ML_HOST", "127.0.0.1"), port=int(os.environ.get("ML_PORT", "8001")))
