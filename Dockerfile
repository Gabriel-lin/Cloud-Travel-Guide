# 第一阶段：安装依赖
FROM rust:latest as builder

RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs
RUN npm install -g @tauri-apps/cli

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

# 第二阶段：构建应用
FROM builder as build

COPY . .
RUN npm run tauri:build

# 第三阶段：输出结果
FROM alpine:latest as output

COPY --from=build /app/src-tauri/target/release/bundle /bundle
