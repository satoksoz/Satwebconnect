const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const NodeCache = require('node-cache');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY || 'satwebconnect-secret-2024';

// SQLite veritabanı yolu (Render için özel)
const dbPath = process.env.NODE_ENV === 'production' 
  ? '/opt/render/project/src/dashboard_server/devices.db'
  : './devices.db';

// Veritabanı bağlantısı
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ SQLite database connected');
    
    // Tabloyu oluştur
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
      `, (err) => {
        if (err) {
          console.error('❌ Table creation error:', err.message);
        } else {
          console.log('✅ Database table ready');
        }
      });
    });
  }
});

// Cache konfigürasyonu
const deviceCache = new NodeCache({ 
  stdTTL: 300,      // 5 dakika
  checkperiod: 60   // 1 dakikada bir kontrol
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static dosyalar (Render için düzeltilmiş yol)
const publicDir = path.join(__dirname, 'public');
console.log(`📁 Public directory path: ${publicDir}`);

// Public klasörü yoksa oluştur
if (!fs.existsSync(publicDir)) {
  console.log('📁 Creating public directory...');
  try {
    fs.mkdirSync(publicDir, { recursive: true });
    console.log('✅ Public directory created');
  } catch (err) {
    console.error('❌ Error creating public directory:', err.message);
  }
}

app.use(express.static(publicDir));

// Log middleware (tüm istekleri logla)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl} - IP: ${req.ip}`);
  next();
});

// ==================== ROUTES ====================

// 1. ANA SAYFA - index.html veya fallback
app.get('/', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  
  if (fs.existsSync(indexPath)) {
    console.log('📄 Serving index.html');
    res.sendFile(indexPath);
  } else {
    console.log('📄 Index.html not found, serving fallback');
    res.send(`
      <!DOCTYPE html>
      <html lang="tr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SatWebConnect - ESP32 Dashboard</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          }
          
          body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
          }
          
          .container {
            max-width: 800px;
            width: 100%;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          
          h1 {
            font-size: 2.5em;
            margin-bottom: 20px;
            text-align: center;
          }
          
          .status {
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            text-align: center;
            font-weight: bold;
          }
          
          .online {
            background: rgba(76, 201, 240, 0.2);
            border: 2px solid #4cc9f0;
            color: #4cc9f0;
          }
          
          .endpoints {
            margin-top: 30px;
            background: rgba(255, 255, 255, 0.05);
            padding: 25px;
            border-radius: 15px;
          }
          
          .endpoints h3 {
            margin-bottom: 15px;
            color: #4cc9f0;
          }
          
          ul {
            list-style: none;
          }
          
          li {
            padding: 12px;
            margin: 8px 0;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            border-left: 4px solid #667eea;
          }
          
          a {
            color: #4cc9f0;
            text-decoration: none;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          a:hover {
            color: white;
            text-decoration: underline;
          }
          
          .code {
            background: rgba(0, 0, 0, 0.3);
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
            overflow-x: auto;
          }
          
          @media (max-width: 768px) {
            .container {
              padding: 20px;
            }
            
            h1 {
              font-size: 1.8em;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🌐 SatWebConnect ESP32 Dashboard</h1>
          
          <div class="status online">
            ✅ Sunucu çalışıyor | Port: ${PORT} | Environment: ${process.env.NODE_ENV || 'development'}
          </div>
          
          <p style="text-align: center; margin-bottom: 20px; opacity: 0.9;">
            ESP32-S3 cihazlarınızı yönetmek için geliştirilmiş dashboard sistemi
          </p>
          
          <div class="endpoints">
            <h3>🔗 Hızlı Bağlantılar</h3>
            <ul>
              <li><a href="/health">🔧 /health</a> - Sistem durumu</li>
              <li><a href="/api/devices">📱 /api/devices</a> - Kayıtlı cihazlar</li>
              <li><a href="/register-test">📝 /register-test</a> - Test kaydı</li>
              <li><a href="/dashboard/test">🧪 /dashboard/test</a> - Test dashboard</li>
            </ul>
          </div>
          
          <div style="margin-top: 30px;">
            <h3>🚀 ESP32 Entegrasyonu</h3>
            <div class="code">
              // Render Sunucusu<br>
              const char* SERVER = "https://satwebconnect.onrender.com";<br><br>
              // API Anahtarı<br>
              const char* API_KEY = "${API_KEY.substring(0, 15)}...";
            </div>
          </div>
          
          <div style="margin-top: 25px; text-align: center; opacity: 0.8; font-size: 0.9em;">
            <p>© 2024 SatWebConnect - Tüm hakları saklıdır</p>
            <p>Server: ${req.headers.host} | Time: ${new Date().toISOString()}</p>
          </div>
        </div>
      </body>
      </html>
    `);
  }
});

