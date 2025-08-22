// index.js - versión ultra-optimizada
const express = require("express");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

const app = express();
app.use(express.json());

// Configuración
const VERIFY_TOKEN = "123";
const TARGETS = [
  { url: "https://wp-cloud.dropi.co/webhook", token: "1" },
  { url: "https://hook.us2.make.com/l2icsqcfubxrqyl7zvp1eexv8czftyxw", token: "123" }
];

const LOG_DIR = path.join(__dirname, "logs");
fs.mkdir(LOG_DIR, { recursive: true }).catch(console.error);

const MAX_LOGS_PER_DAY = 500;
const DUPLICATE_LIMIT = 500;

// Duplicados y retry en memoria
let processedIds = new Set();
let retryQueue = [];
const RETRY_INTERVAL = 5000;

// ------------------- Funciones -------------------
function getLogFileName(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `logs-${yyyy}-${mm}-${dd}.json`);
}

async function loadLogs(date = new Date()) {
  try {
    const data = await fs.readFile(getLogFileName(date), "utf-8");
    return JSON.parse(data);
  } catch { return []; }
}

async function saveLogs(logs, date = new Date()) {
  await fs.writeFile(getLogFileName(date), JSON.stringify(logs, null, 2));
}

function isDuplicate(event) {
  const id = event?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
  if (!id) return false;
  if (processedIds.has(id)) return true;
  processedIds.add(id);
  if (processedIds.size > DUPLICATE_LIMIT) {
    processedIds = new Set(Array.from(processedIds).slice(-DUPLICATE_LIMIT));
  }
  return false;
}

async function processRetryQueue() {
  if (!retryQueue.length) return;
  const queue = [...retryQueue];
  retryQueue = [];
  await Promise.allSettled(queue.map(async ({ target, body }) => {
    try {
      await axios.post(target.url, body, {
        headers: { "Content-Type": "application/json", "x-verify-token": target.token },
        timeout: 3000
      });
    } catch {
      retryQueue.push({ target, body });
    }
  }));
}
setInterval(processRetryQueue, RETRY_INTERVAL);

// ------------------- Webhook -------------------
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN)
    return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (!body.object || isDuplicate(body)) return res.sendStatus(200);

  const replicationResults = await Promise.allSettled(
    TARGETS.map(async target => {
      try {
        await axios.post(target.url, body, {
          headers: { "Content-Type": "application/json", "x-verify-token": target.token },
          timeout: 3000
        });
        return target.url;
      } catch {
        retryQueue.push({ target, body });
        return null;
      }
    })
  );

  let logs = await loadLogs();
  logs.unshift({
    date: new Date().toLocaleString("es-EC"),
    payload: JSON.stringify(body, null, 2),
    replicated: replicationResults.filter(r => r.status === "fulfilled" && r.value).map(r => r.value)
  });
  if (logs.length > MAX_LOGS_PER_DAY) logs = logs.slice(0, MAX_LOGS_PER_DAY);
  await saveLogs(logs);

  res.sendStatus(200);
});

// ------------------- Dashboard -------------------
app.get("/dashboard", async (req, res) => {
  const files = (await fs.readdir(LOG_DIR))
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, 7); // últimos 7 días

  const labels = files.map(f => f.replace("logs-", "").replace(".json",""));
  const counts = await Promise.all(files.map(async f => {
    try { return JSON.parse(await fs.readFile(path.join(LOG_DIR, f))).length; } catch { return 0; }
  }));

  res.send(`
  <html>
    <head><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head>
    <body>
      <h1>📊 Dashboard Webhook WhatsApp (últimos 7 días)</h1>
      <canvas id="chart" width="800" height="400"></canvas>
      <script>
        new Chart(document.getElementById('chart').getContext('2d'), {
          type:'bar',
          data:{labels:${JSON.stringify(labels)}, datasets:[{label:'Eventos por día', data:${JSON.stringify(counts)}, backgroundColor:'rgba(54,162,235,0.6)'}]},
          options:{responsive:true, scales:{y:{beginAtZero:true}}}
        });
      </script>
    </body>
  </html>
  `);
});

// ------------------- Logs JSON -------------------
app.get("/logs.json", async (req, res) => {
  const search = (req.query.search || "").toLowerCase();
  const dateStr = req.query.date || new Date().toISOString().slice(0,10);
  const logs = await loadLogs(new Date(dateStr));
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(search ? logs.filter(l => l.payload.toLowerCase().includes(search)) : logs, null, 2));
});

// ------------------- Iniciar servidor -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor escuchando en el puerto optimizado ${PORT}`));
