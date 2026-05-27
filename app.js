const VISION_MODELS = ['llama-3.2-11b-vision-preview', 'gpt-4o', 'gpt-4o-mini'];

const API_KEY = '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';

const state = {
  convId: null,
  streaming: false,
  messages: [],
  config: { apiKey: API_KEY, provider: 'groq', model: '' },
  providers: [],
  userId: '',
  ttsEnabled: true,
  speaking: false,
  voiceSent: false,
  pseudo: 'Utilisateur'
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const el = {
  sidebar: $('#sidebar'),
  convList: $('#convList'),
  menuBtn: $('#menuBtn'),
  newChatBtn: $('#newChatBtn'),
  settingsBtn: $('#settingsBtn'),
  headerTitle: $('#headerTitle'),
  headerStatus: $('#headerStatus'),
  onlineBadge: $('#onlineBadge'),
  welcome: $('#welcome'),
  messages: $('#messages'),
  msgArea: $('#messagesArea'),
  input: $('#input'),
  sendBtn: $('#sendBtn'),
  micBtn: $('#micBtn'),
  clearBtn: $('#clearChatBtn'),
  modal: $('#settingsModal'),
  modalClose: $('#settingsClose'),
  settingsCancel: $('#settingsCancel'),
  settingsSave: $('#settingsSave'),
  providerSelect: $('#providerSelect'),
  modelSelect: $('#modelSelect'),
  toast: $('#toast'),
  profileName: $('#profileName'),
  profileAvatar: $('#profileAvatar'),
  profileEdit: $('#profileEdit'),
  plusBtn: $('#plusBtn'),
  plusMenu: $('#plusMenu'),
  imgInput: $('#imgInput'),
  imgPreview: $('#imgPreview'),
  imgPreviewContent: $('#imgPreviewContent'),
  imgRemove: $('#imgRemove')
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'fr-FR';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    el.input.value = final || interim;
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + 'px';
    el.sendBtn.disabled = !el.input.value.trim() || state.streaming;
    if (final) {
      el.micBtn.classList.remove('recording');
      state.voiceSent = true;
      send();
    }
  };

  recognition.onerror = () => {
    el.micBtn.classList.remove('recording');
    toast('Erreur de reconnaissance vocale', true);
  };

  recognition.onend = () => {
    el.micBtn.classList.remove('recording');
    if (el.input.value.trim() && !state.streaming) {
      state.voiceSent = true;
      send();
    }
  };
}

el.micBtn.addEventListener('click', () => {
  if (!recognition) { toast('Reconnaissance vocale non supportée', true); return; }
  if (el.micBtn.classList.contains('recording')) {
    recognition.stop();
    el.micBtn.classList.remove('recording');
  } else {
    recognition.start();
    el.micBtn.classList.add('recording');
    toast('Parlez...');
  }
});

el.input.addEventListener('input', () => {
  el.sendBtn.disabled = !el.input.value.trim() || state.streaming;
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 200) + 'px';
});

el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

el.input.addEventListener('paste', async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      if (!(await checkImage(file))) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        pendingImage = ev.target.result;
        el.imgPreviewContent.src = pendingImage;
        el.imgPreview.style.display = 'flex';
        el.plusBtn.classList.add('has-image');
        toast('Image collée ✓');
      };
      reader.readAsDataURL(file);
      break;
    }
  }
});

el.sendBtn.addEventListener('click', send);
el.newChatBtn.addEventListener('click', newChat);
el.menuBtn.addEventListener('click', () => el.sidebar.classList.toggle('open'));
el.clearBtn.addEventListener('click', () => { el.messages.innerHTML = ''; el.welcome.style.display = 'flex'; });
el.ttsBtn = $('#ttsToggle');
el.ttsBtn.addEventListener('click', () => {
  state.ttsEnabled = !state.ttsEnabled;
  el.ttsBtn.classList.toggle('active', state.ttsEnabled);
  toast(state.ttsEnabled ? 'Lecture vocale activée' : 'Lecture vocale désactivée');
  if (!state.ttsEnabled) stopSpeak();
});

