# backend/db/connection.py
import os
import psycopg2
from psycopg2.extras import RealDictCursor

def get_db():
    # 从环境变量中获取 DATABASE_URL
    database_url = os.getenv("DATABASE_URL", "postgresql://user:password@postgres:5432/cloud_travel_guide")
    
    conn = psycopg2.connect(
        database_url,
        cursor_factory=RealDictCursor,
    )
    try:
        yield conn
    finally:
        conn.close()
