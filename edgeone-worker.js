/**
 * FreeGen-2API for EdgeOne Pages
 * 适配 EdgeOne Pages Worker 的单文件版本
 * 
 * EdgeOne Pages Worker 使用标准 fetch 事件处理
 * 部署方式：通过 EdgeOne Pages 控制台上传此文件作为 Worker
 */

// ---[第一部分: 核心配置] ---
const CONFIG = {
  PROJECT_NAME: "freegen-2api",
  PROJECT_VERSION: "1.0.2",
  API_MASTER_KEY: "1",
  
  SIGNER_URL: "https://prompt-signer.freegen.app/",
  GENERATOR_URL: "https://image-generator.freegen.app/",
  WS_URL: "wss://websocket-bridge.freegen.app/ws",
  STATS_URL: "https://stats.freegen.app/record-completion",

  HEADERS: {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "origin": "https://freegen.app",
    "referer": "https://freegen.app/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site"
  },

  MODELS: [
    "freegen-txt2img",
    "freegen-img2img",
    "gpt-4o",
    "dall-e-3"
  ],
  DEFAULT_MODEL: "freegen-txt2img",
};

// ---[第二部分: EdgeOne Pages Worker 入口] ---
export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  
  const apiKey = env.EDGEONE_API_KEY || CONFIG.API_MASTER_KEY;
  request.ctx = { apiKey, waitUntil };

  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return handleCorsPreflight();
  if (url.pathname === '/') return handleUI(request);
  if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
  if (url.pathname.startsWith('/v1/')) return handleApi(request, { waitUntil });

  return createErrorResponse(`路径未找到: ${url.pathname}`, 404, 'not_found');
}

// ---[第三部分: 核心业务逻辑] ---

async function waitForImageViaWebSocket(jobId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = jobId + timestamp;
  
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const auth = btoa(hashHex).substring(0, 20) + ':' + timestamp;

  const ws = new WebSocket(CONFIG.WS_URL);

  return new Promise((resolve, reject) => {
    let timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket 轮询超时 (120秒)"));
    }, 120000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', job_id: jobId, auth }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'result') {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.image_data);
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(msg.message || "上游生成失败"));
        }
      } catch (e) {
        console.error("WebSocket 解析错误:", e);
      }
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket 连接错误"));
    });
  });
}

async function generateImage(prompt, ratio_id = "1:1", image_data = null, ctx) {
  const startTime = Date.now();

  const signerRes = await fetch(CONFIG.SIGNER_URL, {
    method: "POST",
    headers: CONFIG.HEADERS,
    body: JSON.stringify({ prompt })
  });

  if (!signerRes.ok) {
    throw new Error(`Signer 签名失败: ${signerRes.status}`);
  }
  const { ts, sig } = await signerRes.json();

  const genPayload = { prompt, ts, sig, ratio_id };
  if (image_data) genPayload.image_data = image_data;

  const genRes = await fetch(CONFIG.GENERATOR_URL, {
    method: "POST",
    headers: CONFIG.HEADERS,
    body: JSON.stringify(genPayload)
  });

  if (!genRes.ok) {
    throw new Error(`Generator 提交失败: ${genRes.status}`);
  }
  const genData = await genRes.json();

  let finalImageUrl = null;

  if (genData.image_data_url) {
    finalImageUrl = genData.image_data_url;
  } else if (genData.job_id) {
    finalImageUrl = await waitForImageViaWebSocket(genData.job_id);
    
    if (ctx?.waitUntil) {
      ctx.waitUntil(
        fetch(CONFIG.STATS_URL, {
          method: "POST",
          headers: CONFIG.HEADERS,
          body: JSON.stringify({
            job_id: genData.job_id,
            total_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          })
        }).catch(err => console.error("Stats 记录失败:", err))
      );
    }
  } else {
    throw new Error("上游返回了未知的响应格式");
  }

  return finalImageUrl;
}

// ---[第四部分: API 接口处理] ---

