# WORKSPACE
workspace(name = "cloud_travel_guide")

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

# 加载 Bazel 规则
http_archive(
    name = "rules_python",
    sha256 = "a30abdfc7126d497a7698c29c46ea9901c6392d6ed315171a6df5ce433aa4502",
    strip_prefix = "rules_python-0.23.1",
    url = "https://github.com/bazelbuild/rules_python/releases/download/0.23.1/rules_python-0.23.1.tar.gz",
)

load("@rules_python//python:repositories.bzl", "python_register_toolchains")

# 注册 Python 工具链
python_register_toolchains(
    name = "python3",
    python_version = "3.12",
)

# 加载 Node.js 规则
http_archive(
    name = "rules_nodejs",
    sha256 = "f3a5e6b4c3e8c8a4b2c3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3",
    strip_prefix = "rules_nodejs-5.8.0",
    url = "https://github.com/bazelbuild/rules_nodejs/releases/download/5.8.0/rules_nodejs-5.8.0.tar.gz",
)

load("@rules_nodejs//nodejs:repositories.bzl", "nodejs_register_toolchains")

# 注册 Node.js 工具链
nodejs_register_toolchains(
    name = "nodejs",
    node_version = "22",
)
