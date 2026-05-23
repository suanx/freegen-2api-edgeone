# FreeGen-2API for EdgeOne

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status](https://img.shields.io/badge/Status-Stable_v1.0.2-success.svg)]()

> 将 FreeGen.app 的 AI 绘图接口转换为 OpenAI 标准 API 格式，部署于 EdgeOne Pages。

## 项目简介

**FreeGen-2API** 是一个边缘计算 Worker，核心功能：
- 将 FreeGen.app 非标准接口转换为 OpenAI 兼容 API
- 支持文生图、图生图、SSE 流式输出
- 内置 WebUI 调试界面（暗黑玻璃拟物化风格）

### 支持模型
| 模型 ID | 功能 |
|---------|------|
| `freegen-txt2img` | 文生图 |
| `freegen-img2img` | 图生图 |
| `gpt-4o` | 兼容映射 |
| `dall-e-3` | 兼容映射 |

---

## 🚀 EdgeOne Pages 部署

### 第一步：创建项目

1. 登录 [EdgeOne 控制台](https://edgeone.ai/)
2. 创建 **Pages 项目**
3. 选择 **Worker 模式**

### 第二步：上传代码

上传 `edgeone-worker.js` 到 Worker 配置，绑定路径 `/*`。

### 第三步：配置环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `EDGEONE_API_KEY` | API 访问密钥 | `sk-your-secret-key` |

> ⚠️ 默认密钥为 `1`，生产环境必须修改！

### 第四步：验证部署

- **WebUI**: `https://<域名>.edgeone.app/`
- **API**: `https://<域名>.edgeone.app/v1/chat/completions`

---

## 🔧 API 使用示例

### 文生图 (非流式)

```bash
curl -X POST "https://<域名>.edgeone.app/v1/chat/completions" \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "freegen-txt2img",
    "messages": [{"role": "user", "content": "一只可爱的猫咪在草地上"}],
    "stream": false
  }'
```

### 图生图 (流式)

```bash
curl -X POST "https://<域名>.edgeone.app/v1/chat/completions" \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "freegen-img2img",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "把这张图片变成动漫风格"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
      ]
    }],
    "stream": true
  }'
```

### DALL-E 兼容接口

```bash
curl -X POST "https://<域名>.edgeone.app/v1/images/generations" \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset over mountains",
    "size": "1024x1024"
  }'
```

---

## 📂 文件结构

```
freegen-2api-edgeone/
├── edgeone-worker.js   # EdgeOne Worker 代码
├── README.md           # 本文件
├── LICENSE             # Apache 2.0
└── website/            # FreeGen.app 前端 HTML（可选）
    └── index.html
```

## 🌐 前端 WebUI

`website/index.html` 是 FreeGen.app 官方前端页面，可单独部署到静态托管服务：

- **EdgeOne Pages 静态托管**: 直接上传 `website/` 目录
- **CDN 加速**: 配合 EdgeOne CDN 实现全球加速

前端与 Worker 配合使用：
- 前端访问 `/v1/chat/completions` 调用 Worker API
- 需配置 API Key 环境变量

---

## ⚠️ 注意事项

1. **WebSocket 支持**: EdgeOne Pages 需确认 WebSocket 支持
2. **上游依赖**: 依赖 FreeGen.app 服务稳定性
3. **频率限制**: 注意 EdgeOne 免费额度
4. **CORS**: 已配置允许跨域

---

## 🔗 兼容性

| 特性 | EdgeOne Pages |
|------|---------------|
| fetch API | ✅ |
| WebSocket | ⚠️ 需确认 |
| crypto.subtle | ✅ |
| waitUntil | ✅ |
| 环境变量 | ✅ |

---

## 📜 开源协议

本项目采用 **Apache License 2.0** 协议开源。

---

*由 FreeGen-2API 社区维护 @ 2026*