async function handleApi(request, ctx) {
  if (!verifyAuth(request)) return createErrorResponse('Unauthorized', 401, 'unauthorized');

  const url = new URL(request.url);
  const requestId = `req-${crypto.randomUUID()}`;

  if (url.pathname === '/v1/models') {
    return new Response(JSON.stringify({
      object: 'list',
      data: CONFIG.MODELS.map(id => ({ id, object: 'model', created: Date.now(), owned_by: 'freegen' }))
    }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
  }

  if (url.pathname === '/v1/chat/completions') {
    return handleChatCompletions(request, requestId, ctx);
  }
  
  if (url.pathname === '/v1/images/generations') {
    return handleImageGenerations(request, requestId, ctx);
  }

  return createErrorResponse('Not Found', 404, 'not_found');
}

async function handleChatCompletions(request, requestId, ctx) {
  try {
    const body = await request.json();
    const messages = body.messages || [];
    
    let prompt = "";
    let image_data = null;
    let ratio_id = "1:1";

    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) prompt += part.text + "\n";
          else if (part.type === 'image_url') {
            image_data = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url || null;
          }
        }
      } else if (typeof msg.content === 'string') {
        prompt += msg.content + "\n";
      }
    }

    prompt = prompt.trim();

    try {
      if (prompt.startsWith('{') && prompt.endsWith('}')) {
        const parsed = JSON.parse(prompt);
        if (parsed.prompt) prompt = parsed.prompt;
        if (parsed.ratio_id) ratio_id = parsed.ratio_id;
        if (parsed.image_data) image_data = parsed.image_data;
      }
    } catch(e) {}

    if (!prompt && !image_data) throw new Error("Prompt 或图片不能为空");

    if (body.stream) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      
      if (ctx?.waitUntil) {
        ctx.waitUntil((async () => {
          try {
            await writer.write(encoder.encode(`data: ${JSON.stringify(createChatChunk(requestId, body.model, "🎨 正在连接 FreeGen 引擎..."))}\n\n`));
            const imageUrl = await generateImage(prompt, ratio_id, image_data, ctx);
            const content = `![Generated Image](${imageUrl})\n\n*Prompt: ${prompt}*`;
            await writer.write(encoder.encode(`data: ${JSON.stringify(createChatChunk(requestId, body.model, content))}\n\n`));
            await writer.write(encoder.encode(`data: ${JSON.stringify(createChatChunk(requestId, body.model, "", "stop"))}\n\n`));
            await writer.write(encoder.encode('data:[DONE]\n\n'));
          } catch (e) {
            await writer.write(encoder.encode(`data: ${JSON.stringify(createChatChunk(requestId, body.model, `❌ 生成失败: ${e.message}`, "stop"))}\n\n`));
          } finally {
            await writer.close();
          }
        })());
      }

      return new Response(readable, { headers: corsHeaders({ 'Content-Type': 'text/event-stream' }) });
    }

    const imageUrl = await generateImage(prompt, ratio_id, image_data, ctx);
    const content = `![Generated Image](${imageUrl})\n\n*Prompt: ${prompt}*`;

    return new Response(JSON.stringify({
      id: requestId, object: 'chat.completion', created: Math.floor(Date.now()/1000),
      model: body.model || CONFIG.DEFAULT_MODEL, 
      choices:[{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
    }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });

  } catch (e) {
    return createErrorResponse(e.message, 500, 'internal_error');
  }
}

async function handleImageGenerations(request, requestId, ctx) {
  try {
    const body = await request.json();
    const prompt = body.prompt;
    const size = body.size || "1024x1024";
    
    let ratio_id = "1:1";
    if (size === "1024x1792") ratio_id = "9:16";
    else if (size === "1792x1024") ratio_id = "16:9";
    else if (size === "768x1024") ratio_id = "3:4";
    else if (size === "1024x768") ratio_id = "4:3";

    const imageUrl = await generateImage(prompt, ratio_id, null, ctx);
    
    return new Response(JSON.stringify({
      created: Math.floor(Date.now()/1000),
      data:[{ url: imageUrl, revised_prompt: prompt }]
    }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
  } catch (e) {
    return createErrorResponse(e.message, 500, 'internal_error');
  }
}

// --- 辅助函数 ---

function verifyAuth(request) {
  const auth = request.headers.get('Authorization');
  const key = request.ctx?.apiKey || CONFIG.API_MASTER_KEY;
  if (key === "1") return true;
  return auth === `Bearer ${key}`;
}

function createChatChunk(id, model, content, finishReason = null) {
  return {
    id, object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || CONFIG.DEFAULT_MODEL,
    choices:[{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }]
  };
}

function createErrorResponse(msg, status, code) {
  return new Response(JSON.stringify({ error: { message: msg, type: 'api_error', code } }), {
    status, headers: corsHeaders({ 'Content-Type': 'application/json' })
  });
}

function corsHeaders(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function handleCorsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ---[第五部分: WebUI] ---
// UI 代码与 cfwork.js 相同，完整代码请从 cfwork.js 复制 handleUI 函数