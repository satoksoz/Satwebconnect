const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ESP32'ler için WebSocket Server (ROOT path'de)
const esp32Wss = new WebSocket.Server({ 
  server,
  verifyClient: (info, callback) => {
    // Tüm bağlantıları kabul et
    callback(true);
  }
});

// Dashboard kullanıcıları için WebSocket
const dashboardWss = new WebSocket.Server({ 
  server, 
  path: '/dashboard',
  verifyClient: (info, callback) => {
    callback(true);
  }
});

// Bağlı cihazları sakla
const connectedDevices = new Map();

// ESP32 WebSocket bağlantıları
esp32Wss.on('connection', (ws, req) => {
  console.log('🔄 ESP32 bağlandı:', req.socket.remoteAddress);
  
  let deviceId = null;
  let deviceName = null;
  
  // Hemen karşılama mesajı gönder
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'SatWeb Connect Server\'a bağlandınız',
    timestamp: Date.now(),
    server: 'satwebconnect.onrender.com'
  }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'hello') {
        console.log('👋 ESP32 merhaba:', data.device);
      }
      else if (data.type === 'device_register') {
        deviceId = data.device_id;
        deviceName = data.device_name;
        
        const deviceInfo = {
          ws: ws,
          device_id: deviceId,
          device_name: deviceName,
          local_ip: data.local_ip,
          connected_at: Date.now(),
          last_seen: Date.now(),
          status: 'online',
          uptime: data.uptime || 0,
          rssi: data.rssi || 0,
          free_heap: data.free_heap || 0
        };
        
        connectedDevices.set(deviceId, deviceInfo);
        
        // ESP32'ye onay gönder
        ws.send(JSON.stringify({
          type: 'registration_confirmed',
          message: 'Cihaz başarıyla kaydedildi',
          device_id: deviceId,
          timestamp: Date.now()
        }));
        
        console.log('✅ Cihaz kaydedildi:', deviceName, '(', deviceId, ')');
        
        // Tüm dashboard kullanıcılarına cihaz listesini gönder
        broadcastDeviceList();
        
        // Dashboard'a bağlı olayı bildir
        broadcastToDashboard({
          type: 'device_connected',
          device_id: deviceId,
          device_name: deviceName,
          timestamp: Date.now()
        });
      }
      else if (data.type === 'heartbeat') {
        if (deviceId && connectedDevices.has(deviceId)) {
          const device = connectedDevices.get(deviceId);
          device.last_seen = Date.now();
          device.status = 'online';
          device.uptime = data.uptime;
          device.rssi = data.rssi;
          device.free_heap = data.free_heap;
          
          // Dashboard'a heartbeat bildir
          broadcastToDashboard({
            type: 'device_heartbeat',
            device_id: deviceId,
            uptime: data.uptime,
            rssi: data.rssi,
            free_heap: data.free_heap,
            timestamp: Date.now()
          });
        }
      }
      else if (data.type === 'command_response' || data.type === 'device_event') {
        console.log('🎮 Cihaz yanıtı:', deviceId, data.command || data.event);
        
        // Dashboard'a yanıtı gönder
        broadcastToDashboard({
          type: 'device_response',
          device_id: deviceId,
          command: data.command,
          event: data.event,
          success: data.success,
          message: data.message,
          timestamp: Date.now()
        });
      }
      else if (data.type === 'pong') {
        // Ping'e pong yanıtı
        console.log('🏓 Pong from:', deviceId);
      }
      else {
        console.log('📨 ESP32 mesajı:', data.type, data);
      }
      
    } catch (error) {
      console.log('📨 Ham ESP32 mesajı:', message.toString());
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 ESP32 bağlantısı kapandı:', deviceId || 'Bilinmeyen');
    
    if (deviceId && connectedDevices.has(deviceId)) {
      const device = connectedDevices.get(deviceId);
      device.status = 'offline';
      device.last_seen = Date.now();
      
      // Dashboard'a bildir
      broadcastToDashboard({
        type: 'device_disconnected',
        device_id: deviceId,
        device_name: deviceName,
        timestamp: Date.now()
      });
      
      // Cihaz listesini güncelle
      broadcastDeviceList();
    }
  });
  
  ws.on('error', (error) => {
    console.error('💥 ESP32 WebSocket hatası:', error);
  });
  
  // Her 30 saniyede bir ping gönder
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'ping',
        timestamp: Date.now()
      }));
    }
  }, 30000);
  
  ws.on('close', () => {
    clearInterval(pingInterval);
  });
});

