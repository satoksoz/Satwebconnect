const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'satwebconnect-secret-2024';

// SQLite veritabanı
const db = new sqlite3.Database('./devices.db', (err) => {
  if (err) {
    console.error('Database error:', err);
  } else {
    console.log('✅ SQLite database connected');
  }
});

const deviceCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Veritabanı tablolarını oluştur
db.serialize(() => {
  // Cihaz bilgileri tablosu
  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deviceId TEXT UNIQUE,
      deviceName TEXT,
      ip TEXT,
      lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP,
      isOnline BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Cihaz verileri tablosu (ESP32'den gelen veriler)
  db.run(`
    CREATE TABLE IF NOT EXISTS device_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deviceId TEXT,
      heap INTEGER,
      rssi INTEGER,
      uptime INTEGER,
      temperature REAL,
      humidity REAL,
      voltage REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deviceId) REFERENCES devices (deviceId)
    )
  `);

  console.log('✅ Database tables ready');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'SatWebConnect',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Cihaz kayıt endpoint'i (ESP32 ilk bağlandığında)
app.post('/register', (req, res) => {
  const { deviceName, deviceId, ip, apiKey } = req.body;

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Invalid API key'
    });
  }

  const now = new Date().toISOString();

  db.run(`
    INSERT OR REPLACE INTO devices (deviceId, deviceName, ip, lastSeen, isOnline)
    VALUES (?, ?, ?, ?, 1)
  `, [deviceId, deviceName, ip, now], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    deviceCache.set(deviceId, { deviceName, ip, lastSeen: now });

    console.log(`📝 Device registered: ${deviceName} (${deviceId}) from ${ip}`);

    res.json({
      success: true,
      message: 'Device registered successfully',
      dashboardUrl: `https://${req.get('host')}/dashboard/${deviceName}`
    });
  });
});

