const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'your-secret-key-123';

// SQLite veritabanı
const db = new sqlite3.Database(':memory:');
const deviceCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Veritabanı tablosu oluştur
db.serialize(() => {
  db.run(`
    CREATE TABLE devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deviceId TEXT UNIQUE,
      deviceName TEXT,
      ip TEXT,
      lastSeen DATETIME,
      isOnline BOOLEAN DEFAULT 0
    )
  `);
});

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cihaz kayıt endpoint'i
app.post('/register', (req, res) => {
  const { deviceName, deviceId, ip, apiKey } = req.body;

  if (apiKey !== API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const now = new Date().toISOString();
  
  // Cihazı veritabanına kaydet veya güncelle
  db.run(`
    INSERT OR REPLACE INTO devices (deviceId, deviceName, ip, lastSeen, isOnline)
    VALUES (?, ?, ?, ?, 1)
  `, [deviceId, deviceName, ip, now], (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Cache'e kaydet
    deviceCache.set(deviceId, { deviceName, ip, lastSeen: now });
    
    res.json({ 
      success: true, 
      message: 'Device registered',
      dashboardUrl: `https://${req.get('host')}/dashboard/${deviceName}`
    });
  });
});

// Cihaz listesi
app.get('/api/devices', (req, res) => {
  db.all('SELECT * FROM devices ORDER BY lastSeen DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Çevrimdışı cihazları güncelle
    rows.forEach(device => {
      const lastSeen = new Date(device.lastSeen);
      const now = new Date();
      const diffMinutes = (now - lastSeen) / (1000 * 60);
      
      if (diffMinutes > 5 && device.isOnline) {
        db.run('UPDATE devices SET isOnline = 0 WHERE id = ?', [device.id]);
        device.isOnline = 0;
      }
    });
    
    res.json(rows);
  });
});

// Özel cihaz dashboard'u
app.get('/dashboard/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;
  
  db.get('SELECT * FROM devices WHERE deviceName = ?', [deviceName], (err, device) => {
    if (err || !device) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Cihaz Bulunamadı</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              display: flex; 
              justify-content: center; 
              align-items: center; 
              height: 100vh; 
              margin: 0; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .error-container { 
              background: white; 
              padding: 40px; 
              border-radius: 15px; 
              text-align: center;
              box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            h1 { color: #333; }
            p { color: #666; }
            a { 
              display: inline-block; 
              margin-top: 20px; 
              padding: 10px 20px; 
              background: #667eea; 
              color: white; 
              text-decoration: none; 
              border-radius: 5px;
            }
          </style>
        </head>
        <body>
          <div class="error-container">
            <h1>🔍 Cihaz Bulunamadı</h1>
            <p><strong>${deviceName}</strong> adlı cihaz bulunamadı veya çevrimdışı.</p>
            <a href="/">Ana Sayfaya Dön</a>
          </div>
        </body>
        </html>
      `);
    }
    
    // Cihaz çevrimdışıysa
    if (!device.isOnline) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${deviceName} - Çevrimdışı</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              display: flex; 
              justify-content: center; 
              align-items: center; 
              height: 100vh; 
              margin: 0; 
              background: #f0f0f0;
            }
            .offline-container { 
              background: white; 
              padding: 40px; 
              border-radius: 15px; 
              text-align: center;
              box-shadow: 0 10px 30px rgba(0,0,0,0.1);
              max-width: 500px;
            }
            h1 { color: #721c24; }
            .device-info { 
              background: #f8f9fa; 
              padding: 15px; 
              border-radius: 8px; 
              margin: 20px 0;
              text-align: left;
            }
            .info-item { margin: 10px 0; }
            .label { font-weight: bold; color: #666; }
            .value { color: #333; }
          </style>
        </head>
        <body>
          <div class="offline-container">
            <h1>🔴 ${deviceName} - Çevrimdışı</h1>
            <p>Bu cihaz şu anda çevrimdışı görünüyor.</p>
            
            <div class="device-info">
              <div class="info-item">
                <span class="label">Son Görülme:</span>
                <span class="value">${new Date(device.lastSeen).toLocaleString('tr-TR')}</span>
              </div>
              <div class="info-item">
                <span class="label">Son IP Adresi:</span>
                <span class="value">${device.ip}</span>
              </div>
              <div class="info-item">
                <span class="label">Cihaz ID:</span>
                <span class="value">${device.deviceId}</span>
              </div>
            </div>
            
            <p>Cihaz yeniden bağlandığında otomatik olarak görünecektir.</p>
            <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #667eea; color: white; text-decoration: none; border-radius: 5px;">Ana Sayfaya Dön</a>
          </div>
        </body>
        </html>
      `);
    }
    
    // Çevrimiçi cihaz için proxy
    const proxy = createProxyMiddleware({
      target: `http://${device.ip}:80`,
      changeOrigin: true,
      pathRewrite: (path, req) => {
        // /dashboard/:deviceName kısmını kaldır
        return path.replace(`/dashboard/${deviceName}`, '');
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err.message);
        res.status(503).send('ESP32 sunucusuna ulaşılamıyor');
      }
    });
    
    proxy(req, res);
  });
});

// API proxy endpoint'i
app.use('/api/proxy/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;
  
  db.get('SELECT * FROM devices WHERE deviceName = ?', [deviceName], (err, device) => {
    if (err || !device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const proxy = createProxyMiddleware({
      target: `http://${device.ip}:80`,
      changeOrigin: true,
      pathRewrite: (path, req) => {
        return path.replace(`/api/proxy/${deviceName}`, '');
      }
    });
    
    proxy(req, res);
  });
});

// Başlangıç
app.listen(PORT, () => {
  console.log(`Dashboard sunucusu ${PORT} portunda çalışıyor`);
});