// 2. HEALTH CHECK ENDPOINT
app.get('/health', (req, res) => {
  const healthData = {
    status: 'OK',
    service: 'SatWebConnect',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    server: {
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      hostname: req.headers.host,
      uptime: process.uptime()
    },
    database: {
      connected: !!db,
      path: dbPath
    },
    system: {
      node_version: process.version,
      platform: process.platform,
      memory: process.memoryUsage()
    }
  };
  
  res.json(healthData);
});

// 3. REGISTER ENDPOINT (ESP32 için)
app.post('/register', (req, res) => {
  console.log('📝 Register request received');
  
  const { deviceName, deviceId, ip, apiKey } = req.body;
  
  // API anahtarı kontrolü
  if (!apiKey || apiKey !== API_KEY) {
    console.log('❌ Invalid API key');
    return res.status(403).json({
      success: false,
      error: 'Geçersiz API anahtarı',
      receivedKey: apiKey ? apiKey.substring(0, 5) + '...' : 'none'
    });
  }
  
  // Gerekli alanlar kontrolü
  if (!deviceName || !deviceId || !ip) {
    return res.status(400).json({
      success: false,
      error: 'Eksik bilgi. deviceName, deviceId ve ip gereklidir',
      received: { deviceName, deviceId, ip }
    });
  }
  
  const now = new Date().toISOString();
  
  // Cihazı veritabanına kaydet
  db.run(`
    INSERT OR REPLACE INTO devices (deviceId, deviceName, ip, lastSeen, isOnline)
    VALUES (?, ?, ?, ?, 1)
  `, [deviceId, deviceName, ip, now], function(err) {
    if (err) {
      console.error('❌ Database error:', err.message);
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
    
    console.log(`✅ Device registered: ${deviceName} (${deviceId}) from ${ip}`);
    
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

// 4. DATA RECEIVE ENDPOINT (ESP32'den veri alımı)
app.post('/api/device-data', (req, res) => {
  console.log('📊 Device data received');
  
  const { deviceName, deviceId, data, apiKey } = req.body;
  
  // API anahtarı kontrolü
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Geçersiz API anahtarı'
    });
  }
  
  const now = new Date().toISOString();
  
  // Cihazı online olarak güncelle
  db.run(`
    UPDATE devices 
    SET lastSeen = ?, isOnline = 1
    WHERE deviceId = ?
  `, [now, deviceId], function(err) {
    if (err) {
      console.error('❌ Update error:', err.message);
    }
    
    // Veriyi cache'e kaydet
    deviceCache.set(`${deviceId}_data`, {
      ...data,
      timestamp: now
    });
    
    console.log(`📈 Device data cached: ${deviceName}`);
    
    res.json({ 
      success: true, 
      message: 'Data received successfully',
      timestamp: now
    });
  });
});

// 5. DEVICE LIST ENDPOINT
app.get('/api/devices', (req, res) => {
  db.all('SELECT * FROM devices ORDER BY lastSeen DESC', (err, rows) => {
    if (err) {
      console.error('❌ Database error:', err.message);
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

// 6. SINGLE DEVICE ENDPOINT
app.get('/api/device/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;
  
  db.get('SELECT * FROM devices WHERE deviceName = ?', [deviceName], (err, device) => {
    if (err) {
      console.error('❌ Database error:', err.message);
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

// 7. TEST REGISTRATION (Tarayıcı için)
app.get('/register-test', (req, res) => {
  const testDevice = {
    deviceName: 'sat_TEST' + Date.now().toString().slice(-8),
    deviceId: 'TEST_' + Date.now(),
    ip: '192.168.1.' + Math.floor(Math.random() * 255)
  };
  
  const now = new Date().toISOString();
  
  db.run(`
    INSERT OR REPLACE INTO devices (deviceId, deviceName, ip, lastSeen, isOnline)
    VALUES (?, ?, ?, ?, 1)
  `, [testDevice.deviceId, testDevice.deviceName, testDevice.ip, now], function(err) {
    if (err) {
      console.error('❌ Test registration error:', err.message);
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Test Error</title></head>
        <body style="font-family: Arial; padding: 20px;">
          <h1>❌ Test Registration Error</h1>
          <p>Error: ${err.message}</p>
          <a href="/">Back to Home</a>
        </body>
        </html>
      `);
    } else {
      console.log(`✅ Test device registered: ${testDevice.deviceName}`);
      
      // Cache'e kaydet
      deviceCache.set(testDevice.deviceId, { 
        ...testDevice, 
        lastSeen: now 
      });
      
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Test Registration</title>
          <style>
            body { font-family: Arial; padding: 30px; max-width: 800px; margin: 0 auto; }
            .success { background: #d4edda; color: #155724; padding: 20px; border-radius: 10px; margin: 20px 0; }
            .info { background: #d1ecf1; color: #0c5460; padding: 15px; border-radius: 8px; margin: 15px 0; }
            .device-card { background: #f8f9fa; border: 1px solid #dee2e6; padding: 20px; border-radius: 10px; margin: 15px 0; }
            a { color: #007bff; text-decoration: none; font-weight: bold; }
            a:hover { text-decoration: underline; }
            code { background: #e9ecef; padding: 2px 5px; border-radius: 3px; font-family: 'Courier New'; }
          </style>
        </head>
        <body>
          <h1>✅ Test Device Registered Successfully!</h1>
          
          <div class="success">
            <h3>🎉 Registration Successful</h3>
            <p>Test cihazı başarıyla kaydedildi ve şimdi dashboard'a erişebilirsiniz.</p>
          </div>
          
          <div class="device-card">
            <h3>📱 Device Information</h3>
            <p><strong>Device Name:</strong> ${testDevice.deviceName}</p>
            <p><strong>Device ID:</strong> ${testDevice.deviceId}</p>
            <p><strong>IP Address:</strong> ${testDevice.ip}</p>
            <p><strong>Status:</strong> <span style="color: green;">🟢 Online</span></p>
            <p><strong>Registered At:</strong> ${now}</p>
          </div>
          
          <div class="info">
            <h3>🔗 Quick Actions</h3>
            <ul>
              <li><a href="/dashboard/${testDevice.deviceName}" target="_blank">📊 Go to Dashboard</a></li>
              <li><a href="/api/devices">📋 View All Devices</a></li>
              <li><a href="/api/device/${testDevice.deviceName}">🔍 View Device API</a></li>
              <li><a href="/">🏠 Back to Home</a></li>
            </ul>
          </div>
          
          <div style="margin-top: 30px;">
            <h3>📝 ESP32 Test Code</h3>
            <pre style="background: #282c34; color: #abb2bf; padding: 15px; border-radius: 8px; overflow-x: auto;">
// Test için ESP32 kodu
const char* SERVER = "https://satwebconnect.onrender.com";
const char* API_KEY = "${API_KEY}";

// Register için JSON
{
  "deviceName": "${testDevice.deviceName}",
  "deviceId": "${testDevice.deviceId}",
  "ip": "ESP32_IP_ADDRESS",
  "apiKey": "${API_KEY}"
}</pre>
          </div>
        </body>
        </html>
      `);
    }
  });
});

// 8. DASHBOARD PROXY ENDPOINT
app.get('/dashboard/:deviceName', (req, res) => {
  const deviceName = req.params.deviceName;
  console.log(`📱 Dashboard requested for: ${deviceName}`);
  
  // Önce cihazı veritabanında ara
  db.get('SELECT * FROM devices WHERE deviceName = ?', [deviceName], (err, device) => {
    if (err || !device) {
      console.log(`❌ Device not found: ${deviceName}`);
      
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Cihaz Bulunamadı</title>
          <style>
            body { font-family: Arial; padding: 40px; text-align: center; }
            .error { background: #f8d7da; color: #721c24; padding: 20px; border-radius: 10px; max-width: 600px; margin: 0 auto; }
            .actions { margin-top: 30px; }
            .btn { display: inline-block; padding: 10px 20px; margin: 10px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
          </style>
        </head>
        <body>
          <h1>🔍 Cihaz Bulunamadı</h1>
          <div class="error">
            <h2>${deviceName}</h2>
            <p>Bu cihaz henüz sistemde kayıtlı değil.</p>
            <p>ESP32'nizin <code>/register</code> endpoint'ine kayıt olması gerekiyor.</p>
          </div>
          
          <div class="actions">
            <a href="/register-test" class="btn">📝 Test Cihazı Oluştur</a>
            <a href="/" class="btn">🏠 Ana Sayfa</a>
            <a href="/api/devices" class="btn">📋 Tüm Cihazlar</a>
          </div>
          
          <div style="margin-top: 40px; text-align: left; max-width: 600px; margin: 40px auto; background: #f8f9fa; padding: 20px; border-radius: 10px;">
            <h3>🔧 Sorun Giderme</h3>
            <p>1. ESP32'nizin WiFi'ye bağlı olduğundan emin olun</p>
            <p>2. ESP32 kodunda API_KEY'in doğru olduğunu kontrol edin</p>
            <p>3. ESP32 Serial Monitor'da hata olup olmadığına bakın</p>
            <p>4. Manuel test için:</p>
            <pre style="background: #e9ecef; padding: 15px; border-radius: 5px;">
curl -X POST https://satwebconnect.onrender.com/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceName": "${deviceName}",
    "deviceId": "test_id",
    "ip": "192.168.1.100",
    "apiKey": "${API_KEY}"
  }'</pre>
          </div>
        </body>
        </html>
      `);
    }
    
    // Cihaz çevrimdışıysa
    if (!device.isOnline) {
      console.log(`⚠️  Device offline: ${deviceName}`);
      
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${device.deviceName} - Çevrimdışı</title>
          <style>
            body { font-family: Arial; padding: 40px; background: #f8f9fa; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
            .offline-banner { background: #fff3cd; color: #856404; padding: 20px; border-radius: 10px; margin: 20px 0; text-align: center; }
            .device-info { background: #e9ecef; padding: 20px; border-radius: 10px; margin: 20px 0; }
            .btn { display: inline-block; padding: 10px 20px; margin: 10px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔴 ${device.deviceName} - Çevrimdışı</h1>
            
            <div class="offline-banner">
              <h2>⚠️ Cihaz Şu Anda Çevrimdışı</h2>
              <p>Son görülme: ${device.lastSeen}</p>
            </div>
            
            <div class="device-info">
              <h3>Cihaz Bilgileri</h3>
              <p><strong>Cihaz Adı:</strong> ${device.deviceName}</p>
              <p><strong>Cihaz ID:</strong> ${device.deviceId}</p>
              <p><strong>IP Adresi:</strong> ${device.ip}</p>
              <p><strong>Kayıt Tarihi:</strong> ${device.created_at}</p>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="/" class="btn">🏠 Ana Sayfa</a>
              <a href="/api/devices" class="btn">📋 Tüm Cihazlar</a>
              <button onclick="location.reload()" class="btn">🔄 Sayfayı Yenile</button>
            </div>
            
            <div style="margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
              <h4>🔧 Öneriler:</h4>
              <p>• ESP32'nizin güç bağlantısını kontrol edin</p>
              <p>• WiFi bağlantısını kontrol edin</p>
              <p>• ESP32'nizin Render sunucusuna veri gönderdiğinden emin olun</p>
            </div>
          </div>
          
          <script>
            // 30 saniyede bir otomatik yenile
            setTimeout(() => {
              location.reload();
            }, 30000);
          </script>
        </body>
        </html>
      `);
    }
    
    // Çevrimiçi cihaz için proxy oluştur
    console.log(`🔄 Creating proxy for: ${device.ip}:80`);
    
    try {
      const proxy = createProxyMiddleware({
        target: `http://${device.ip}:80`,
        changeOrigin: true,
        pathRewrite: {
          [`^/dashboard/${deviceName}`]: ''
        },
        onError: (err, req, res) => {
          console.error(`❌ Proxy error for ${deviceName}:`, err.message);
          
          // Proxy hatasında cihazı çevrimdışı yap
          db.run('UPDATE devices SET isOnline = 0 WHERE deviceName = ?', [deviceName]);
          
          // Basit dashboard göster
          res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>${device.deviceName} - Proxy Error</title></head>
            <body style="font-family: Arial; padding: 20px;">
              <h1>⚠️ Proxy Bağlantı Hatası</h1>
              <p>Cihaza (${device.ip}) bağlanılamıyor.</p>
              <p>Hata: ${err.message}</p>
              <a href="/">Ana Sayfa</a>
            </body>
            </html>
          `);
        },
        timeout: 10000
      });
      
      // Proxy'yi çalıştır
      proxy(req, res);
      
    } catch (error) {
      console.error('❌ Proxy setup error:', error.message);
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Proxy Error</title></head>
        <body style="font-family: Arial; padding: 20px;">
          <h1>❌ Proxy Setup Error</h1>
          <p>Error: ${error.message}</p>
          <a href="/">Back to Home</a>
        </body>
        </html>
      `);
    }
  });
});

// 9. TEST DASHBOARD
app.get('/dashboard-test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Dashboard</title>
      <style>
        body { font-family: Arial; padding: 40px; }
        .test-card { background: #e9ecef; padding: 30px; border-radius: 15px; max-width: 600px; margin: 20px auto; }
        .btn { display: inline-block; padding: 12px 24px; margin: 10px; background: #007bff; color: white; text-decoration: none; border-radius: 8px; }
      </style>
    </head>
    <body>
      <div style="text-align: center;">
        <h1>🧪 Test Dashboard</h1>
        <p>Bu sayfa proxy sisteminin çalışıp çalışmadığını test eder.</p>
        
        <div class="test-card">
          <h3>Test Senaryoları</h3>
          <p>1. <a href="/register-test">Önce test cihazı oluştur</a></p>
          <p>2. Oluşturulan cihazın dashboard'una git</p>
          <p>3. Proxy'nin ESP32'ye bağlanıp bağlanmadığını kontrol et</p>
        </div>
        
        <div style="margin-top: 30px;">
          <a href="/" class="btn">🏠 Ana Sayfa</a>
          <a href="/health" class="btn">🔧 Health Check</a>
          <a href="/api/devices" class="btn">📋 Devices API</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// 10. 404 HATA SAYFASI (en sonda olmalı)
app.use('*', (req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>404 - Sayfa Bulunamadı</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          padding: 40px; 
          text-align: center; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .error-container { 
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          padding: 40px; 
          border-radius: 20px;
          max-width: 600px;
          width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 { font-size: 3em; margin-bottom: 20px; }
        .error-code { 
          background: rgba(255,255,255,0.2); 
          padding: 10px 20px; 
          border-radius: 10px;
          display: inline-block;
          margin: 15px 0;
          font-family: 'Courier New', monospace;
        }
        .links { margin-top: 30px; }
        .link { 
          display: inline-block; 
          margin: 10px; 
          padding: 12px 24px; 
          background: rgba(255,255,255,0.2); 
          color: white; 
          text-decoration: none; 
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.3);
          transition: all 0.3s;
        }
        .link:hover { 
          background: rgba(255,255,255,0.3);
          transform: translateY(-2px);
        }
      </style>
    </head>
    <body>
      <div class="error-container">
        <h1>🔍 404</h1>
        <h2>Sayfa Bulunamadı</h2>
        
        <div class="error-code">
          ${req.method} ${req.originalUrl}
        </div>
        
        <p>İstediğiniz sayfa mevcut değil veya taşınmış olabilir.</p>
        
        <div class="links">
          <a href="/" class="link">🏠 Ana Sayfa</a>
          <a href="/health" class="link">🔧 Health Check</a>
          <a href="/api/devices" class="link">📋 Cihaz Listesi</a>
        </div>
        
        <div style="margin-top: 30px; opacity: 0.8; font-size: 0.9em;">
          <p>Server: ${req.headers.host} | Time: ${new Date().toISOString()}</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// 11. GENEL HATA YAKALAYICI
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.stack);
  
  res.status(500).send(`
    <!DOCTYPE html>
    <html>
    <head><title>Server Error</title></head>
    <body style="font-family: Arial; padding: 40px;">
      <h1>❌ 500 - Sunucu Hatası</h1>
      <p>Bir şeyler yanlış gitti. Lütfen daha sonra tekrar deneyin.</p>
      <pre style="background: #f8f9fa; padding: 20px; border-radius: 5px; overflow-x: auto;">
${err.stack || err.message}
      </pre>
      <a href="/">Ana Sayfa'ya Dön</a>
    </body>
    </html>
  `);
});

// 12. SUNUCUYU BAŞLAT
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 SatWebConnect Server Started');
  console.log('='.repeat(50));
  console.log(`🔗 Local: http://localhost:${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
  console.log(`🔗 API Key: ${API_KEY.substring(0, 15)}...`);
  console.log(`📁 Public Dir: ${publicDir}`);
  console.log(`💾 Database: ${dbPath}`);
  console.log(`⚡ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(50));
  console.log('📢 ESP32 için API Endpoint\'leri:');
  console.log(`   POST ${PORT}/register`);
  console.log(`   POST ${PORT}/api/device-data`);
  console.log('='.repeat(50) + '\n');
});

// 13. UYGULAMA SONLANDIRMA İŞLEYİCİSİ
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received, closing database...');
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT received, closing database...');
  db.close();
  process.exit(0);
});