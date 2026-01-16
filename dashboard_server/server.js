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

// Veritabanı tablosu oluştur (sensors sütunu ekleyelim)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deviceId TEXT UNIQUE,
      deviceName TEXT,
      ip TEXT,
      lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP,
      isOnline BOOLEAN DEFAULT 0,
      heapMemory INTEGER,
      rssi INTEGER,
      uptime INTEGER,
      sensorData TEXT,
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

// ESP32'den veri almak için endpoint
app.post('/api/device-data', (req, res) => {
  const { deviceName, deviceId, data, apiKey } = req.body;

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Geçersiz API anahtarı'
    });
  }

  if (!deviceName || !deviceId || !data) {
    return res.status(400).json({
      success: false,
      error: 'Eksik veri'
    });
  }

  const now = new Date().toISOString();
  
  // Veriyi veritabanına kaydet
  db.run(`
    UPDATE devices 
    SET lastSeen = ?, isOnline = 1,
        heapMemory = ?, rssi = ?, uptime = ?, sensorData = ?
    WHERE deviceId = ?
  `, [now, data.heap, data.rssi, data.uptime, JSON.stringify(data.sensors), deviceId], function(err) {
    if (err) {
      console.error('Update error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    console.log(`📊 Device data updated: ${deviceName} - Heap: ${data.heap}, RSSI: ${data.rssi}`);
    
    res.json({ 
      success: true, 
      message: 'Data received successfully',
      receivedAt: now
    });
  });
});

// Cihaz verilerini getir
app.get('/api/device-data/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;
  
  db.get(`
    SELECT * FROM devices 
    WHERE deviceName = ?
  `, [deviceName], (err, device) => {
    if (err || !device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Parse sensor data
    let sensors = {};
    if (device.sensorData) {
      try {
        sensors = JSON.parse(device.sensorData);
      } catch (e) {
        console.error('Error parsing sensor data:', e);
      }
    }
    
    res.json({
      success: true,
      device: {
        ...device,
        sensors: sensors
      }
    });
  });
});

// Cihaz listesi API
app.get('/api/devices', (req, res) => {
  db.all('SELECT * FROM devices ORDER BY lastSeen DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Veritabanı hatası' });
    }
    
    // Parse sensor data for each device
    const devicesWithSensors = rows.map(device => {
      let sensors = {};
      if (device.sensorData) {
        try {
          sensors = JSON.parse(device.sensorData);
        } catch (e) {
          console.error('Error parsing sensor data:', e);
        }
      }
      
      return {
        ...device,
        sensors: sensors
      };
    });
    
    res.json({
      success: true,
      count: rows.length,
      devices: devicesWithSensors
    });
  });
});

