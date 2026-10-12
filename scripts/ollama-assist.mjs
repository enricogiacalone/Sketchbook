import http from 'http';

const prompt = process.argv.slice(2).join(' ');
if (!prompt) {
  console.error("Usage: node scripts/ollama-assist.mjs '<prompt>'");
  process.exit(1);
}

const data = JSON.stringify({
  model: "qwen2.5-coder:14b",
  prompt: prompt,
  stream: false
});

const req = http.request({
  hostname: 'localhost',
  port: 11434,
  path: '/api/generate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(body);
      console.log(json.response || body);
    } catch (e) {
      console.log(body);
    }
  });
});

req.on('error', (error) => {
  console.error(`Error connecting to Ollama: ${error.message}`);
});

req.write(data);
req.end();
