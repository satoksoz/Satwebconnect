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
      error: 'Eksik bilgi. deviceName, deviceId ve ip gerekli'
    });
  }

  const now = new Date().toISOString();
  
  // Cihazı veritabanına kaydet veya güncelle
  db.run(`
    INSERT OR REPLACE INTO devices (deviceId, deviceName, ip, lastSeen, isOnline)
    VALUES (?, ?, ?, ?, 1)
  `, [deviceId, deviceName, ip, now], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ 
        success: false, 
        error: 'Veritabanı hatası',
        details: err.message 
      });
    }
    
    // Cache'e kaydet
    deviceCache.set(deviceId, { 
      deviceName, 
      ip, 
      lastSeen: now,
      deviceId 
    });
    
    console.log(`📝 Device registered: ${deviceName} (${deviceId}) from ${ip}`);
    
    res.json({ 
      success: true, 
      message: 'Cihaz başarıyla kaydedildi',
      device: {
        name: deviceName,
        id: deviceId,
        ip: ip
      },
      dashboardUrl: `https://${req.get('host')}/dashboard/${deviceName}`
    });
  });
});

// Cihaz verilerini almak için endpoint
app.post('/api/device-data', (req, res) => {
  const { deviceName, deviceId, data, apiKey } = req.body;

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Geçersiz API anahtarı'
    });
  }

  const now = new Date().toISOString();
  
  // Cihazın çevrimiçi olduğunu güncelle
  db.run(`
    UPDATE devices 
    SET lastSeen = ?, isOnline = 1
    WHERE deviceId = ?
  `, [now, deviceId], function(err) {
    if (err) {
      console.error('Update error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Verileri cache'e kaydet
    deviceCache.set(`${deviceId}_data`, {
      ...data,
      timestamp: now
    });
    
    console.log(`📊 Device data received: ${deviceName}`);
    
    res.json({ 
      success: true, 
      message: 'Data received successfully',
      timestamp: now
    });
  });
});

// Cihaz verilerini getir
app.get('/api/device-data/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;
  
  // Önce veritabanından cihaz bilgilerini al
  db.get('SELECT * FROM devices WHERE deviceName = ?', [deviceName], (err, device) => {
    if (err || !device) {
      return res.status(404).json({ 
        success: false,
        error: 'Cihaz bulunamadı'
      });
    }
    
    // Cache'den en son verileri al
    const cachedData = deviceCache.get(`${device.deviceId}_data`);
    
    const response = {
      success: true,
      device: {
        ...device,
        data: cachedData || null
      }
    };
    
    res.json(response);
  });
});

// Cihaz listesi API
app.get('/api/devices', (req, res) => {
  db.all('SELECT * FROM devices ORDER BY lastSeen DESC', (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ 
        success: false,
        error: 'Veritabanı hatası' 
      });
    }
    
    // Her cihaz için cache'den verileri al
    const devicesWithData = rows.map(device => {
      const cachedData = deviceCache.get(`${device.deviceId}_data`);
      return {
        ...device,
        data: cachedData || null
      };
    });
    
    res.json({
      success: true,
      count: rows.length,
      devices: devicesWithData,
      timestamp: new Date().toISOString()
    });
  });
});

// Tek cihaz bilgisi
app.get('/api/device/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;
  
  db.get('SELECT * FROM devices WHERE deviceName = ?', [deviceName], (err, device) => {
    if (err) {
      return res.status(500).json({ error: 'Veritabanı hatası' });
    }
    
    if (!device) {
      return res.status(404).json({ 
        success: false,
        error: 'Cihaz bulunamadı' 
      });
    }
    
    // Cache'den verileri al
    const cachedData = deviceCache.get(`${device.deviceId}_data`);
    
    res.json({
      success: true,
      device: {
        ...device,
        data: cachedData || null
      }
    });
  });
});

