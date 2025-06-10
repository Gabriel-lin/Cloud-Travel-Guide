# Dockerfile
FROM python:3.12-slim as backend
WORKDIR /app/backend
COPY backend/pyproject.toml .
RUN pip install uv && uv pip install -r pyproject.toml
COPY backend .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.12-slim as algorithms
WORKDIR /app/algorithms
COPY algorithms/pyproject.toml .
RUN pip install uv && uv pip install -r pyproject.toml
COPY algorithms .
CMD ["python", "shortest_path.py"]

FROM node:22 as frontend
WORKDIR /app/frontend
COPY frontend/package.json .
RUN npm install
COPY frontend .
CMD ["npm", "start"]