el.settingsBtn.addEventListener('click', () => openSettings());
el.modalClose.addEventListener('click', closeSettings);
el.settingsCancel.addEventListener('click', closeSettings);
el.settingsSave.addEventListener('click', saveSettings);
el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeSettings(); });

function loadProfile() {
  const name = localStorage.getItem('aistudio_pseudo') || 'Utilisateur';
  state.pseudo = name;
  el.profileName.textContent = name;
  el.profileAvatar.textContent = name.charAt(0).toUpperCase();
}

function saveProfile(name) {
  name = name.trim() || 'Utilisateur';
  localStorage.setItem('aistudio_pseudo', name);
  state.pseudo = name;
  el.profileName.textContent = name;
  el.profileAvatar.textContent = name.charAt(0).toUpperCase();
}

function editProfile() {
  const current = state.pseudo || 'Utilisateur';
  const name = prompt('Entrez votre pseudo :', current);
  if (name !== null) saveProfile(name);
}

el.profileName.addEventListener('click', editProfile);
el.profileEdit.addEventListener('click', editProfile);

let pendingImage = null;

el.plusBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.plusMenu.classList.toggle('open');
});
document.addEventListener('click', () => el.plusMenu.classList.remove('open'));
el.plusMenu.addEventListener('click', (e) => e.stopPropagation());

document.getElementById('attachImageBtn').addEventListener('click', () => {
  el.imgInput.accept = 'image/*';
  el.imgInput.click();
  el.plusMenu.classList.remove('open');
});
document.getElementById('attachFileBtn').addEventListener('click', () => {
  el.imgInput.accept = '*/*';
  el.imgInput.click();
  el.plusMenu.classList.remove('open');
});

function checkImage(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowed.includes(file.type)) { toast('Format non supporté (JPEG, PNG, GIF, WebP seulement)', true); return false; }
  if (file.size > 10 * 1024 * 1024) { toast('Image trop volumineuse (max 10MB)', true); return false; }
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.width <= 4096 && img.height <= 4096); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Image invalide ou corrompue', true); resolve(false); };
    img.src = url;
  });
}

el.imgInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!(await checkImage(file))) { el.imgInput.value = ''; return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    pendingImage = ev.target.result;
    el.imgPreviewContent.src = pendingImage;
    el.imgPreview.style.display = 'flex';
    el.plusBtn.classList.add('has-image');
  };
  reader.readAsDataURL(file);
});
el.imgRemove.addEventListener('click', () => {
  pendingImage = null;
  el.imgPreview.style.display = 'none';
  el.imgPreviewContent.src = '';
  el.imgInput.value = '';
  el.plusBtn.classList.remove('has-image');
});

$$('.qa-card').forEach(c => c.addEventListener('click', () => {
  el.input.value = c.dataset.prompt;
  el.sendBtn.disabled = false;
  send();
}));

function speak(text) {
  if (!window.speechSynthesis || !state.ttsEnabled) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/```[\s\S]*?```/g, '').replace(/[#*`\[\]()>|~_-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = 'fr-FR';
  utter.rate = 1.1;
  utter.pitch = 1;
  state.speaking = true;
  utter.onend = () => { state.speaking = false; };
  utter.onerror = () => { state.speaking = false; };
  window.speechSynthesis.speak(utter);
}

function stopSpeak() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  state.speaking = false;
}

el.headerStatus.addEventListener('click', () => {
  if (state.speaking) stopSpeak();
});

function toast(msg, err = false) {
  el.toast.textContent = msg;
  el.toast.className = 'toast' + (err ? ' error' : '') + ' show';
  setTimeout(() => el.toast.classList.remove('show'), 3000);
}

async function loadConfig() {
  try {
    // Configuration par défaut - Groq avec modèle léger
    const defaultConfig = {
      apiKey: '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',
      provider: 'groq',
      model: 'llama-3.3-70b-versatile'
    };
    
    // Toujours utiliser la configuration par défaut
    state.config = defaultConfig;
    
    // Sauvegarder la config
    localStorage.setItem('aistudio_config', JSON.stringify(state.config));

    const res = await fetch('/api/providers');
    state.providers = await res.json();

    el.providerSelect.innerHTML = state.providers.map(p =>
      `<option value="${p.id}"${p.id === state.config.provider ? ' selected' : ''}>${p.name}</option>`
    ).join('');

    updateModels();
  } catch (e) { toast('Erreur chargement config', true); }
}

