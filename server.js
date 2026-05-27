const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'site')));

// Créer le dossier de données s'il n'existe pas
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const VISION_MODELS = ['llama-3.2-11b-vision-preview', 'gpt-4o', 'gpt-4o-mini'];

const SYSTEM_PROMPT = 'Tu es SERVAT IA, une intelligence artificielle de niveau expert créée par SERVAT HUB, comparable aux meilleures IA comme Claude. Tu es capable de raisonnement profond, d\'analyse critique et de résolution de problèmes complexes. Tu réponds toujours de manière claire, structurée et naturelle en français. Tu excelles dans tous les domaines : programmation, mathématiques, sciences, philosophie, écriture, analyse de données, et bien plus. Tu ne proposes du code ou des scripts que lorsque l\'utilisateur te le demande explicitement. Pour les conversations normales, réponds de façon chaleureuse et naturelle. Quand on te demande du code, écris-le toujours en entier, complet, fonctionnel et optimisé, sans jamais utiliser d\'abréviations ni de "// reste du code". Tu prends le temps de réfléchir avant de répondre et tu fournis des réponses pertinentes et approfondies.';

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'llama-3.2-11b-vision-preview'],
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
let convCounters = {};
const userActivity = {};

function userDir(userId) {
  return path.join(DATA_DIR, userId);
}

// Charger les conversations par utilisateur
function loadConversations() {
  try {
    if (fs.existsSync(DATA_DIR)) {
      const users = fs.readdirSync(DATA_DIR);
      users.forEach(userId => {
        const userPath = path.join(DATA_DIR, userId);
        if (fs.statSync(userPath).isDirectory()) {
          conversations[userId] = {};
          let maxId = 0;
          const files = fs.readdirSync(userPath);
          files.forEach(file => {
            if (file.endsWith('.json')) {
              const id = file.replace('.json', '');
              const data = JSON.parse(fs.readFileSync(path.join(userPath, file), 'utf-8'));
              conversations[userId][id] = data;
              const num = parseInt(id);
              if (num > maxId) maxId = num;
            }
          });
          convCounters[userId] = maxId;
        }
      });
    }
    const total = Object.values(conversations).reduce((sum, u) => sum + Object.keys(u).length, 0);
    console.log(`✅ ${Object.keys(conversations).length} utilisateur(s), ${total} conversation(s)`);
  } catch (e) {
    console.error('Erreur chargement conversations:', e.message);
  }
}

function getOrCreateUser(userId) {
  if (!conversations[userId]) {
    conversations[userId] = {};
    convCounters[userId] = 0;
  }
  return conversations[userId];
}

