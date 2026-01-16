const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
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

// Veritabanı tablosu oluştur
db.serialize(() => {
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
  
  console.log('✅ Database table ready');
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

// Cihaz kayıt endpoint'i
app.post('/register', (req, res) => {
  const { deviceName, deviceId, ip, apiKey } = req.body;

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Geçersiz API anahtarı'
    });
  }

  if (!deviceName || !deviceId || !ip) {
    return res.status(400).json({
      success: false,
      error: 'Eksik bilgi'
    });
  }

  const now = new Date().toISOString();
  
  db.run(`
    INSERT OR REPLACE INTO devices (deviceId, deviceName, ip, lastSeen, isOnline)
    VALUES (?, ?, ?, ?, 1)
  `, [deviceId, deviceName, ip, now], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Veritabanı hatası' });
    }
    
    deviceCache.set(deviceId, { deviceName, ip, lastSeen: now });
    
    console.log(`📝 Device registered: ${deviceName} (${deviceId}) from ${ip}`);
    
    res.json({
      success: true,
      message: 'Cihaz başarıyla kaydedildi',
      dashboardUrl: `https://${req.get('host')}/dashboard/${deviceName}`
    });
  });
});

// Cihaz listesi API
app.get('/api/devices', (req, res) => {
  db.all('SELECT * FROM devices ORDER BY lastSeen DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Veritabanı hatası' });
    }
    
    res.json({
      success: true,
      count: rows.length,
      devices: rows
    });
  });
});

// Dashboard sayfası
app.get('/dashboard/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;
  
  db.get('SELECT * FROM devices WHERE deviceName = ?', [deviceName], (err, device) => {
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
            Device "${deviceName}" not found or offline
          </div>
          <p><a href="/">Back to Home</a></p>
        </body>
        </html>
      `);
    }
    
    if (!device.isOnline) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${deviceName} - Offline</title>
          <style>
            body { font-family: Arial; text-align: center; padding: 50px; }
            .offline { color: #856404; background: #fff3cd; padding: 20px; border-radius: 10px; }
          </style>
        </head>
        <body>
          <h1>${deviceName} - Offline</h1>
          <div class="offline">
            Last seen: ${new Date(device.lastSeen).toLocaleString()}<br>
            Last IP: ${device.ip}
          </div>
          <p><a href="/">Back to Home</a></p>
        </body>
        </html>
      `);
    }
    
    // Reverse proxy to ESP32
    const proxy = createProxyMiddleware({
      target: `http://${device.ip}:80`,
      changeOrigin: true,
      pathRewrite: {
        '^/dashboard/[^/]+': ''
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err.message);
        res.status(503).send('Cannot connect to ESP32 device');
      }
    });
    
    proxy(req, res);
  });
});

// Ana sayfa
app.get('/', (req, res) => {
  // Basit bir ana sayfa göster
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>SatWebConnect Dashboard</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          text-align: center;
          padding: 50px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          min-height: 100vh;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background: rgba(255,255,255,0.1);
          padding: 40px;
          border-radius: 20px;
          backdrop-filter: blur(10px);
        }
        h1 { margin-bottom: 20px; }
        input {
          padding: 15px;
          width: 100%;
          margin: 20px 0;
          border: none;
          border-radius: 10px;
          font-size: 16px;
        }
        button {
          padding: 15px 30px;
          background: white;
          color: #667eea;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
        }
        .note {
          margin-top: 30px;
          font-size: 0.9em;
          opacity: 0.8;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>SatWebConnect Dashboard</h1>
        <p>ESP32-S3 cihazlarınızı yönetin</p>
        
        <div id="connectForm">
          <input type="text" id="deviceName" placeholder="Cihaz adı (örn: sat_1A2B3C4D5E6F7G8H)">
          <button onclick="connectToDevice()">Cihaza Bağlan</button>
        </div>
        
        <div class="note">
          <p>🌐 Cihazlarınızın adı "sat_" ile başlar ve 16 karakterlik hex chip ID ile devam eder</p>
          <p>📡 <a href="/api/devices" style="color: white;">Aktif cihazları görüntüle</a></p>
          <p>🔧 <a href="/health" style="color: white;">Sistem durumu</a></p>
        </div>
      </div>
      
      <script>
        function connectToDevice() {
          const deviceName = document.getElementById('deviceName').value.trim();
          if (deviceName) {
            window.location.href = '/dashboard/' + deviceName;
          } else {
            alert('Lütfen bir cihaz adı girin');
          }
        }
        
        // Enter tuşu ile bağlan
        document.getElementById('deviceName').addEventListener('keypress', function(e) {
          if (e.key === 'Enter') {
            connectToDevice();
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`🚀 SatWebConnect server running on port ${PORT}`);
  console.log(`🔗 http://localhost:${PORT}`);
  console.log(`🔑 API Key: ${API_KEY.substring(0, 10)}...`);
});