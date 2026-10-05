/**
 * Kimodo to MotionBricks Style Bridge (.mbstyle converter)
 * Reads Kimodo animation clips from assets-src/kimodo/ and generates
 * .mbstyle metadata descriptor files compatible with motion-bricks.cpp planner.
 */

import fs from 'node:fs';
import path from 'node:path';

const SRC = 'assets-src/kimodo';
const OUT = 'generated/styles';

function convertKimodoToMbStyles() {
  if (!fs.existsSync(SRC)) {
    console.log(`[KimodoBridge] Source directory ${SRC} does not exist.`);
    return;
  }

  if (!fs.existsSync(OUT)) {
    fs.mkdirSync(OUT, { recursive: true });
  }

  const entries = fs.readdirSync(SRC, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const clipName = entry.name;
    const clipDir = path.join(SRC, clipName);

    const promptPath = path.join(clipDir, 'prompt.txt');
    const jsonPath = path.join(clipDir, 'kimodo.json');

    let prompt = clipName;
    if (fs.existsSync(promptPath)) {
      prompt = fs.readFileSync(promptPath, 'utf8').trim();
    }

    let frames = 30;
    let fps = 30;
    let duration = 1.0;
    if (fs.existsSync(jsonPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (data.frames) frames = data.frames;
        if (data.fps) fps = data.fps;
        if (data.duration) duration = data.duration;
      } catch (e) {
        // use defaults
      }
    }

    const mbStyle = {
      id: `kimodo_${clipName}`,
      name: clipName,
      prompt: prompt,
      frames: frames,
      fps: fps,
      duration: duration,
      source: 'kimodo',
      target_speed: 1.0,
      loop: true,
    };

    const outPath = path.join(OUT, `${clipName}.mbstyle`);
    fs.writeFileSync(outPath, JSON.stringify(mbStyle, null, 2), 'utf8');
    console.log(`[KimodoBridge] Generated style: ${outPath}`);
    count++;
  }

  console.log(`[KimodoBridge] Successfully converted ${count} Kimodo clips into .mbstyle bundles.`);
}

convertKimodoToMbStyles();