// ESP32'den veri alma endpoint'i (ESP32 düzenli olarak veri gönderecek)
app.post('/api/device-data', (req, res) => {
  const { deviceName, deviceId, data, apiKey } = req.body;

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const now = new Date().toISOString();

  // Cihazı online olarak işaretle ve lastSeen güncelle
  db.run(`
    UPDATE devices 
    SET lastSeen = ?, isOnline = 1
    WHERE deviceId = ?
  `, [now, deviceId], (err) => {
    if (err) {
      console.error('Update error:', err);
    }
  });

  // Veriyi device_data tablosuna kaydet
  db.run(`
    INSERT INTO device_data (deviceId, heap, rssi, uptime, temperature, humidity, voltage)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    deviceId,
    data.heap,
    data.rssi,
    data.uptime,
    data.sensors?.temperature || null,
    data.sensors?.humidity || null,
    data.sensors?.voltage || null
  ], (err) => {
    if (err) {
      console.error('Data insert error:', err);
      return res.status(500).json({ error: 'Data insert error' });
    }

    res.json({ success: true, message: 'Data received' });
  });
});

// Cihaz listesi API
app.get('/api/devices', (req, res) => {
  db.all('SELECT * FROM devices ORDER BY lastSeen DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      success: true,
      count: rows.length,
      devices: rows
    });
  });
});

// Tek bir cihazın son verilerini getir
app.get('/api/device/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;

  db.get(`
    SELECT d.*, 
           dd.heap, dd.rssi, dd.uptime, dd.temperature, dd.humidity, dd.voltage,
           dd.timestamp as lastDataTime
    FROM devices d
    LEFT JOIN device_data dd ON d.deviceId = dd.deviceId
    WHERE d.deviceName = ?
    ORDER BY dd.timestamp DESC
    LIMIT 1
  `, [deviceName], (err, device) => {
    if (err || !device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.json({
      success: true,
      device: device
    });
  });
});

// Dashboard sayfası (ESP32'nin verilerini göster)
app.get('/dashboard/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;

  db.get(`
    SELECT d.*, 
           dd.heap, dd.rssi, dd.uptime, dd.temperature, dd.humidity, dd.voltage,
           dd.timestamp as lastDataTime
    FROM devices d
    LEFT JOIN device_data dd ON d.deviceId = dd.deviceId
    WHERE d.deviceName = ?
    ORDER BY dd.timestamp DESC
    LIMIT 1
  `, [deviceName], (err, device) => {
    if (err || !device) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Device Not Found</title>
          <style>
            body { font-family: Arial; text-align: center; padding: 50px; }
            .error { color: #721c24; background: #f8d7da; padding: 20px; border-radius: 10px; }
          </style>
        </head>
        <body>
          <h1>Device Not Found</h1>
          <div class="error">
            Device "${deviceName}" not found or has not sent any data yet.
          </div>
          <p><a href="/">Back to Home</a></p>
        </body>
        </html>
      `);
    }

    // HTML sayfası oluştur (device verileri ile)
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${device.deviceName} - ESP32 Dashboard</title>
          <style>
              body {
                  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  min-height: 100vh;
                  margin: 0;
                  padding: 20px;
              }
              .container {
                  max-width: 1000px;
                  margin: 0 auto;
              }
              .header {
                  text-align: center;
                  padding: 30px 0;
              }
              .device-id {
                  background: rgba(255, 255, 255, 0.2);
                  padding: 10px 20px;
                  border-radius: 50px;
                  font-family: monospace;
                  font-size: 1.2em;
                  display: inline-block;
                  margin: 15px 0;
              }
              .status-badge {
                  display: inline-block;
                  padding: 5px 15px;
                  border-radius: 20px;
                  font-weight: bold;
                  margin-left: 10px;
              }
              .status-online {
                  background: #10b981;
              }
              .status-offline {
                  background: #ef4444;
              }
              .cards {
                  display: grid;
                  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                  gap: 20px;
                  margin: 30px 0;
              }
              .card {
                  background: rgba(255, 255, 255, 0.1);
                  backdrop-filter: blur(10px);
                  border-radius: 15px;
                  padding: 25px;
                  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
              }
              .card h3 {
                  margin-bottom: 20px;
                  font-size: 1.3em;
                  display: flex;
                  align-items: center;
                  gap: 10px;
              }
              .info-grid {
                  display: grid;
                  grid-template-columns: 1fr;
                  gap: 15px;
              }
              .info-item {
                  display: flex;
                  justify-content: space-between;
                  padding: 12px 0;
                  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
              }
              .info-label {
                  opacity: 0.8;
              }
              .info-value {
                  font-weight: bold;
                  font-family: 'Courier New', monospace;
              }
              .footer {
                  text-align: center;
                  margin-top: 40px;
                  opacity: 0.7;
                  font-size: 0.9em;
              }
              .last-update {
                  text-align: center;
                  margin-top: 20px;
                  font-size: 0.9em;
                  opacity: 0.8;
              }
          </style>
          <script>
              function refreshData() {
                  fetch('/api/device/${deviceName}')
                      .then(response => response.json())
                      .then(data => {
                          if (data.success) {
                              const device = data.device;
                              // Bu örnekte sadece uptime'ı güncelliyoruz, diğer verileri de ekleyebilirsiniz
                              document.getElementById('uptime').innerText = device.uptime + ' s';
                              document.getElementById('heap').innerText = device.heap + ' bytes';
                              document.getElementById('rssi').innerText = device.rssi + ' dBm';
                              document.getElementById('temperature').innerText = device.temperature + ' °C';
                              document.getElementById('humidity').innerText = device.humidity + ' %';
                              document.getElementById('voltage').innerText = device.voltage + ' V';
                              document.getElementById('lastDataTime').innerText = new Date(device.lastDataTime).toLocaleString();
                          }
                      })
                      .catch(error => console.error('Error:', error));
              }
              // Her 10 saniyede bir verileri yenile
              setInterval(refreshData, 10000);
              // Sayfa yüklendiğinde ilk yenileme
              setTimeout(refreshData, 1000);
          </script>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>ESP32-S3 Dashboard
                      <span class="status-badge ${device.isOnline ? 'status-online' : 'status-offline'}">
                          ${device.isOnline ? 'ONLINE' : 'OFFLINE'}
                      </span>
                  </h1>
                  <div class="device-id">${device.deviceName}</div>
                  <p>📍 ${device.ip} | 📶 ${device.rssi || 'N/A'} dBm</p>
              </div>

              <div class="cards">
                  <div class="card">
                      <h3>⚙️ System Information</h3>
                      <div class="info-grid">
                          <div class="info-item">
                              <span class="info-label">Device Name:</span>
                              <span class="info-value">${device.deviceName}</span>
                          </div>
                          <div class="info-item">
                              <span class="info-label">Chip ID:</span>
                              <span class="info-value">${device.deviceId}</span>
                          </div>
                          <div class="info-item">
                              <span class="info-label">Free Heap:</span>
                              <span class="info-value" id="heap">${device.heap || 'N/A'} bytes</span>
                          </div>
                          <div class="info-item">
                              <span class="info-label">Uptime:</span>
                              <span class="info-value" id="uptime">${device.uptime || 'N/A'} s</span>
                          </div>
                      </div>
                  </div>

                  <div class="card">
                      <h3>🌐 Network Information</h3>
                      <div class="info-grid">
                          <div class="info-item">
                              <span class="info-label">IP Address:</span>
                              <span class="info-value">${device.ip}</span>
                          </div>
                          <div class="info-item">
                              <span class="info-label">WiFi Strength:</span>
                              <span class="info-value" id="rssi">${device.rssi || 'N/A'} dBm</span>
                          </div>
                          <div class="info-item">
                              <span class="info-label">Last Seen:</span>
                              <span class="info-value">${new Date(device.lastSeen).toLocaleString()}</span>
                          </div>
                      </div>
                  </div>

                  <div class="card">
                      <h3>📊 Sensor Data</h3>
                      <div class="info-grid">
                          <div class="info-item">
                              <span class="info-label">Temperature:</span>
                              <span class="info-value" id="temperature">${device.temperature || 'N/A'} °C</span>
                          </div>
                          <div class="info-item">
                              <span class="info-label">Humidity:</span>
                              <span class="info-value" id="humidity">${device.humidity || 'N/A'} %</span>
                          </div>
                          <div class="info-item">
                              <span class="info-label">Voltage:</span>
                              <span class="info-value" id="voltage">${device.voltage || 'N/A'} V</span>
                          </div>
                          <div class="info-item">
                              <span class="info-label">Last Data:</span>
                              <span class="info-value" id="lastDataTime">${device.lastDataTime ? new Date(device.lastDataTime).toLocaleString() : 'N/A'}</span>
                          </div>
                      </div>
                  </div>
              </div>

              <div class="last-update">
                  <p>Data updates every 10 seconds. Last update: <span id="updateTime">${new Date().toLocaleString()}</span></p>
              </div>

              <div class="footer">
                  <p>© 2024 SatWebConnect - Real-time ESP32 Monitoring</p>
                  <p>Device ID: ${device.deviceId}</p>
              </div>
          </div>

          <script>
              // Update the "last update" time every 10 seconds
              setInterval(() => {
                  document.getElementById('updateTime').innerText = new Date().toLocaleString();
              }, 10000);
          </script>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`🚀 SatWebConnect server running on port ${PORT}`);
  console.log(`🔗 http://localhost:${PORT}`);
});