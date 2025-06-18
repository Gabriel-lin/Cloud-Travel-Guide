# Cloud Travel Guide

## target

* Customized travel features \
    1. Travel route recommendation, planning, and dynamic adjustment
    2. Support text, pictures, voice, and video forms

* World model, tts model, virsion model(moe model), language model \
    1. Use forge as the world model and DeepSeek-R1 as the inference language model
    2. Deployment Reasoning Optimization-vllm
    3. Fine tuning-RL

* map genetator agent, plan agent \
    1. forge model + map tool
    2. rag + cot + workflow + rl-online

## plan - v0.1.0

* Support text interaction, personalization and internationalization.
* Forge model, deepseek-1b, qwen32b deployment and vllm optimization
* Map interactive assistant tool, rag


##  Technology stack

### front end
    * react, tailwindcss, cesiumjs, threejs, zustand, shadcn, vite
    * docker

### backend end
    * fastapi, uv, devcontainer, microservices
    * docker


#### misc

wsl2
配置 VcXsrv
    启动 VcXsrv。
    在配置向导中，选择 "Multiple windows" 和 "Start no client"。
    在 "Extra settings" 中，勾选 "Disable access control"。
    完成配置并启动 X Server。

<!-- 192.168.18.220 -->
export DISPLAY=192.168.1.100:0