// Dashboard sayfası - Artık veri gösterecek şekilde
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
            .error { 
              color: #f8d7da; 
              background: rgba(114, 28, 36, 0.5); 
              padding: 20px; 
              border-radius: 10px; 
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Cihaz Bulunamadı</h1>
            <div class="error">
              "${deviceName}" adlı cihaz bulunamadı veya hiç kayıt olmadı.
            </div>
            <p><a href="/" style="color: white;">Ana Sayfaya Dön</a></p>
          </div>
        </body>
        </html>
      `);
    }
    
    // Parse sensor data
    let sensors = {};
    if (device.sensorData) {
      try {
        sensors = JSON.parse(device.sensorData);
      } catch (e) {
        console.error('Error parsing sensor data:', e);
      }
    }
    
    // Cihaz çevrimdışıysa
    if (!device.isOnline) {
      const lastSeen = new Date(device.lastSeen);
      const now = new Date();
      const diffMinutes = Math.floor((now - lastSeen) / (1000 * 60));
      
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${deviceName} - Çevrimdışı</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              text-align: center; 
              padding: 50px; 
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              color: white;
              min-height: 100vh;
            }
            .container {
              max-width: 700px;
              margin: 0 auto;
              background: rgba(255,255,255,0.1);
              padding: 40px;
              border-radius: 20px;
              backdrop-filter: blur(10px);
            }
            .offline { 
              color: #fff3cd; 
              background: rgba(133, 100, 4, 0.3); 
              padding: 25px; 
              border-radius: 10px; 
              margin: 20px 0;
              text-align: left;
            }
            .device-info {
              background: rgba(255,255,255,0.05);
              padding: 20px;
              border-radius: 10px;
              margin: 20px 0;
            }
            .info-item {
              display: flex;
              justify-content: space-between;
              margin: 10px 0;
              padding-bottom: 10px;
              border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .info-label {
              opacity: 0.8;
            }
            .info-value {
              font-weight: bold;
              font-family: 'Courier New', monospace;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>${deviceName} - Çevrimdışı</h1>
            <div class="offline">
              <h3>⚠️ Bu cihaz şu anda çevrimdışı</h3>
              <p>Son görülme: ${lastSeen.toLocaleString('tr-TR')} (${diffMinutes} dakika önce)</p>
              <p>Cihaz yeniden bağlandığında otomatik olarak görünecektir.</p>
            </div>
            
            <div class="device-info">
              <div class="info-item">
                <span class="info-label">Cihaz ID:</span>
                <span class="info-value">${device.deviceId}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Son IP Adresi:</span>
                <span class="info-value">${device.ip}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Son Heap Memory:</span>
                <span class="info-value">${device.heapMemory || 'N/A'} bytes</span>
              </div>
              <div class="info-item">
                <span class="info-label">Son RSSI:</span>
                <span class="info-value">${device.rssi || 'N/A'} dBm</span>
              </div>
            </div>
            
            <p><a href="/" style="color: white;">Ana Sayfaya Dön</a></p>
          </div>
        </body>
        </html>
      `);
    }
    
    // Cihaz çevrimiçiyse, verileri göster
    const lastSeen = new Date(device.lastSeen);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${deviceName} - Dashboard</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            padding: 20px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
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
          .device-id {
            background: rgba(255,255,255,0.2);
            padding: 12px 24px;
            border-radius: 50px;
            font-family: monospace;
            font-size: 1.2em;
            display: inline-block;
            margin: 15px 0;
          }
          .status-online {
            color: #4ade80;
            font-weight: bold;
          }
          .cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          .card {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 25px;
          }
          .card h3 {
            margin-bottom: 20px;
            font-size: 1.3em;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .info-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
          }
          .info-label {
            opacity: 0.8;
          }
          .info-value {
            font-weight: bold;
            font-family: 'Courier New', monospace;
          }
          .sensor-value {
            color: #4cc9f0;
          }
          .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
            opacity: 0.8;
            font-size: 0.9em;
          }
          @media (max-width: 768px) {
            .cards {
              grid-template-columns: 1fr;
            }
          }
        </style>
        <script>
          function refreshData() {
            fetch('/api/device-data/${deviceName}')
              .then(response => response.json())
              .then(data => {
                if (data.success && data.device) {
                  const device = data.device;
                  // Update device info
                  document.getElementById('lastSeen').textContent = new Date(device.lastSeen).toLocaleString('tr-TR');
                  document.getElementById('heap').textContent = device.heapMemory ? device.heapMemory + ' bytes' : 'N/A';
                  document.getElementById('rssi').textContent = device.rssi ? device.rssi + ' dBm' : 'N/A';
                  document.getElementById('uptime').textContent = device.uptime ? device.uptime + ' s' : 'N/A';
                  
                  // Update sensor data
                  if (device.sensors) {
                    if (device.sensors.temperature) {
                      document.getElementById('temperature').textContent = device.sensors.temperature + ' °C';
                    }
                    if (device.sensors.humidity) {
                      document.getElementById('humidity').textContent = device.sensors.humidity + ' %';
                    }
                    if (device.sensors.voltage) {
                      document.getElementById('voltage').textContent = device.sensors.voltage + ' V';
                    }
                    if (device.sensors.signal) {
                      document.getElementById('signal').textContent = device.sensors.signal + ' dBm';
                    }
                  }
                }
              });
          }
          
          // Auto-refresh every 10 seconds
          setInterval(refreshData, 10000);
          // Initial load
          setTimeout(refreshData, 1000);
        </script>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${deviceName} - ESP32 Dashboard</h1>
            <div class="device-id">${deviceName}</div>
            <p>📍 IP: ${device.ip} | 🔄 <span class="status-online">ÇEVRİMİÇİ</span> | 📶 Sinyal: ${device.rssi || 'N/A'} dBm</p>
            <p>Son güncelleme: <span id="lastSeen">${lastSeen.toLocaleString('tr-TR')}</span></p>
          </div>
          
          <div class="cards">
            <div class="card">
              <h3>⚙️ Sistem Bilgileri</h3>
              <div class="info-item">
                <span class="info-label">Cihaz Adı:</span>
                <span class="info-value">${device.deviceName}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Cihaz ID:</span>
                <span class="info-value">${device.deviceId}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Free Heap:</span>
                <span class="info-value" id="heap">${device.heapMemory ? device.heapMemory + ' bytes' : 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Çalışma Süresi:</span>
                <span class="info-value" id="uptime">${device.uptime ? device.uptime + ' s' : 'N/A'}</span>
              </div>
            </div>
            
            <div class="card">
              <h3>🌐 Ağ Bilgileri</h3>
              <div class="info-item">
                <span class="info-label">IP Adresi:</span>
                <span class="info-value">${device.ip}</span>
              </div>
              <div class="info-item">
                <span class="info-label">WiFi Gücü:</span>
                <span class="info-value" id="rssi">${device.rssi ? device.rssi + ' dBm' : 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Durum:</span>
                <span class="info-value status-online">ÇEVRİMİÇİ</span>
              </div>
              <div class="info-item">
                <span class="info-label">Son Güncelleme:</span>
                <span class="info-value">${diffMinutes(device.lastSeen)}</span>
              </div>
            </div>
            
            <div class="card">
              <h3>📡 Sensör Verileri</h3>
              <div class="info-item">
                <span class="info-label">Sıcaklık:</span>
                <span class="info-value sensor-value" id="temperature">${sensors.temperature || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Nem:</span>
                <span class="info-value sensor-value" id="humidity">${sensors.humidity || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Pil Voltajı:</span>
                <span class="info-value sensor-value" id="voltage">${sensors.voltage || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Sinyal Gücü:</span>
                <span class="info-value sensor-value" id="signal">${sensors.signal || 'N/A'}</span>
              </div>
            </div>
          </div>
          
          <div class="footer">
            <p>© 2024 SatWebConnect | Gerçek zamanlı ESP32 izleme sistemi</p>
            <p>Veriler her 10 saniyede bir güncellenir | Son güncelleme: <span id="updateTime">${new Date().toLocaleTimeString('tr-TR')}</span></p>
            <button onclick="refreshData()" style="margin-top: 15px; padding: 10px 20px; background: rgba(255,255,255,0.2); border: none; border-radius: 10px; color: white; cursor: pointer;">
              🔄 Verileri Yenile
            </button>
          </div>
        </div>
        
        <script>
          function diffMinutes(timestamp) {
            const lastSeen = new Date(timestamp);
            const now = new Date();
            const diffMs = now - lastSeen;
            const diffMins = Math.floor(diffMs / 60000);
            
            if (diffMins < 1) return 'Az önce';
            if (diffMins < 60) return diffMins + ' dakika önce';
            
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24) return diffHours + ' saat önce';
            
            return lastSeen.toLocaleDateString('tr-TR');
          }
          
          // Update time every minute
          setInterval(() => {
            document.getElementById('updateTime').textContent = new Date().toLocaleTimeString('tr-TR');
          }, 60000);
        </script>
      </body>
      </html>
    `);
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

// Yardımcı fonksiyon
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Az önce';
  if (diffMins < 60) return `${diffMins} dakika önce`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} saat önce`;
  
  return date.toLocaleDateString('tr-TR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}