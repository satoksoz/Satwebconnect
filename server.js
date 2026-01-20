const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Cihaz depolama
const devices = new Map();
const deviceStatus = new Map();

// WebSocket bağlantı yönetimi
wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');
    
    // URL'den device ID'yi al
    const url = req.url;
    const params = new URLSearchParams(url.split('?')[1]);
    const deviceId = params.get('deviceId');
    
    console.log('Connection attempt with deviceId:', deviceId);
    
    if (!deviceId || !deviceId.startsWith('Sat_')) {
        console.log('Invalid Device ID');
        ws.close(1008, 'Invalid Device ID');
        return;
    }
    
    console.log(`Device connected: ${deviceId}`);
    
    // Cihazı kaydet
    devices.set(deviceId, ws);
    deviceStatus.set(deviceId, {
        lastSeen: Date.now(),
        connected: true,
        ip: req.socket.remoteAddress,
        deviceId: deviceId
    });
    
    // Ping-pong mekanizması
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, 30000);
    
    // Mesaj işleme
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'hello') {
                console.log(`Hello from device: ${deviceId}`);
                // Cihaz durumunu güncelle
                deviceStatus.get(deviceId).lastSeen = Date.now();
                deviceStatus.get(deviceId).connected = true;
            }
            else if (message.type === 'pong') {
                deviceStatus.get(deviceId).lastSeen = Date.now();
                console.log(`Pong from device: ${deviceId}`);
            }
            else if (message.type === 'response') {
                // ESP32'den gelen HTML yanıtını işle
                const pendingReq = pendingRequests.get(message.requestId);
                if (pendingReq) {
                    pendingRequests.delete(message.requestId);
                    
                    if (message.status === 200) {
                        pendingReq.res
                            .status(200)
                            .set('Content-Type', message.contentType || 'text/html')
                            .send(message.body);
                    } else {
                        pendingReq.res.status(404).send('Page not found');
                    }
                }
            }
        } catch (error) {
            console.error('Message processing error:', error);
        }
    });
    
    ws.on('pong', () => {
        deviceStatus.get(deviceId).lastSeen = Date.now();
        deviceStatus.get(deviceId).connected = true;
    });
    
    ws.on('close', () => {
        console.log(`Device connection closed: ${deviceId}`);
        clearInterval(pingInterval);
        devices.delete(deviceId);
        const status = deviceStatus.get(deviceId);
        if (status) {
            status.connected = false;
        }
    });
    
    ws.on('error', (error) => {
        console.error(`WebSocket error (${deviceId}):`, error);
        clearInterval(pingInterval);
    });
});

// Bekleyen istekleri sakla
const pendingRequests = new Map();
let requestCounter = 0;

// Dashboard ana sayfası
app.get('/', (req, res) => {
    const onlineDevices = [];
    
    deviceStatus.forEach((status, deviceId) => {
        const isOnline = status.connected && 
                        (Date.now() - status.lastSeen) < 60000;
        
        if (isOnline) {
            onlineDevices.push({
                deviceId,
                lastSeen: status.lastSeen,
                ip: status.ip
            });
        }
    });
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>SAT Web Connect - Dashboard</title>
        <style>
            body { font-family: Arial; padding: 20px; }
            .device { 
                border: 1px solid #ddd; 
                padding: 15px; 
                margin: 10px 0; 
                border-radius: 5px;
                background: #f9f9f9;
            }
            .online { border-left: 5px solid green; }
            .offline { border-left: 5px solid red; }
        </style>
    </head>
    <body>
        <h1>SAT Web Connect Dashboard</h1>
        <p>Total connected devices: ${onlineDevices.length}</p>
    `;
    
    if (onlineDevices.length === 0) {
        html += `<p>No devices online.</p>`;
    } else {
        onlineDevices.forEach(device => {
            html += `
            <div class="device online">
                <h3>${device.deviceId}</h3>
                <p>IP: ${device.ip}</p>
                <p>Last seen: ${new Date(device.lastSeen).toLocaleString()}</p>
                <a href="/${device.deviceId}" target="_blank">Access Device</a>
            </div>`;
        });
    }
    
    html += `
        <script>
            // Auto refresh every 10 seconds
            setTimeout(() => location.reload(), 10000);
        </script>
    </body>
    </html>`;
    
    res.send(html);
});

// Cihaz erişimi
app.get('/:deviceId/*', async (req, res) => {
    const deviceId = req.params.deviceId;
    const filePath = req.params[0] || 'index.html';
    
    console.log(`Request: ${deviceId} -> ${filePath}`);
    
    // Cihaz çevrimiçi mi kontrol et
    const deviceWs = devices.get(deviceId);
    const deviceStatusEntry = deviceStatus.get(deviceId);
    
    const isOnline = deviceStatusEntry && 
                    deviceStatusEntry.connected && 
                    (Date.now() - deviceStatusEntry.lastSeen) < 60000;
    
    if (!isOnline || !deviceWs || deviceWs.readyState !== WebSocket.OPEN) {
        return res.status(503).send(`
            <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>🔴 Device Offline</h1>
                    <p><strong>${deviceId}</strong> is currently offline.</p>
                    <p>Please ensure the device is connected to the internet.</p>
                    <a href="/">← Back to Dashboard</a>
                </body>
            </html>
        `);
    }
    
    // Request ID oluştur
    const requestId = `req_${Date.now()}_${++requestCounter}`;
    
    // ESP32'ye isteği gönder
    const requestMessage = {
        type: 'request',
        requestId: requestId,
        method: 'GET',
        path: filePath
    };
    
    try {
        deviceWs.send(JSON.stringify(requestMessage));
        
        // Yanıt için promise oluştur
        const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(requestId);
                reject(new Error('Timeout: Device did not respond'));
            }, 10000);
            
            pendingRequests.set(requestId, {
                res: res,
                timeout: timeout,
                resolve: resolve,
                reject: reject
            });
        });
        
        await responsePromise;
        
    } catch (error) {
        console.error('Request processing error:', error);
        res.status(504).send('Gateway Timeout: Device did not respond');
    }
});

// Cihaz ana sayfası
app.get('/:deviceId', (req, res) => {
    res.redirect(`/${req.params.deviceId}/index.html`);
});

// Sağlık kontrolü
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        deviceCount: devices.size,
        timestamp: new Date().toISOString()
    });
});

// API: Çevrimiçi cihazları listele
app.get('/api/devices', (req, res) => {
    const onlineDevices = [];
    
    deviceStatus.forEach((status, deviceId) => {
        const isOnline = status.connected && 
                        (Date.now() - status.lastSeen) < 60000;
        
        onlineDevices.push({
            deviceId,
            online: isOnline,
            lastSeen: status.lastSeen,
            ip: status.ip,
            connected: status.connected
        });
    });
    
    res.json(onlineDevices);
});

// Zaman aşımı temizleyici
setInterval(() => {
    const now = Date.now();
    
    // Bekleyen istekleri kontrol et
    pendingRequests.forEach((value, key) => {
        if (value.timeout._idleStart && (now - value.timeout._idleStart) > 10000) {
            value.res.status(504).send('Gateway Timeout');
            pendingRequests.delete(key);
        }
    });
    
    // Eski cihazları temizle
    deviceStatus.forEach((status, deviceId) => {
        if (now - status.lastSeen > 120000) { // 2 dakikadan eski
            console.log(`Cleaning up old device: ${deviceId}`);
            devices.delete(deviceId);
            deviceStatus.delete(deviceId);
        }
    });
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
});