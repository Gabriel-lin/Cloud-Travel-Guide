# frontend/BUILD
load("@rules_nodejs//nodejs:defs.bzl", "nodejs_binary")

nodejs_binary(
    name = "frontend",
    entry_point = "//frontend:index.js",
    data = [
        "//frontend:src",
    ],
)
