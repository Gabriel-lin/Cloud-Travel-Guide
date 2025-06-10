# backend/BUILD
load("@rules_python//python:defs.bzl", "py_library", "py_binary")

py_library(
    name = "db",
    srcs = ["db/connection.py"],
    deps = ["//backend:psycopg2"],
)

py_library(
    name = "models",
    srcs = ["models/user.py"],
    deps = ["//backend:pydantic"],
)

py_library(
    name = "utils",
    srcs = ["utils/security.py"],
    deps = ["//backend:passlib"],
)

py_library(
    name = "services",
    srcs = ["services/auth.py"],
    deps = [
        ":db",
        ":models",
        ":utils",
        "//backend:fastapi",
    ],
)

py_binary(
    name = "backend",
    srcs = ["main.py"],
    deps = [
        ":services",
    ],
)