function updateModels() {
  const prov = state.providers.find(p => p.id === el.providerSelect.value) || state.providers[0];
  if (!prov) return;
  el.modelSelect.innerHTML = prov.models.map(m =>
    `<option value="${m}"${(state.config.model || prov.default) === m ? ' selected' : ''}>${m}</option>`
  ).join('');
}

el.providerSelect.addEventListener('change', updateModels);

function saveSettings() {
  state.config.provider = el.providerSelect.value;
  state.config.model = el.modelSelect.value;
  localStorage.setItem('aistudio_config', JSON.stringify(state.config));
  closeSettings();
  toast('Configuration sauvegardée');
  updateStatus();
}

function openSettings() {
  el.providerSelect.value = state.config.provider || 'groq';
  updateModels();
  el.modelSelect.value = state.config.model || '';
  el.modal.classList.add('open');
}

function closeSettings() {
  el.modal.classList.remove('open');
}

function updateStatus() {
  const hasKey = !!state.config.apiKey;
  el.headerStatus.textContent = hasKey ? 'Prêt' : 'Clé API manquante';
  el.headerStatus.className = 'header-status' + (hasKey ? ' online' : '');
}

async function updateOnline() {
  try {
    const res = await fetch('/api/online');
    const data = await res.json();
    el.onlineBadge.textContent = 'Joueur connecté ' + data.count;
  } catch (e) {}
}

setInterval(updateOnline, 30000);
updateOnline();

async function send() {
  const text = el.input.value.trim();
  if (!text || state.streaming) return;
  const wasVoice = state.voiceSent;
  state.voiceSent = false;
  if (!state.config.apiKey) {
    toast('Configurez votre clé API d\'abord', true);
    openSettings();
    return;
  }

  el.welcome.style.display = 'none';
  addMsg(text, 'user', false, pendingImage);
  el.input.value = '';
  el.sendBtn.disabled = true;
  el.input.style.height = 'auto';

  state.streaming = true;
  el.headerStatus.textContent = 'En cours...';
  el.headerStatus.className = 'header-status busy';

  const msgDiv = addMsg('', 'assist', true);
  const contentDiv = msgDiv.querySelector('.msg-content');
  const typing = addTyping();

const imgType = pendingImage ? pendingImage.split(';')[0].split(':')[1] : null;
const imgB64 = pendingImage ? pendingImage.split(',')[1] : null;
if (pendingImage) {
  const curProv = state.providers.find(p => p.id === state.config.provider);
  const curModel = state.config.model || curProv?.default || '';

  if (!VISION_MODELS.includes(curModel) && curProv) {
    const vm = curProv.models.find(m => VISION_MODELS.includes(m));
    if (vm) { state.config.model = vm; updateModelOptions(); }
    toast('Modèle changé pour ' + state.config.model + ' (vision nécessaire)', false);
  }
  el.imgRemove.click(); el.plusMenu.classList.remove('open');
}

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        conversationId: state.convId,
        apiKey: state.config.apiKey,
        provider: state.config.provider,
        model: state.config.model || undefined,
        userId: state.userId,
        image: imgB64,
        imageType: imgType
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erreur serveur' }));
      throw new Error(err.error || 'Erreur serveur');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';

      for (const part of parts) {
        const evt = part.match(/^event: (.+)$/m);
        const dat = part.match(/^data: (.+)$/m);
        if (!evt || !dat) continue;

        const data = JSON.parse(dat[1]);
        switch (evt[1]) {
          case 'convId':
            state.convId = data.id;
            break;
          case 'chunk':
            full += data.content;
            contentDiv.innerHTML = renderMD(full);
            highlight();
            scrollBottom();
            break;
          case 'done':
            contentDiv.innerHTML = renderMD(full);
            highlight();
            state.messages.push({ role: 'assistant', content: full });
            autoDownloadLargeCode(full);
            if (wasVoice && state.ttsEnabled) speak(full);
            break;
          case 'status':
            toast(data.message, false);
            break;
          case 'error':
            toast(data.message, true);
            contentDiv.innerHTML = `<p style="color:var(--danger)">${data.message}</p>`;
            break;
        }
      }
    }
  } catch (err) {
    contentDiv.innerHTML = `<p style="color:var(--danger)">Erreur: ${err.message}</p>`;
    toast('Erreur de connexion', true);
  }

  typing.remove();
  state.streaming = false;
  updateStatus();
  loadConvs();
}

