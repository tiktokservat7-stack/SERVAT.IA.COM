const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'site')));

// Créer le dossier de données s'il n'existe pas
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    default: 'llama-3.3-70b-versatile'
  },
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    default: 'deepseek-chat'
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    default: 'gpt-4o-mini'
  }
};

let conversations = {};
let convCounter = 0;

// Charger les conversations existantes
function loadConversations() {
  try {
    if (fs.existsSync(DATA_DIR)) {
      const files = fs.readdirSync(DATA_DIR);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '');
          const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
          conversations[id] = data;
          const num = parseInt(id);
          if (num > convCounter) convCounter = num;
        }
      });
    }
    console.log(`✅ ${Object.keys(conversations).length} conversation(s) chargée(s)`);
  } catch (e) {
    console.error('Erreur chargement conversations:', e.message);
  }
}

// Sauvegarder une conversation
function saveConversation(convId, data) {
  try {
    fs.writeFileSync(path.join(DATA_DIR, `${convId}.json`), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Erreur sauvegarde:', e.message);
  }
}

// Charger les conversations au démarrage
loadConversations();

app.post('/api/chat', async (req, res) => {
  const { message, conversationId, apiKey, provider, model } = req.body;

  if (!message || !apiKey) {
    return res.status(400).json({ error: 'Message et clé API requis' });
  }

  const prov = PROVIDERS[provider] || PROVIDERS.groq;
  const selectedModel = model || prov.default;
  const convId = conversationId || (++convCounter).toString();

  if (!conversations[convId]) {
    conversations[convId] = [
      { role: 'system', content: 'Tu es une IA avancée, experte en programmation et création de scripts. Tu peux écrire du code complexe, des scripts longs, analyser, expliquer et créer n\'importe quoi. Réponds toujours de manière complète, détaillée et précise en français.' }
    ];
    saveConversation(convId, conversations[convId]);
  }

  conversations[convId].push({ role: 'user', content: message });
  saveConversation(convId, conversations[convId]);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('convId', { id: convId });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const response = await fetch(prov.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: conversations[convId],
        stream: true,
        max_tokens: prov === PROVIDERS.groq ? 1024 : 32768
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      let errText = '';
      try { errText = await response.text(); } catch (e) { errText = 'Erreur inconnue'; }
      console.error(`${provider} API error ${response.status}: ${errText}`);
      sendEvent('error', { message: `Erreur ${provider} (${response.status}): clé invalide ou solde insuffisant` });
      res.end();
      return;
    }

    if (!response.body) {
      sendEvent('error', { message: 'Réponse vide du serveur' });
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(dataStr);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              fullContent += content;
              sendEvent('chunk', { content });
            }
          } catch (e) {}
        }
      }
    }

    if (fullContent) {
      conversations[convId].push({ role: 'assistant', content: fullContent });
      saveConversation(convId, conversations[convId]);
      sendEvent('done', { content: fullContent });
    } else {
      sendEvent('error', { message: 'Aucun contenu généré' });
    }

  } catch (err) {
    console.error('Erreur:', err.message);
    sendEvent('error', { message: err.name === 'AbortError' ? 'Requête expirée (120s)' : `Erreur: ${err.message}` });
  }

  res.end();
});

app.get('/api/providers', (req, res) => {
  const list = Object.entries(PROVIDERS).map(([key, val]) => ({
    id: key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
    models: val.models,
    default: val.default
  }));
  res.json(list);
});

app.get('/api/conversations', (req, res) => {
  const list = Object.entries(conversations).map(([id, msgs]) => ({
    id,
    title: msgs.find(m => m.role === 'user')?.content?.slice(0, 60) || 'Nouveau',
    count: msgs.filter(m => m.role === 'user').length
  })).reverse();
  res.json(list);
});

app.get('/api/conversation/:id', (req, res) => {
  const conv = conversations[req.params.id];
  if (!conv) return res.status(404).json({ error: 'Introuvable' });
  res.json(conv);
});

app.delete('/api/conversation/:id', (req, res) => {
  delete conversations[req.params.id];
  try {
    fs.unlinkSync(path.join(DATA_DIR, `${req.params.id}.json`));
  } catch (e) {}
  res.json({ ok: true });
});

app.post('/api/new', (req, res) => {
  const id = (++convCounter).toString();
  conversations[id] = [
    { role: 'system', content: 'Tu es une IA avancée, experte en programmation et création de scripts. Tu peux écrire du code complexe, des scripts longs, analyser, expliquer et créer n\'importe quoi. Réponds toujours de manière complète, détaillée et précise en français.' }
  ];
  saveConversation(id, conversations[id]);
  res.json({ id });
});

if (!fs.existsSync(path.join(__dirname, 'site'))) {
  fs.mkdirSync(path.join(__dirname, 'site'));
}

app.listen(PORT, () => {
  console.log(`\u{1F680} Serveur: http://localhost:${PORT}`);
  console.log(`\u{1F50D} Ouvre http://localhost:${PORT} dans ton navigateur`);
});