// Dashboard WebSocket bağlantıları
dashboardWss.on('connection', (ws) => {
  console.log('🖥️  Dashboard kullanıcısı bağlandı');
  
  // Bağlanır bağlanmaz mevcut cihaz listesini gönder
  sendDeviceList(ws);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'send_command') {
        const { device_id, command } = data;
        sendCommandToDevice(device_id, command, ws);
      }
      else if (data.type === 'get_devices') {
        sendDeviceList(ws);
      }
      
    } catch (error) {
      console.error('Dashboard mesaj hatası:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('🖥️  Dashboard kullanıcısı ayrıldı');
  });
});

// Cihaza komut gönder
function sendCommandToDevice(deviceId, command, requesterWs = null) {
  const device = connectedDevices.get(deviceId);
  
  if (!device) {
    if (requesterWs) {
      requesterWs.send(JSON.stringify({
        type: 'command_error',
        message: 'Cihaz bulunamadı',
        device_id: deviceId
      }));
    }
    return;
  }
  
  if (device.status !== 'online') {
    if (requesterWs) {
      requesterWs.send(JSON.stringify({
        type: 'command_error',
        message: 'Cihaz çevrimdışı',
        device_id: deviceId
      }));
    }
    return;
  }
  
  try {
    device.ws.send(JSON.stringify({
      type: 'command',
      command: command,
      timestamp: Date.now(),
      source: 'dashboard'
    }));
    
    console.log('📤 Komut gönderildi:', deviceId, '->', command);
    
    if (requesterWs) {
      requesterWs.send(JSON.stringify({
        type: 'command_sent',
        message: 'Komut gönderildi',
        device_id: deviceId,
        command: command
      }));
    }
    
  } catch (error) {
    console.error('Komut gönderme hatası:', error);
    
    if (requesterWs) {
      requesterWs.send(JSON.stringify({
        type: 'command_error',
        message: 'Komut gönderilemedi',
        device_id: deviceId,
        error: error.message
      }));
    }
  }
}

