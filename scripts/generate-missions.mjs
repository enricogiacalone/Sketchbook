import http from 'http';
import fs from 'fs';
import path from 'path';

const prompt = `Genera un array JSON valido di esattamente 3 missioni per un gioco 3D in TypeScript.
Il formato di ogni oggetto deve essere esattamente questo (JSON puro, senza markdown block se possibile, o estraibile):
[
  {
    "id": "mission1",
    "title": "Missione 1: Nome",
    "briefing": "Descrizione in italiano...",
    "type": "drive",
    "timeLimit": 90,
    "targetPos": [100, 100],
    "arriveRadius": 20
  },
  {
    "id": "mission2",
    "title": "Missione 2: Nome",
    "briefing": "Descrizione in italiano...",
    "type": "eliminate",
    "timeLimit": 60,
    "targetPos": [200, 200]
  },
  {
    "id": "mission3",
    "title": "Missione 3: Nome",
    "briefing": "Descrizione in italiano...",
    "type": "survive",
    "timeLimit": 30,
    "waveCount": 4
  }
]
I tipi ammessi per "type" sono solo "drive", "eliminate", "survive".
Rispondi SOLO con il JSON valido dell'array, senza altro testo.`;

const data = JSON.stringify({
  model: "qwen2.5-coder:14b",
  prompt: prompt,
  stream: false,
  options: {
    num_predict: 1024,
    temperature: 0.7
  }
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
      let text = json.response || body;
      
      // Clean markdown code blocks if present
      text = text.replace(/```json/g, '').replace(/```ts/g, '').replace(/```/g, '').trim();
      
      // Find JSON array start/end
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1) {
        text = text.substring(firstBracket, lastBracket + 1);
      }

      const newMissions = JSON.parse(text);
      console.log("Parsed missions from Ollama:", newMissions);

      // Read current missionDefinitions.ts
      const defsPath = path.join(process.cwd(), 'src/ts/missions/missionDefinitions.ts');
      let content = fs.readFileSync(defsPath, 'utf8');

      // Format missions as TS code
      const missionsCode = `export const MISSIONS: MissionDef[] = ${JSON.stringify(newMissions, null, 2)};`;

      // Replace old MISSIONS block
      const missionsRegex = /export const MISSIONS: MissionDef\[\] = \[[\s\S]*?\];/;
      if (missionsRegex.test(content)) {
        content = content.replace(missionsRegex, missionsCode);
        fs.writeFileSync(defsPath, content, 'utf8');
        console.log("Successfully updated src/ts/missions/missionDefinitions.ts with Ollama-generated missions!");
      } else {
        console.error("Could not find MISSIONS array in missionDefinitions.ts to replace.");
      }

    } catch (e) {
      console.error("Error parsing Ollama response or updating file:", e);
      console.log("Raw response:", body);
    }
  });
});

req.on('error', (error) => {
  console.error(`Error connecting to Ollama: ${error.message}`);
});

req.write(data);
req.end();