function addMsg(content, role, streaming = false, imgData = null) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;

  if (role === 'assist') {
    div.innerHTML = `
      <div class="msg-hdr">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        SERVAT IA
        <button class="speak-btn" title="Lire à voix haute" onclick="speakMsg(this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        </button>
      </div>
      <div class="msg-content"></div>`;
    if (content) div.querySelector('.msg-content').innerHTML = renderMD(content);
  } else {
    let extra = '';
    if (imgData) extra = `<div class="msg-img"><img src="${imgData}" alt="Image jointe"></div>`;
    div.innerHTML = `<div class="msg-content">${extra}${esc(content)}</div>`;
  }

  el.messages.appendChild(div);
  scrollBottom();
  return div;
}

function addTyping() {
  const d = document.createElement('div');
  d.className = 'typing';
  d.innerHTML = '<span></span><span></span><span></span>';
  el.messages.appendChild(d);
  scrollBottom();
  return d;
}

function scrollBottom() {
  requestAnimationFrame(() => { el.msgArea.scrollTop = el.msgArea.scrollHeight; });
}

async function newChat() {
  if (state.streaming) return;
  try {
    const res = await fetch('/api/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: state.userId }) });
    const d = await res.json();
    state.convId = d.id;
    state.messages = [];
    el.messages.innerHTML = '';
    el.welcome.style.display = 'flex';
    el.headerTitle.textContent = 'SERVAT IA';
    if (window.innerWidth <= 768) el.sidebar.classList.remove('open');
    await loadConvs();
  } catch (e) { toast('Erreur création chat', true); }
}

async function loadConvs() {
  try {
    const res = await fetch(`/api/conversations?userId=${state.userId}`);
    const list = await res.json();
    el.convList.innerHTML = list.map(c => `
      <div class="conv-item${c.id === state.convId ? ' active' : ''}" data-id="${c.id}">
        <span class="conv-title">${esc(c.title)}</span>
        <button class="conv-del" data-id="${c.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    `).join('');

    el.convList.querySelectorAll('.conv-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.conv-del')) return;
        loadConv(el.dataset.id);
      });
    });
    el.convList.querySelectorAll('.conv-del').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        await delConv(b.dataset.id);
      });
    });
  } catch (e) {}
}

async function loadConv(id) {
  if (state.streaming) return;
  try {
    const res = await fetch(`/api/conversation/${id}?userId=${state.userId}`);
    const conv = await res.json();
    state.convId = id;
    state.messages = conv.filter(m => m.role !== 'system');
    el.messages.innerHTML = '';
    el.welcome.style.display = 'none';
    conv.forEach(m => { if (m.role !== 'system') addMsg(m.content, m.role); });
    highlight();
    const title = conv.find(m => m.role === 'user')?.content?.slice(0, 50) || 'Conversation';
    el.headerTitle.textContent = title;
    document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
    const active = document.querySelector(`.conv-item[data-id="${id}"]`);
    if (active) active.classList.add('active');
    if (window.innerWidth <= 768) el.sidebar.classList.remove('open');
    scrollBottom();
  } catch (e) { toast('Erreur chargement', true); }
}

async function delConv(id) {
  try {
    await fetch(`/api/conversation/${id}?userId=${state.userId}`, { method: 'DELETE' });
    if (state.convId === id) await newChat();
    else await loadConvs();
  } catch (e) { toast('Erreur suppression', true); }
}

