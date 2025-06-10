# backend/services/auth.py
from fastapi import HTTPException, status, Depends
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from ..db.connection import get_db
from ..models.user import User
from ..utils.security import verify_password, get_password_hash
import psycopg2

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# 使用内存中的集合来存储黑名单
token_blacklist = set()

def get_user(db, username: str) -> User:
    cursor = db.cursor()
    cursor.execute("SELECT * FROM users WHERE username = %s", (username,))
    user = cursor.fetchone()
    if user:
        return User(**user)
    return None

def authenticate_user(db, username: str, password: str) -> User:
    user = get_user(db, username)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    return user

def login(form_data: OAuth2PasswordRequestForm = Depends(), db=Depends(get_db)):
    user = authenticate_user(db, form_data.username, form_data.password)
    return {"access_token": user.username, "token_type": "bearer"}

def logout(token: str):
    if is_token_blacklisted(token):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token already invalidated",
        )
    
    # 将令牌加入黑名单
    add_token_to_blacklist(token)
    
    return {"message": "Successfully logged out"}

def register(username: str, password: str, db=Depends(get_db)):
    # 检查用户名是否已存在
    if get_user(db, username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists",
        )

    # 哈希密码
    password_hash = get_password_hash(password)

    # 插入新用户
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO users (username, password_hash) VALUES (%s, %s)",
        (username, password_hash),
    )
    db.commit()
    return {"message": "User registered successfully"}

def add_token_to_blacklist(token: str):
    token_blacklist.add(token)

def is_token_blacklisted(token: str) -> bool:
    return token in token_blacklist

def get_current_user(token: str = Depends(oauth2_scheme)):
    if is_token_blacklisted(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been invalidated",
        )
    # 其他认证逻辑...