// Tüm dashboard kullanıcılarına cihaz listesini gönder
function broadcastDeviceList() {
  const deviceList = Array.from(connectedDevices.values()).map(device => ({
    device_id: device.device_id,
    device_name: device.device_name,
    local_ip: device.local_ip,
    status: device.status,
    connected_at: device.connected_at,
    last_seen: device.last_seen,
    uptime: device.uptime,
    rssi: device.rssi,
    free_heap: device.free_heap,
    online: device.status === 'online'
  }));
  
  const message = JSON.stringify({
    type: 'device_list',
    devices: deviceList,
    timestamp: Date.now(),
    total: deviceList.length,
    online: deviceList.filter(d => d.status === 'online').length
  });
  
  dashboardWss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Tek bir dashboard kullanıcısına cihaz listesini gönder
function sendDeviceList(ws) {
  const deviceList = Array.from(connectedDevices.values()).map(device => ({
    device_id: device.device_id,
    device_name: device.device_name,
    local_ip: device.local_ip,
    status: device.status,
    connected_at: device.connected_at,
    last_seen: device.last_seen,
    online: device.status === 'online'
  }));
  
  ws.send(JSON.stringify({
    type: 'device_list',
    devices: deviceList,
    timestamp: Date.now()
  }));
}

// Dashboard kullanıcılarına mesaj gönder
function broadcastToDashboard(data) {
  const message = JSON.stringify(data);
  
  dashboardWss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// API Endpoints
app.get('/api/status', (req, res) => {
  const onlineDevices = Array.from(connectedDevices.values()).filter(d => d.status === 'online').length;
  
  res.json({
    status: 'online',
    server: 'SatWeb Connect',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: Date.now(),
    connected_devices: connectedDevices.size,
    online_devices: onlineDevices,
    endpoints: {
      websocket: 'ws://' + req.headers.host,
      dashboard: 'ws://' + req.headers.host + '/dashboard',
      api: 'http://' + req.headers.host + '/api'
    }
  });
});

app.get('/api/devices', (req, res) => {
  const devices = Array.from(connectedDevices.values()).map(device => ({
    device_id: device.device_id,
    device_name: device.device_name,
    local_ip: device.local_ip,
    status: device.status,
    last_seen: device.last_seen,
    uptime: device.uptime,
    rssi: device.rssi,
    free_heap: device.free_heap,
    online: device.status === 'online'
  }));
  
  res.json({
    success: true,
    devices: devices,
    count: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    timestamp: Date.now()
  });
});

app.post('/api/command', (req, res) => {
  const { device_id, command } = req.body;
  
  if (!device_id || !command) {
    return res.status(400).json({
      success: false,
      message: 'device_id ve command gereklidir'
    });
  }
  
  const device = connectedDevices.get(device_id);
  
  if (!device) {
    return res.status(404).json({
      success: false,
      message: 'Cihaz bulunamadı'
    });
  }
  
  if (device.status !== 'online') {
    return res.status(400).json({
      success: false,
      message: 'Cihaz çevrimdışı'
    });
  }
  
  try {
    device.ws.send(JSON.stringify({
      type: 'command',
      command: command,
      timestamp: Date.now()
    }));
    
    res.json({
      success: true,
      message: 'Komut gönderildi',
      device_id: device_id,
      command: command
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Komut gönderilemedi',
      error: error.message
    });
  }
});

// Ana sayfa - Dashboard
app.get('/', (req, res) => {
  const host = req.headers.host;
  
  res.send(`
  <!DOCTYPE html>
  <html lang="tr">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SatWeb Connect - Global Dashboard</title>
      <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; background: #f0f2f5; color: #333; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; text-align: center; }
          .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
          .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
          .stat-card { background: white; padding: 1.5rem; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
          .stat-value { font-size: 2.5rem; font-weight: bold; color: #667eea; }
          .stat-label { color: #666; margin-top: 0.5rem; }
          .devices-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }
          .device-card { background: white; border-radius: 10px; padding: 1.5rem; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .device-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
          .device-name { font-weight: bold; font-size: 1.2rem; }
          .device-status { padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.9rem; }
          .online { background: #d4edda; color: #155724; }
          .offline { background: #f8d7da; color: #721c24; }
          .controls { display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap; }
          .btn { padding: 0.5rem 1rem; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
          .btn-primary { background: #28a745; color: white; }
          .btn-secondary { background: #dc3545; color: white; }
          .btn-info { background: #007bff; color: white; }
          .log { background: #1a1a1a; color: #00ff00; padding: 1rem; border-radius: 5px; font-family: monospace; height: 200px; overflow-y: auto; margin-top: 2rem; }
          .log-entry { margin-bottom: 0.5rem; }
          .log-time { color: #666; }
          .refresh-btn { background: #17a2b8; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 5px; cursor: pointer; margin-top: 1rem; }
          .no-devices { grid-column: 1 / -1; text-align: center; padding: 50px 20px; color: #6c757d; }
          .no-devices i { font-size: 3rem; margin-bottom: 15px; color: #adb5bd; }
      </style>
  </head>
  <body>
      <div class="header">
          <h1>🛰️ SatWeb Connect - Global Dashboard</h1>
          <p>ESP32 IoT Cihaz Yönetim Paneli</p>
      </div>
      
      <div class="container">
          <div class="stats" id="statsContainer">
              <div class="stat-card">
                  <div class="stat-value" id="totalDevices">0</div>
                  <div class="stat-label">Toplam Cihaz</div>
              </div>
              <div class="stat-card">
                  <div class="stat-value" id="onlineDevices" style="color:#28a745;">0</div>
                  <div class="stat-label">Çevrimiçi</div>
              </div>
              <div class="stat-card">
                  <div class="stat-value" id="offlineDevices" style="color:#dc3545;">0</div>
                  <div class="stat-label">Çevrimdışı</div>
              </div>
              <div class="stat-card">
                  <div class="stat-value" id="serverStatus">✅</div>
                  <div class="stat-label">Sunucu Durumu</div>
              </div>
          </div>
          
          <h2>📱 Bağlı Cihazlar</h2>
          <div class="devices-grid" id="devicesContainer">
              <div class="no-devices">
                  <div style="font-size:48px;">📡</div>
                  <p>⏳ Cihaz bekleniyor...</p>
                  <p>ESP32'nizi şu adrese bağlayın: <code>ws://${host}</code></p>
                  <p><small>ESP32 WebSocket port: 10000</small></p>
              </div>
          </div>
          
          <div style="text-align:center;margin:2rem 0;">
              <button class="refresh-btn" onclick="loadDevices()">🔄 Cihazları Yenile</button>
              <button class="refresh-btn" onclick="testWebSocket()">🔗 Bağlantıyı Test Et</button>
          </div>
          
          <h2>📊 Sistem Logları</h2>
          <div class="log" id="logContainer">
              <div class="log-entry"><span class="log-time">[00:00:00]</span> <span style="color:#007bff">SatWeb Connect Dashboard başlatıldı</span></div>
          </div>
      </div>
      
      <script>
          let dashboardWs = null;
          const logContainer = document.getElementById('logContainer');
          const devicesContainer = document.getElementById('devicesContainer');
          const statsContainer = document.getElementById('statsContainer');
          
          function addLog(message, type = 'info') {
              const time = new Date().toLocaleTimeString();
              const colors = { 
                  info: '#007bff', 
                  success: '#28a745', 
                  error: '#dc3545', 
                  warning: '#ffc107',
                  connection: '#6f42c1'
              };
              const color = colors[type] || '#ffffff';
              
              const logEntry = document.createElement('div');
              logEntry.className = 'log-entry';
              logEntry.innerHTML = '<span class="log-time">[' + time + ']</span> <span style="color:' + color + '">' + message + '</span>';
              logContainer.prepend(logEntry);
              
              if (logContainer.children.length > 20) {
                  logContainer.removeChild(logContainer.lastChild);
              }
          }
          
          function connectDashboardWebSocket() {
              const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
              const wsUrl = protocol + '//' + window.location.host + '/dashboard';
              
              dashboardWs = new WebSocket(wsUrl);
              
              dashboardWs.onopen = function() {
                  addLog('Dashboard WebSocket bağlantısı kuruldu', 'success');
                  document.getElementById('serverStatus').textContent = '✅';
                  dashboardWs.send(JSON.stringify({ type: 'get_devices' }));
              };
              
              dashboardWs.onmessage = function(event) {
                  try {
                      const data = JSON.parse(event.data);
                      handleWebSocketMessage(data);
                  } catch (e) {
                      console.error('Mesaj parse hatası:', e);
                  }
              };
              
              dashboardWs.onerror = function(error) {
                  addLog('Dashboard bağlantı hatası', 'error');
                  console.error('WebSocket error:', error);
                  document.getElementById('serverStatus').textContent = '❌';
              };
              
              dashboardWs.onclose = function() {
                  addLog('Dashboard bağlantısı kesildi. Yeniden bağlanılıyor...', 'warning');
                  document.getElementById('serverStatus').textContent = '⚠️';
                  setTimeout(connectDashboardWebSocket, 3000);
              };
          }
          
          function handleWebSocketMessage(data) {
              if (data.type === 'device_list') {
                  updateDevices(data.devices);
                  updateStats(data);
              }
              else if (data.type === 'device_response') {
                  addLog(data.device_id + ': ' + data.message, data.success ? 'success' : 'error');
              }
              else if (data.type === 'device_connected') {
                  addLog('Cihaz bağlandı: ' + data.device_name, 'connection');
              }
              else if (data.type === 'device_disconnected') {
                  addLog('Cihaz ayrıldı: ' + data.device_name, 'warning');
              }
              else if (data.type === 'command_sent') {
                  addLog('Komut gönderildi: ' + data.device_id + ' -> ' + data.command, 'info');
              }
              else if (data.type === 'command_error') {
                  addLog('Komut hatası: ' + data.message, 'error');
              }
          }
          
          function updateDevices(devices) {
              devicesContainer.innerHTML = '';
              
              if (devices.length === 0) {
                  devicesContainer.innerHTML = '<div class="no-devices"><div style="font-size:48px;">📡</div><p>⏳ Cihaz bekleniyor...</p><p>ESP32\'nizi bağlayın</p></div>';
                  return;
              }
              
              devices.forEach(device => {
                  const lastSeen = new Date(device.last_seen).toLocaleTimeString();
                  const isOnline = device.status === 'online';
                  const connectionTime = new Date(device.connected_at).toLocaleTimeString();
                  
                  const deviceCard = document.createElement('div');
                  deviceCard.className = 'device-card';
                  deviceCard.innerHTML = '<div class="device-header">' +
                      '<div class="device-name">' + device.device_name + '</div>' +
                      '<div class="device-status ' + (isOnline ? 'online' : 'offline') + '">' +
                      (isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı') +
                      '</div>' +
                      '</div>' +
                      '<p><strong>ID:</strong> ' + device.device_id + '</p>' +
                      '<p><strong>Local IP:</strong> ' + device.local_ip + '</p>' +
                      '<p><strong>Bağlantı:</strong> ' + connectionTime + '</p>' +
                      '<p><strong>Son Görülme:</strong> ' + lastSeen + '</p>' +
                      '<p><strong>Çalışma Süresi:</strong> ' + (device.uptime || 0) + ' sn</p>' +
                      '<p><strong>WiFi RSSI:</strong> ' + (device.rssi || 0) + ' dBm</p>' +
                      '<div class="controls">' +
                      '<button class="btn btn-primary" onclick="sendCommand(\'' + device.device_id + '\', \'LED_ON\')">💡 LED Aç</button>' +
                      '<button class="btn btn-secondary" onclick="sendCommand(\'' + device.device_id + '\', \'LED_OFF\')">🌙 LED Kapat</button>' +
                      '<button class="btn btn-info" onclick="sendCommand(\'' + device.device_id + '\', \'GET_STATUS\')">📊 Durum</button>' +
                      '</div>';
                  
                  devicesContainer.appendChild(deviceCard);
              });
          }
          
          function updateStats(data) {
              const onlineCount = data.devices ? data.devices.filter(d => d.status === 'online').length : 0;
              const offlineCount = data.devices ? data.devices.filter(d => d.status === 'offline').length : 0;
              const totalCount = data.devices ? data.devices.length : 0;
              
              document.getElementById('totalDevices').textContent = totalCount;
              document.getElementById('onlineDevices').textContent = onlineCount;
              document.getElementById('offlineDevices').textContent = offlineCount;
          }
          
          function sendCommand(deviceId, command) {
              if (dashboardWs && dashboardWs.readyState === WebSocket.OPEN) {
                  dashboardWs.send(JSON.stringify({
                      type: 'send_command',
                      device_id: deviceId,
                      command: command,
                      timestamp: Date.now()
                  }));
                  addLog('Komut isteği gönderildi: ' + deviceId + ' -> ' + command, 'info');
              } else {
                  // WebSocket yoksa HTTP API kullan
                  fetch('/api/command', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ device_id: deviceId, command: command })
                  })
                  .then(response => response.json())
                  .then(data => {
                      if (data.success) {
                          addLog('Komut gönderildi: ' + deviceId + ' -> ' + command, 'success');
                      } else {
                          addLog('Komut hatası: ' + data.message, 'error');
                      }
                  })
                  .catch(error => {
                      addLog('Komut gönderme hatası: ' + error, 'error');
                  });
              }
          }
          
          function loadDevices() {
              fetch('/api/devices')
                  .then(response => response.json())
                  .then(data => {
                      if (data.success) {
                          updateDevices(data.devices);
                          updateStats(data);
                          addLog('Cihaz listesi yenilendi', 'info');
                      }
                  })
                  .catch(error => {
                      addLog('Cihaz listesi yüklenemedi: ' + error, 'error');
                  });
          }
          
          function testWebSocket() {
              addLog('WebSocket bağlantısı test ediliyor...', 'info');
              const testWs = new WebSocket('ws://' + window.location.host);
              
              testWs.onopen = function() {
                  addLog('WebSocket test: Bağlantı başarılı!', 'success');
                  testWs.close();
              };
              
              testWs.onerror = function() {
                  addLog('WebSocket test: Bağlantı başarısız!', 'error');
              };
              
              testWs.onclose = function() {
                  addLog('WebSocket test tamamlandı', 'info');
              };
          }
          
          // Sayfa yüklendiğinde
          window.onload = function() {
              connectDashboardWebSocket();
              addLog('SatWeb Connect Dashboard başlatıldı', 'success');
              
              // Başlangıçta cihazları yükle
              loadDevices();
              
              // Her 30 saniyede bir cihaz listesini yenile
              setInterval(loadDevices, 30000);
          };
      </script>
  </body>
  </html>
  `);
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('🚀 SatWeb Connect sunucusu ' + PORT + ' portunda çalışıyor');
  console.log('🌐 ESP32 WebSocket: ws://localhost:' + PORT);
  console.log('📊 Dashboard WebSocket: ws://localhost:' + PORT + '/dashboard');
  console.log('🖥️  Dashboard: http://localhost:' + PORT);
  console.log('🔧 API: http://localhost:' + PORT + '/api/status');
});