// Sauvegarder une conversation
function saveConversation(userId, convId, data) {
  try {
    const dir = userDir(userId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${convId}.json`), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Erreur sauvegarde:', e.message);
  }
}

// Charger les conversations au démarrage
loadConversations();

app.post('/api/chat', async (req, res) => {
  const { message, conversationId, apiKey, provider, model, userId, image, imageType } = req.body;

  if (!message || !apiKey) {
    return res.status(400).json({ error: 'Message et clé API requis' });
  }

  if (!userId) return res.status(400).json({ error: 'userId requis' });

  userActivity[userId] = Date.now();

  const userConvs = getOrCreateUser(userId);
  const prov = PROVIDERS[provider] || PROVIDERS.groq;
  const selectedModel = model || prov.default;
  const convId = conversationId || (++convCounters[userId]).toString();

  if (!userConvs[convId]) {
    userConvs[convId] = [{ role: 'system', content: SYSTEM_PROMPT }];
  } else {
    userConvs[convId][0] = { role: 'system', content: SYSTEM_PROMPT };
  }
  saveConversation(userId, convId, userConvs[convId]);

  const ALLOWED_IMG_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const MAX_IMG_SIZE = 10 * 1024 * 1024;

  if (image) {
    if (image.length > MAX_IMG_SIZE * 1.37) {
      return res.status(400).json({ error: 'Image trop volumineuse (max 10MB)' });
    }
    if (!imageType || !ALLOWED_IMG_TYPES.includes(imageType)) {
      return res.status(400).json({ error: 'Format d\'image non supporté' });
    }
    try {
      const header = Buffer.from(image.slice(0, 4), 'base64').toString('hex');
      const validHeaders = ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2', '89504e47', '47494638', '52494646'];
      if (!validHeaders.some(h => header.startsWith(h.slice(0, 6)))) {
        return res.status(400).json({ error: 'Image invalide ou corrompue' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Image invalide' });
    }
  }

  const isVision = VISION_MODELS.includes(selectedModel);

  let userContent = message;
  if (image && isVision) {
    userContent = [{ type: 'text', text: message }];
    const mime = imageType || 'image/jpeg';
    if (image.startsWith('http')) {
      userContent.push({ type: 'image_url', image_url: { url: image } });
    } else {
      userContent.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } });
    }
  }
  userConvs[convId].push({ role: 'user', content: userContent });
  saveConversation(userId, convId, userConvs[convId]);

  // Tronquer l'historique pour éviter les limites de tokens
  const MAX_HISTORY = 10;
  if (userConvs[convId].length > MAX_HISTORY) {
    const system = userConvs[convId][0];
    const recent = userConvs[convId].slice(-(MAX_HISTORY - 1));
    userConvs[convId] = [system, ...recent];
    saveConversation(userId, convId, userConvs[convId]);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('convId', { id: convId });

  // Fallback: try all models of the selected provider on rate limit
  const tryList = prov.models.map(m => ({ providerId: provider || 'groq', apiKey, model: m, prov }));
  const preferredIdx = tryList.findIndex(t => t.model === selectedModel);
  if (preferredIdx > 0) {
    const [item] = tryList.splice(preferredIdx, 1);
    tryList.unshift(item);
  }

  for (let attempt = 0; attempt < tryList.length; attempt++) {
    const entry = tryList[attempt];
    if (!entry) break;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000);

      const response = await fetch(entry.prov.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${entry.apiKey}`
        },
        body: JSON.stringify({
          model: entry.model,
          messages: userConvs[convId],
          stream: true,
          max_tokens: entry.prov === PROVIDERS.groq ? 8192 : entry.prov === PROVIDERS.deepseek ? 32768 : 16384
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if ((response.status === 429 || response.status === 400 || response.status === 413) && attempt < tryList.length - 1) {
        const next = tryList[attempt + 1];
        sendEvent('status', { message: `Rate limit dépassé (${entry.providerId}/${entry.model}), passage à ${next.providerId}/${next.model}...` });
        continue;
      }

      if (!response.ok) {
        let errText = '';
        try { errText = await response.text(); } catch (e) { errText = ''; }
        console.error(`${entry.providerId} API error ${response.status}: ${errText}`);
        const shortErr = errText ? errText.slice(0, 200) : 'clé invalide ou solde insuffisant';
        sendEvent('error', { message: `Erreur ${entry.providerId} (${response.status}): ${shortErr}` });
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
        userConvs[convId].push({ role: 'assistant', content: fullContent });
        saveConversation(userId, convId, userConvs[convId]);
        sendEvent('done', { content: fullContent });
      } else {
        sendEvent('error', { message: 'Aucun contenu généré' });
      }

      res.end();
      return;

    } catch (err) {
      console.error('Erreur:', err.message);
      if (attempt < tryList.length - 1) {
        const next = tryList[attempt + 1];
        sendEvent('status', { message: `Erreur (${entry.providerId}/${entry.model}), passage à ${next.providerId}/${next.model}...` });
        continue;
      }
      sendEvent('error', { message: err.name === 'AbortError' ? 'Requête expirée (300s)' : `Erreur: ${err.message}` });
      res.end();
      return;
    }
  }
  res.end();
});

// Nettoyer les utilisateurs inactifs toutes les minutes
setInterval(() => {
  const now = Date.now();
  for (const uid in userActivity) {
    if (now - userActivity[uid] > 300000) delete userActivity[uid];
  }
}, 60000);

app.get('/api/online', (req, res) => {
  const now = Date.now();
  const count = Object.values(userActivity).filter(t => now - t < 300000).length;
  res.json({ count });
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
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requis' });
  const userConvs = conversations[userId];
  if (!userConvs) return res.json([]);
  const list = Object.entries(userConvs).map(([id, msgs]) => ({
    id,
    title: msgs.find(m => m.role === 'user')?.content?.slice(0, 60) || 'Nouveau',
    count: msgs.filter(m => m.role === 'user').length
  })).reverse();
  res.json(list);
});

app.get('/api/conversation/:id', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requis' });
  const conv = conversations[userId]?.[req.params.id];
  if (!conv) return res.status(404).json({ error: 'Introuvable' });
  res.json(conv);
});

app.delete('/api/conversation/:id', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requis' });
  if (conversations[userId]) {
    delete conversations[userId][req.params.id];
    try {
      fs.unlinkSync(path.join(userDir(userId), `${req.params.id}.json`));
    } catch (e) {}
  }
  res.json({ ok: true });
});

app.post('/api/new', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId requis' });
  const userConvs = getOrCreateUser(userId);
  const id = (++convCounters[userId]).toString();
  userConvs[id] = [{ role: 'system', content: SYSTEM_PROMPT }];
  saveConversation(userId, id, userConvs[id]);
  res.json({ id });
});

if (!fs.existsSync(path.join(__dirname, 'site'))) {
  fs.mkdirSync(path.join(__dirname, 'site'));
}

app.listen(PORT, () => {
  console.log(`\u{1F680} Serveur: http://localhost:${PORT}`);
  console.log(`\u{1F50D} Ouvre http://localhost:${PORT} dans ton navigateur`);
});
