import http from 'http';
import fs from 'fs';
import path from 'path';

const prompt = `Genera un array JSON con 5 oggetti 3D per una città:
[
  {"name": "Monolite", "x": 10, "z": 20, "shape": "box", "color": "#38bdf8", "scale": [3, 10, 3]},
  {"name": "Globo", "x": -30, "z": 40, "shape": "sphere", "color": "#ff3333", "scale": [4, 4, 4]},
  {"name": "Torre", "x": 50, "z": -50, "shape": "cylinder", "color": "#ffd54a", "scale": [2, 15, 2]},
  {"name": "Anello", "x": -40, "z": -30, "shape": "torus", "color": "#00ff66", "scale": [5, 2, 5]},
  {"name": "Obelisco", "x": 0, "z": 70, "shape": "box", "color": "#a855f7", "scale": [2, 12, 2]}
]
Rispondi SOLO con il JSON valido, senza altro testo.`;

const data = JSON.stringify({
  model: "qwen2.5-coder:14b",
  prompt: prompt,
  stream: false,
  options: {
    num_predict: 512,
    temperature: 0.5
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
      if (json.error) {
        console.error("Ollama Error:", json.error);
        return;
      }
      let text = json.response || body;
      text = text.replace(/```json/g, '').replace(/```ts/g, '').replace(/```/g, '').trim();
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1) {
        text = text.substring(firstBracket, lastBracket + 1);
      }
      const props = JSON.parse(text);
      console.log("Parsed props from Ollama:", props);

      const compCode = `import React from 'react';
import { getTerrainHeight } from './Terrain';
import { getRoadOffset } from './Road';

export interface OllamaProp {
  name: string;
  x: number;
  z: number;
  shape: 'box' | 'cylinder' | 'sphere' | 'torus';
  color: string;
  scale: [number, number, number];
}

export const OLLAMA_PROPS: OllamaProp[] = ${JSON.stringify(props, null, 2)};

export const OllamaProps: React.FC = () => {
  return (
    <group name="ollama-props">
      {OLLAMA_PROPS.map((p, i) => {
        const y = getTerrainHeight(p.x, p.z) + getRoadOffset(p.x, p.z) + (p.shape === 'sphere' ? p.scale[1] / 2 : p.scale[1] / 2);
        return (
          <group key={i} position={[p.x, y, p.z]}>
            <mesh castShadow receiveShadow>
              {p.shape === 'box' && <boxGeometry args={p.scale} />}
              {p.shape === 'cylinder' && <cylinderGeometry args={[p.scale[0]/2, p.scale[0]/2, p.scale[1], 16]} />}
              {p.shape === 'sphere' && <sphereGeometry args={[p.scale[0]/2, 16, 16]} />}
              {p.shape === 'torus' && <torusGeometry args={[p.scale[0]/2, p.scale[0]/6, 16, 32]} />}
              <meshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={0.5} roughness={0.2} metalness={0.8} />
            </mesh>
            <pointLight color={p.color} intensity={2} distance={15} />
          </group>
        );
      })}
    </group>
  );
};

export default OllamaProps;
`;

      const outPath = path.join(process.cwd(), 'src/ts/components/Environment/OllamaProps.tsx');
      fs.writeFileSync(outPath, compCode, 'utf8');
      console.log("Successfully generated src/ts/components/Environment/OllamaProps.tsx!");

    } catch (e) {
      console.error("Error generating props:", e);
      console.log("Raw response:", body);
    }
  });
});

req.on('error', (error) => {
  console.error(`Error connecting to Ollama: ${error.message}`);
});

req.write(data);
req.end();
