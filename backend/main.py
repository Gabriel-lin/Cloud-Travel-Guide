# backend/main.py
import sys
from pathlib import Path

# 添加项目根目录到 sys.path
sys.path.append(str(Path(__file__).parent.parent))

from fastapi import FastAPI, Depends
from fastapi.security import OAuth2PasswordRequestForm
from backend.services.auth import login, logout, register, oauth2_scheme
from backend.db.connection import get_db

app = FastAPI()

@app.post("/token")
def login_route(form_data: OAuth2PasswordRequestForm = Depends(), db=Depends(get_db)):
    return login(form_data, db)

@app.post("/logout")
def logout_route(token: str = Depends(oauth2_scheme)):
    return logout(token)

@app.post("/register")
def register_route(username: str, password: str, db=Depends(get_db)):
    return register(username, password, db)