// Dashboard sayfası
app.get('/dashboard/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;
  
  db.get('SELECT * FROM devices WHERE deviceName = ?', [deviceName], (err, device) => {
    if (err || !device) {
      return renderErrorPage(res, deviceName, 'Cihaz bulunamadı', 404);
    }
    
    // Cihaz çevrimdışıysa
    if (!device.isOnline) {
      return renderOfflinePage(res, device);
    }
    
    // Çevrimiçi cihaz için proxy deneyelim
    try {
      const proxy = createProxyMiddleware({
        target: `http://${device.ip}:80`,
        changeOrigin: true,
        pathRewrite: (path, req) => {
          // /dashboard/:deviceName kısmını kaldır
          return path.replace(`/dashboard/${deviceName}`, '');
        },
        onError: (err, req, res) => {
          console.error('Proxy error:', err.message);
          
          // Proxy hatasında cihazı çevrimdışı yap
          db.run('UPDATE devices SET isOnline = 0 WHERE deviceName = ?', [deviceName]);
          
          // Cache'den verilerle dashboard göster
          renderDeviceDashboard(res, device);
        },
        timeout: 10000,
        proxyTimeout: 10000
      });
      
      return proxy(req, res);
    } catch (error) {
      console.error('Proxy setup error:', error.message);
      // Proxy kurulamazsa veri dashboard'unu göster
      renderDeviceDashboard(res, device);
    }
  });
});

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hata sayfası render fonksiyonu
function renderErrorPage(res, deviceName, message, statusCode = 404) {
  res.status(statusCode).send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cihaz Bulunamadı - ESP32 Dashboard</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Arial', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
          color: white;
        }
        .error-container {
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          padding: 40px;
          border-radius: 20px;
          text-align: center;
          max-width: 500px;
          width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .error-icon {
          font-size: 4em;
          margin-bottom: 20px;
        }
        h1 {
          margin-bottom: 10px;
          font-size: 1.8em;
        }
        p {
          margin-bottom: 25px;
          line-height: 1.6;
          opacity: 0.9;
        }
        .device-name {
          background: rgba(255,255,255,0.2);
          padding: 10px 20px;
          border-radius: 10px;
          font-family: monospace;
          font-size: 1.2em;
          margin: 15px 0;
          display: inline-block;
        }
        .actions {
          display: flex;
          gap: 10px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .btn {
          padding: 12px 24px;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
          transition: all 0.3s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .btn-primary {
          background: #667eea;
          color: white;
        }
        .btn-secondary {
          background: rgba(255,255,255,0.2);
          color: white;
          border: 1px solid rgba(255,255,255,0.3);
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
      </style>
    </head>
    <body>
      <div class="error-container">
        <div class="error-icon">🔍</div>
        <h1>Cihaz Bulunamadı</h1>
        <p>${message}</p>
        
        ${deviceName ? `<div class="device-name">${deviceName}</div>` : ''}
        
        <div class="actions">
          <a href="/" class="btn btn-primary">
            <span>🏠</span> Ana Sayfaya Dön
          </a>
          <a href="/api/devices" class="btn btn-secondary">
            <span>📋</span> Aktif Cihazları Gör
          </a>
        </div>
      </div>
    </body>
    </html>
  `);
}

// Çevrimdışı sayfa render fonksiyonu
function renderOfflinePage(res, device) {
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${device.deviceName} - Çevrimdışı</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Arial', sans-serif;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
          color: white;
        }
        .offline-container {
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          padding: 40px;
          border-radius: 20px;
          max-width: 600px;
          width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .offline-header {
          text-align: center;
          margin-bottom: 30px;
        }
        .offline-icon {
          font-size: 4em;
          margin-bottom: 15px;
        }
        h1 {
          color: #721c24;
          margin-bottom: 10px;
          font-size: 1.8em;
        }
        .device-card {
          background: rgba(255,255,255,0.1);
          border-radius: 15px;
          padding: 25px;
          margin-bottom: 25px;
        }
        .device-header {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-bottom: 20px;
        }
        .device-avatar {
          width: 60px;
          height: 60px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 1.5em;
          font-weight: bold;
        }
        .device-title h2 {
          color: #333;
          margin-bottom: 5px;
        }
        .device-title .status {
          display: inline-block;
          padding: 4px 12px;
          background: rgba(248, 215, 218, 0.3);
          color: #721c24;
          border-radius: 20px;
          font-size: 0.9em;
          font-weight: 600;
        }
        .info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
        }
        .info-item {
          padding: 12px;
          background: rgba(255,255,255,0.1);
          border-radius: 10px;
          border-left: 4px solid #667eea;
        }
        .info-label {
          font-size: 0.85em;
          color: rgba(255,255,255,0.8);
          margin-bottom: 5px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .info-value {
          font-weight: 600;
          color: white;
          font-family: 'Monaco', 'Courier New', monospace;
        }
        .actions {
          display: flex;
          gap: 10px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .btn {
          padding: 12px 24px;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
          transition: all 0.3s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: none;
          cursor: pointer;
          font-size: 1em;
          color: white;
        }
        .btn-primary {
          background: #667eea;
        }
        .btn-secondary {
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.3);
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .note {
          text-align: center;
          margin-top: 25px;
          padding: 15px;
          background: rgba(255, 243, 205, 0.2);
          border-radius: 10px;
          color: #856404;
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
      <div class="offline-container">
        <div class="offline-header">
          <div class="offline-icon">🔴</div>
          <h1>Cihaz Çevrimdışı</h1>
          <p>Bu cihaz şu anda çevrimdışı görünüyor</p>
        </div>
        
        <div class="device-card">
          <div class="device-header">
            <div class="device-avatar">ESP</div>
            <div class="device-title">
              <h2>${device.deviceName}</h2>
              <span class="status">🔴 ÇEVRİMDIŞI</span>
            </div>
          </div>
          
          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">Cihaz ID</div>
              <div class="info-value">${device.deviceId}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Son IP Adresi</div>
              <div class="info-value">${device.ip}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Son Görülme</div>
              <div class="info-value">${formatDate(device.lastSeen)}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Kayıt Tarihi</div>
              <div class="info-value">${formatDate(device.created_at)}</div>
            </div>
          </div>
        </div>
        
        <div class="note">
          📢 Not: Cihaz yeniden bağlandığında otomatik olarak görünecektir. 
          Eğer cihazınız çevrimiçi ama bu mesajı görüyorsanız, ESP32'nizin Render sunucusuna kayıt yaptığından emin olun.
        </div>
        
        <div class="actions">
          <button onclick="window.location.href='/'" class="btn btn-primary">
            <span>🏠</span> Ana Sayfaya Dön
          </button>
          <button onclick="location.reload()" class="btn btn-secondary">
            <span>🔄</span> Sayfayı Yenile
          </button>
          <button onclick="window.location.href='/api/devices'" class="btn btn-secondary">
            <span>📋</span> Tüm Cihazlar
          </button>
        </div>
      </div>
      
      <script>
        function formatDate(dateString) {
          const date = new Date(dateString);
          return date.toLocaleString('tr-TR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
        
        // Otomatik yenileme (30 saniyede bir)
        setTimeout(() => {
          location.reload();
        }, 30000);
      </script>
    </body>
    </html>
  `);
}

// Cihaz dashboard'u render fonksiyonu (veri ile)
function renderDeviceDashboard(res, device) {
  const cachedData = deviceCache.get(`${device.deviceId}_data`);
  
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${device.deviceName} - ESP32 Dashboard</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Arial', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          color: white;
          padding: 20px;
        }
        .container {
          max-width: 1000px;
          margin: 0 auto;
        }
        .header {
          text-align: center;
          padding: 30px 0;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          margin-bottom: 30px;
        }
        .header h1 {
          font-size: 2.5em;
          margin-bottom: 10px;
        }
        .device-id {
          background: rgba(255,255,255,0.2);
          padding: 15px 25px;
          border-radius: 50px;
          font-family: monospace;
          font-size: 1.2em;
          display: inline-block;
          margin: 15px 0;
        }
        .status-badge {
          padding: 8px 20px;
          border-radius: 20px;
          font-weight: bold;
          margin-left: 10px;
        }
        .status-online {
          background: #10b981;
        }
        .cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin: 30px 0;
        }
        .card {
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(10px);
          border-radius: 15px;
          padding: 25px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
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
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .info-label {
          font-size: 0.9em;
          opacity: 0.8;
        }
        .info-value {
          font-weight: bold;
          font-family: 'Courier New', monospace;
          font-size: 1.1em;
        }
        .sensor-value {
          color: #4cc9f0;
        }
        .footer {
          text-align: center;
          margin-top: 40px;
          opacity: 0.7;
          font-size: 0.9em;
          padding-top: 20px;
          border-top: 1px solid rgba(255,255,255,0.1);
        }
        .note {
          background: rgba(255,255,255,0.1);
          padding: 15px;
          border-radius: 10px;
          margin: 20px 0;
          font-size: 0.9em;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${device.deviceName}</h1>
          <div class="device-id">${device.deviceId}</div>
          <p>📍 IP: ${device.ip} | 🕐 Son Görülme: ${formatDate(device.lastSeen)}</p>
        </div>
        
        <div class="note">
          🔄 Bu sayfa ESP32'nin Render'a gönderdiği verileri göstermektedir.
          Direkt bağlantı kurulamadığı için canlı veriler görüntülenemiyor.
        </div>
        
        <div class="cards">
          <div class="card">
            <h3>📊 Cihaz Bilgileri</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Cihaz Adı:</span>
                <span class="info-value">${device.deviceName}</span>
              </div>
              <div class="info-item">
                <span class="info-label">IP Adresi:</span>
                <span class="info-value">${device.ip}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Durum:</span>
                <span class="info-value" style="color: #10b981;">🟢 Çevrimiçi</span>
              </div>
              <div class="info-item">
                <span class="info-label">Son Güncelleme:</span>
                <span class="info-value">${formatDate(device.lastSeen)}</span>
              </div>
            </div>
          </div>
          
          ${cachedData ? `
          <div class="card">
            <h3>📡 Sistem Verileri</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Free Heap:</span>
                <span class="info-value">${cachedData.heap || 'N/A'} bytes</span>
              </div>
              <div class="info-item">
                <span class="info-label">WiFi Gücü:</span>
                <span class="info-value">${cachedData.rssi || 'N/A'} dBm</span>
              </div>
              <div class="info-item">
                <span class="info-label">Uptime:</span>
                <span class="info-value">${cachedData.uptime || 'N/A'} saniye</span>
              </div>
              <div class="info-item">
                <span class="info-label">Son Veri:</span>
                <span class="info-value">${formatDate(cachedData.timestamp)}</span>
              </div>
            </div>
          </div>
          
          ${cachedData.sensors ? `
          <div class="card">
            <h3>🌡️ Sensör Verileri</h3>
            <div class="info-grid">
              ${cachedData.sensors.temperature ? `
              <div class="info-item">
                <span class="info-label">Sıcaklık:</span>
                <span class="info-value sensor-value">${cachedData.sensors.temperature} °C</span>
              </div>
              ` : ''}
              
              ${cachedData.sensors.humidity ? `
              <div class="info-item">
                <span class="info-label">Nem:</span>
                <span class="info-value sensor-value">${cachedData.sensors.humidity} %</span>
              </div>
              ` : ''}
              
              ${cachedData.sensors.voltage ? `
              <div class="info-item">
                <span class="info-label">Voltaj:</span>
                <span class="info-value sensor-value">${cachedData.sensors.voltage} V</span>
              </div>
              ` : ''}
              
              ${cachedData.sensors.signal ? `
              <div class="info-item">
                <span class="info-label">Sinyal:</span>
                <span class="info-value sensor-value">${cachedData.sensors.signal} dBm</span>
              </div>
              ` : ''}
            </div>
          </div>
          ` : ''}
          ` : `
          <div class="card">
            <h3>📡 Veri Bekleniyor</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Durum:</span>
                <span class="info-value">Henüz veri alınmadı</span>
              </div>
              <div class="info-item">
                <span class="info-label">Açıklama:</span>
                <span class="info-value">ESP32'den veri bekleniyor...</span>
              </div>
            </div>
          </div>
          `}
        </div>
        
        <div class="footer">
          <p>© 2024 SatWebConnect - ${device.deviceName}</p>
          <p>Bu sayfa ESP32'den gelen verilerle otomatik olarak güncellenir.</p>
          <p style="margin-top: 10px;">
            <a href="/" style="color: #4cc9f0; text-decoration: none;">← Ana Sayfaya Dön</a> |
            <a href="/api/devices" style="color: #4cc9f0; text-decoration: none;">Tüm Cihazlar</a>
          </p>
        </div>
      </div>
      
      <script>
        function formatDate(dateString) {
          const date = new Date(dateString);
          return date.toLocaleString('tr-TR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        }
        
        // 30 saniyede bir sayfayı yenile
        setTimeout(() => {
          location.reload();
        }, 30000);
        
        // Sayfa yüklendiğinde tarihi formatla
        document.addEventListener('DOMContentLoaded', () => {
          document.querySelectorAll('.info-value').forEach(el => {
            if (el.textContent.includes('T') && el.textContent.includes('Z')) {
              el.textContent = formatDate(el.textContent);
            }
          });
        });
      </script>
    </body>
    </html>
  `);
}

// Tarih formatlama fonksiyonu
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('tr-TR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`🚀 SatWebConnect server running on port ${PORT}`);
  console.log(`🔗 http://localhost:${PORT}`);
  console.log(`🔑 API Key: ${API_KEY.substring(0, 10)}...`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});