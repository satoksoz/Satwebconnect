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
          rssi: data.rssi || 0
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
          
          // Dashboard'a heartbeat bildir
          broadcastToDashboard({
            type: 'device_heartbeat',
            device_id: deviceId,
            uptime: data.uptime,
            rssi: data.rssi,
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
  const { device_id, command } = req