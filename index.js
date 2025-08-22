const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public"))); // archivos estáticos

// 🔑 Configuración
const VERIFY_TOKEN = "123";
const TARGETS = [
  { url: "https://wp-cloud.dropi.co/webhook", token: "1" },
  { url: "https://hook.us2.make.com/l2icsqcfubxrqyl7zvp1eexv8czftyxw", token: "123" }
];

// 📒 Carpeta de logs
const LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

// Nombre de archivo diario
function getLogFileName(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `logs-${yyyy}-${mm}-${dd}.json`);
}

// Cargar logs de un día
function loadLogs(date = new Date()) {
  const file = getLogFileName(date);
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file)); } 
    catch { return []; }
  }
  return [];
}

// Guardar logs de un día
function saveLogs(logs, date = new Date()) {
  fs.writeFileSync(getLogFileName(date), JSON.stringify(logs, null, 2));
}

// 🌍 Ruta de prueba
app.get("/", (req, res) => {
  res.send("✅ Webhook WhatsApp con dashboard gráfico corriendo en Render 🚀");
});

// 📊 Dashboard gráfico tipo calendario
app.get("/dashboard", (req, res) => {
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();

  const labels = files.map(f => f.replace("logs-", "").replace(".json",""));
  const counts = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(LOG_DIR, f)));
      return data.length;
    } catch { return 0; }
  });

  let html = `
    <html>
      <head>
        <title>Dashboard Webhook WhatsApp</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
          body { font-family: Arial, sans-serif; padding:20px; background:#f7f7f7; }
          h1 { color:#2c3e50; }
          canvas { background:#fff; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
        </style>
      </head>
      <body>
        <h1>📊 Dashboard Webhook WhatsApp</h1>
        <canvas id="chart" width="800" height="400"></canvas>
        <script>
          const ctx = document.getElementById('chart').getContext('2d');
          new Chart(ctx, {
            type: 'bar',
            data: {
              labels: ${JSON.stringify(labels)},
              datasets: [{
                label: 'Eventos por día',
                data: ${JSON.stringify(counts)},
                backgroundColor: 'rgba(54, 162, 235, 0.6)'
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
              },
              onClick: (evt, item) => {
                if (item.length > 0) {
                  const index = item[0].index;
                  const day = ${JSON.stringify(labels)}[index];
                  window.location.href = '/logs?date=' + day;
                }
              },
              scales: {
                y: { beginAtZero: true }
              }
            }
          });
        </script>
      </body>
    </html>
  `;
  res.send(html);
});

// 🔍 Dashboard de logs por día con búsqueda y paginación
app.get("/logs", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const dateStr = req.query.date || new Date().toISOString().slice(0,10);
  const date = new Date(dateStr);
  const perPage = 10;

  let logs = loadLogs(date);
  let filteredLogs = logs.filter(l => l.payload.toLowerCase().includes(search));
  const totalPages = Math.ceil(filteredLogs.length / perPage);
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const pageLogs = filteredLogs.slice(start, end);

  // Lista de archivos disponibles
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace("logs-", "").replace(".json",""))
    .sort().reverse();

  let html = `
    <html>
      <head>
        <title>Logs Webhook WhatsApp</title>
        <style>
          body { font-family: Arial, sans-serif; background:#f7f7f7; padding:20px; }
          h1 { color:#2c3e50; }
          .log { background:#fff; padding:10px; margin-bottom:10px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
          pre { white-space: pre-wrap; word-wrap: break-word; font-size: 12px; }
          .pagination { margin: 20px 0; }
          a { margin: 0 5px; text-decoration:none; }
        </style>
      </head>
      <body>
        <h1>📒 Logs Webhook WhatsApp</h1>

        <form method="get" action="/logs">
          <label>Selecciona día: </label>
          <select name="date">
            ${files.map(f => `<option value="${f}" ${f===dateStr?'selected':''}>${f}</option>`).join("")}
          </select>
          <input type="text" name="search" placeholder="Buscar..." value="${search}" />
          <button type="submit">Filtrar</button>
        </form>

        <p>Total eventos: ${filteredLogs.length}</p>

        ${pageLogs.map(log => `
          <div class="log">
            <b>Fecha:</b> ${log.date}<br/>
            <b>Replicado a:</b> ${log.replicated.join(", ")}<br/>
            <pre>${log.payload}</pre>
          </div>
        `).join("")}

        <div class="pagination">
          ${Array.from({ length: totalPages }, (_, i) => `<a href="/logs?page=${i+1}&date=${dateStr}&search=${search}">${i+1}</a>`).join("")}
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

// 📄 Logs JSON filtrado por día y búsqueda
app.get("/logs.json", (req, res) => {
  const search = req.query.search ? req.query.search.toLowerCase() : "";
  const dateStr = req.query.date || new Date().toISOString().slice(0,10);
  const date = new Date(dateStr);
  let logs = loadLogs(date);
  let filteredLogs = logs.filter(l => l.payload.toLowerCase().includes(search));

  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(filteredLogs, null, 2));
});

// 📌 Verificación con Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verificado con Meta");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// 📩 Recepción de eventos y replicación
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("📩 Evento recibido de Meta");

    if (body.object) {
      let replicated = [];

      for (const target of TARGETS) {
        try {
          await axios.post(target.url, body, {
            headers: { "Content-Type": "application/json", "x-verify-token": target.token }
          });
          replicated.push(target.url);
        } catch (error) {
          console.error(`❌ Error al enviar a ${target.url}:`, error.response?.data || error.message);
        }
      }

      // Guardar en logs del día actual
      let logs = loadLogs();
      logs.unshift({
        date: new Date().toLocaleString("es-EC"),
        payload: JSON.stringify(body, null, 2),
        replicated
      });

      if (logs.length > 1000) logs = logs.slice(0, 1000);
      saveLogs(logs);

      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("❌ Error procesando webhook:", error);
    res.sendStatus(500);
  }
});

// Render usa PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