function renderMD(text) {
  let h = text;
  h = h.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => {
    const c = code.replace(/\n$/, '');
    const l = lang || 'code';
    return `<div class="code-hdr"><span>${esc(l)}</span><div class="code-actions"><button class="copy-btn" onclick="copyC(this)">Copier</button><button class="download-btn" onclick="downloadC(this)">Télécharger</button></div></div><pre><code class="language-${l}">${esc(c)}</code></pre>`;
  });
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/~~(.+?)~~/g, '<del>$1</del>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  h = h.replace(/^---$/gm, '<hr>');
  h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  h = h.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(?:<li>.*<\/li>\n?)+/g, (m) => { if (!m.startsWith('<ul>')) return `<ol>${m}</ol>`; return m; });
  h = h.replace(/\n\n/g, '</p><p>');
  h = '<p>' + h + '</p>';
  h = h.replace(/<\/(ul|ol|li|h[1-3]|blockquote|hr|pre|table|div|h[1-3])><p>/g, (m) => m.replace('<p>', '>'));
  h = h.replace(/<\/p><(ul|ol|li|h[1-3]|blockquote|hr|\/pre|pre|table|\/div|div|h[1-3])>/g, (m) => m.replace('</p>', ''));
  h = h.replace(/<p><\/p>/g, '');
  return h;
}

function speakMsg(btn) {
  const msgDiv = btn.closest('.msg');
  const text = msgDiv?.querySelector('.msg-content')?.textContent;
  if (text) speak(text);
}

function esc(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

function highlight() {
  if (typeof hljs !== 'undefined')
    document.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
}

function copyC(btn) {
  const pre = btn.closest('.code-hdr')?.nextElementSibling;
  const code = pre?.querySelector('code')?.textContent;
  if (code) {
    navigator.clipboard.writeText(code).then(() => {
      btn.textContent = 'Copié !';
      btn.classList.add('done');
      setTimeout(() => { btn.textContent = 'Copier'; btn.classList.remove('done'); }, 2000);
    });
  }
}

function downloadC(btn) {
  const pre = btn.closest('.code-hdr')?.nextElementSibling;
  const lang = btn.closest('.code-hdr')?.querySelector('span')?.textContent || 'code';
  const code = pre?.querySelector('code')?.textContent;
  if (code) downloadFile(code, lang);
}

function downloadFile(code, lang = 'code') {
  const extMap = {
    js: 'js', javascript: 'js', py: 'py', python: 'py', sh: 'sh', bash: 'sh', txt: 'txt', json: 'json', html: 'html', css: 'css', java: 'java', php: 'php', cpp: 'cpp', c: 'c', cs: 'cs', rb: 'rb', go: 'go'
  };
  const ext = extMap[lang.toLowerCase()] || 'txt';
  const filename = `script.${ext}`;
  const blob = new Blob([code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function autoDownloadLargeCode(text) {
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const lang = match[1] || 'code';
    const code = match[2].replace(/\n$/, '');
    const lines = code.split(/\r?\n/).length;
    if (lines > 100) {
      downloadFile(code, lang);
      break;
    }
  }
}

async function init() {
  if (window.location.protocol === 'file:') {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;text-align:center;padding:2rem;background:#0f0f13;color:#e0e0e0">
        <div>
          <h1 style="color:#e74c3c;font-size:2.5rem;margin-bottom:0.5rem">Serveur requis</h1>
          <p style="font-size:1.2rem;max-width:500px;margin:1rem auto;line-height:1.6">
            Vous devez lancer le serveur Node.js pour utiliser cette application.
          </p>
          <div style="background:#1a1a24;padding:1.5rem;border-radius:12px;display:inline-block;text-align:left;font-family:'JetBrains Mono',monospace;font-size:1rem;margin:1rem 0">
            <div style="color:#888"># Dans le dossier du projet :</div>
            <div style="color:#4ec9b0">npm install</div>
            <div style="color:#4ec9b0">node server.js</div>
          </div>
          <p style="font-size:1.1rem">
            Puis ouvrez <strong style="color:#4ec9b0">http://localhost:3000</strong>
          </p>
        </div>
      </div>`;
    return;
  }
  let uid = localStorage.getItem('aistudio_userId');
  if (!uid) {
    uid = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('aistudio_userId', uid);
  }
  state.userId = uid;
  el.ttsBtn.classList.add('active');
  loadProfile();
  await loadConfig();
  await newChat();
  updateStatus();
  toast('✅ Groq API configuré et prêt !');
}

init();
