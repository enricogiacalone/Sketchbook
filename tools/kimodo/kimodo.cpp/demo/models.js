// Extend the compact canvas viewer with model selection and a prompt sequence.
window.addEventListener('load', async () => {
  const prompt = document.querySelector('#prompt');
  const form = prompt?.closest('.promptbox');
  const generate = document.querySelector('#generate');
  if (!prompt || !form || !generate) return;
  const models = await fetch('/api/models').then(r => r.json());
  window.kimodoModels = models;

  const modelLabel = document.createElement('label');
  modelLabel.htmlFor = 'motionModel'; modelLabel.textContent = 'Motion model';
  const select = document.createElement('select');
  select.id = 'motionModel'; select.style.cssText = 'width:100%;padding:10px;border-radius:10px;background:#0b1015;color:#f3f6f4;border:1px solid #25313b';
  for (const model of models) {
    const option = document.createElement('option'); option.value = model.id;
    option.disabled = !model.available;
    option.textContent = `${model.label}${model.available ? '' : ' — coming soon'}`;
    select.append(option);
  }
  const modelHint = document.createElement('div'); modelHint.className = 'hint';
  const updateModel = () => {
    const model = models.find(item => item.id === select.value);
    if (!model) return;
    const title = document.querySelector('.eyebrow');
    if (title) title.textContent = `${model.label} · Vulkan`;
    modelHint.classList.toggle('license-warning', !model.commercial);
    const terms = model.commercial ? 'commercial use permitted under NVIDIA Open Model License' : '⚠ non-commercial research use only';
    const detail = model.available ? `${model.skeleton} · ${model.upstream} · ` : `${model.skeleton} · ${model.reason} · `;
    const link = document.createElement('a'); link.href = model.license_url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = terms;
    modelHint.replaceChildren(document.createTextNode(detail), link);
  };
  select.onchange = updateModel;
  form.insertBefore(modelLabel, prompt); form.insertBefore(select, prompt); form.insertBefore(modelHint, prompt); updateModel();

  const sequence = document.createElement('div');
  sequence.style.cssText = 'display:grid;gap:10px;width:100%';
  prompt.before(sequence);
  prompt.classList.add('sequence-prompt');
  const autoGrow = area => {
    area.style.height = '0px';
    const minimum = Number.parseFloat(getComputedStyle(area).minHeight) || 0;
    area.style.height = `${Math.max(minimum, area.scrollHeight)}px`;
  };
  prompt.style.minHeight = '110px';
  prompt.addEventListener('input', () => autoGrow(prompt));
  const minFrames = 60, maxFrames = 150;
  const segmentControls = new Map();
  const validFrames = value => Number.isInteger(value) && value >= minFrames && value <= maxFrames;
  const clampFrames = value => validFrames(Number(value)) ? Number(value) : Math.max(minFrames, Math.min(maxFrames, Number(value) || 150));
  const configureDuration = (duration, frames) => {
    duration.type = 'number'; duration.min = String(minFrames); duration.max = String(maxFrames); duration.step = '1'; duration.value = String(clampFrames(frames));
    duration.title = `Frames (${minFrames}–${maxFrames})`;
    duration.addEventListener('change', () => { duration.value = String(clampFrames(duration.value)); duration.setCustomValidity(''); });
    duration.addEventListener('invalid', () => duration.setCustomValidity(`Use a whole number from ${minFrames} to ${maxFrames} frames.`));
  };
  const primaryRow = document.createElement('div');
  primaryRow.style.cssText = 'display:grid;grid-template-columns:1fr 74px;gap:7px;align-items:start';
  const primaryDuration = document.createElement('input');
  configureDuration(primaryDuration, 150);
  primaryRow.append(prompt, primaryDuration); sequence.append(primaryRow);
  segmentControls.set(primaryRow, primaryDuration);
  autoGrow(prompt);
  const count = document.createElement('div'); count.className = 'hint';
  const updateCount = () => {
    const prompts = sequence.querySelectorAll('.sequence-prompt');
    count.textContent = `${prompts.length} segment${prompts.length === 1 ? '' : 's'} · 5-frame conditioned hand-off`;
  };
  const addSegment = (text = '', frames = 150) => {
    const row = document.createElement('div'); row.style.cssText = 'display:grid;grid-template-columns:1fr 74px auto;gap:7px;align-items:start';
    const textArea = document.createElement('textarea'); textArea.className = 'sequence-prompt'; textArea.value = text;
    textArea.placeholder = 'Describe the next motion'; textArea.style.minHeight = '110px';
    textArea.style.resize = 'none'; textArea.style.overflow = 'hidden'; textArea.addEventListener('input', () => autoGrow(textArea));
    const duration = document.createElement('input'); configureDuration(duration, frames);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove segment'; remove.style.cssText = 'padding:8px 12px;background:#24313a;color:#dce9e8';
    remove.onclick = () => { row.remove(); updateCount(); };
    row.append(textArea, duration, remove); sequence.append(row); segmentControls.set(row, duration);
    autoGrow(textArea);
    updateCount();
  };
  const add = document.createElement('button'); add.type = 'button'; add.textContent = '+ Add prompt segment';
  add.style.cssText = 'justify-self:start;padding:8px 12px;background:#24313a;color:#dce9e8';
  add.onclick = () => addSegment(); form.insertBefore(add, generate); form.insertBefore(count, generate); updateCount();

  // The gallery owns the selected animation; receive its full saved sequence
  // rather than restoring only animation.prompt (the first segment).
  window.addEventListener('kimodo:restore-sequence', event => {
    const {segments, model} = event.detail || {};
    if (model && [...select.options].some(option => option.value === model)) {
      select.value = model;
      updateModel();
    }
    const restored = Array.isArray(segments) && segments.length
      ? segments
      : [{prompt: prompt.value, frames: 150}];
    const first = restored[0];
    prompt.value = first.prompt || '';
    autoGrow(prompt);
    primaryDuration.value = String(clampFrames(first.frames));
    for (const row of [...sequence.children]) {
      if (row !== primaryRow) row.remove();
    }
    for (const segment of restored.slice(1)) {
      addSegment(segment.prompt || '', clampFrames(segment.frames));
    }
    updateCount();
  });

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.endsWith('/api/generate') && init?.body) {
      const body = JSON.parse(init.body);
      body.model = select.value;
      body.transition_frames = 5;
      body.segments = [...sequence.querySelectorAll('.sequence-prompt')].map(area => {
        const row = area.closest('div');
        const duration = segmentControls.get(row);
        const frames = Number(duration?.value);
        if (!validFrames(frames)) throw new Error(`Each segment must be a whole number from ${minFrames} to ${maxFrames} frames.`);
        return {prompt: area.value, frames};
      });
      return nativeFetch(input, {...init, body: JSON.stringify(body)});
    }
    return nativeFetch(input, init);
  };
  window.dispatchEvent(new Event('kimodo:sequence-controls-ready'));
});
