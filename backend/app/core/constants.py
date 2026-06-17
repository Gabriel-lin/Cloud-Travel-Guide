from enum import StrEnum

OAUTH_AUTHORIZE_URLS = {
    "github": "https://github.com/login/oauth/authorize",
    "google": "https://accounts.google.com/o/oauth2/v2/auth",
}

OAUTH_TOKEN_URLS = {
    "github": "https://github.com/login/oauth/access_token",
    "google": "https://oauth2.googleapis.com/token",
}

OAUTH_USER_URLS = {
    "github": "https://api.github.com/user",
    "google": "https://www.googleapis.com/oauth2/v2/userinfo",
}


class AuthProvider(StrEnum):
    LOCAL = "local"
    GITHUB = "github"
    GOOGLE = "google"
