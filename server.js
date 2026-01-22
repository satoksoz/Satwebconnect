const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();

// Memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
    }
});

// Memory'de saklanacak veriler
let devices = [];
let otaJobs = {};
let firmwareFiles = {};
let deviceStates = {};

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Reverse Proxy için yardımcı fonksiyon
async function proxyRequest(targetUrl, req, res) {
    return new Promise((resolve, reject) => {
        // URL'i parse et
        let targetHostname, targetPort, targetPath;
        
        try {
            const url = new URL(targetUrl);
            targetHostname = url.hostname;
            targetPort = url.port || 80;
            targetPath = url.pathname + url.search;
        } catch (error) {
            // http:// ile başlamıyorsa ekle
            if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                targetUrl = 'http://' + targetUrl;
            }
            const url = new URL(targetUrl);
            targetHostname = url.hostname;
            targetPort = url.port || 80;
            targetPath = url.pathname + url.search;
        }
        
        const options = {
            hostname: targetHostname,
            port: targetPort,
            path: targetPath,
            method: req.method,
            headers: {
                ...req.headers,
                host: targetHostname,
                'x-forwarded-for': req.ip,
                'x-forwarded-host': req.get('host'),
                'x-forwarded-proto': req.protocol
            },
            timeout: 10000
        };

        const proxyReq = http.request(options, (proxyRes) => {
            // Headers'ı kopyala
            const headersToCopy = {};
            Object.keys(proxyRes.headers).forEach(key => {
                // Bazı headers'ı değiştir veya çıkar
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'content-length') {
                    // Content-Length'i yeniden hesapla
                    return;
                }
                if (lowerKey === 'location') {
                    // Location header'ını rewrite et
                    const location = proxyRes.headers[key];
                    if (location.startsWith('http://' + targetHostname)) {
                        headersToCopy[key] = location.replace(
                            `http://${targetHostname}`, 
                            `${req.protocol}://${req.get('host')}/device/${req.params.deviceId}/local`
                        );
                    } else {
                        headersToCopy[key] = location;
                    }
                    return;
                }
                headersToCopy[key] = proxyRes.headers[key];
            });
            
            // CORS headers ekle
            headersToCopy['Access-Control-Allow-Origin'] = '*';
            headersToCopy['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
            headersToCopy['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
            
            res.writeHead(proxyRes.statusCode, headersToCopy);
            
            // Stream veriyi
            proxyRes.pipe(res);
            
            proxyRes.on('end', () => {
                resolve();
            });
        });

        proxyReq.on('error', (err) => {
            console.error('Proxy error:', err);
            reject(err);
        });
        
        proxyReq.on('timeout', () => {
            console.error('Proxy timeout:', targetUrl);
            proxyReq.destroy();
            reject(new Error('Proxy timeout'));
        });

        // Request body varsa gönder
        if (req.body && Object.keys(req.body).length > 0) {
            proxyReq.write(JSON.stringify(req.body));
        }
        
        proxyReq.end();
    });
}

// ESP32 Local Proxy için özel fonksiyon
async function proxyESP32Local(deviceIp, req, res) {
    return new Promise((resolve, reject) => {
        const targetPath = req.params[0] || '';
        const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        const fullPath = '/' + targetPath + queryString;
        
        console.log(`🔗 ESP32 Proxy: ${deviceIp}${fullPath}`);
        
        const options = {
            hostname: deviceIp,
            port: 80,
            path: fullPath,
            method: req.method,
            headers: {
                ...req.headers,
                host: deviceIp,
                'x-forwarded-for': req.ip,
                'x-forwarded-host': req.get('host'),
                'x-forwarded-proto': req.protocol,
                'User-Agent': 'ESP32-Dashboard-Proxy/1.0'
            },
            timeout: 8000
        };

        const proxyReq = http.request(options, (proxyRes) => {
            // Headers'ı kopyala
            const headersToCopy = {};
            Object.keys(proxyRes.headers).forEach(key => {
                const lowerKey = key.toLowerCase();
                
                // Location header'ını rewrite et
                if (lowerKey === 'location') {
                    const location = proxyRes.headers[key];
                    if (location.startsWith('http://' + deviceIp) || 
                        location.startsWith('//' + deviceIp) ||
                        location.startsWith('/')) {
                        
                        // Relative URL'leri absolute yap
                        let newLocation;
                        if (location.startsWith('http://' + deviceIp)) {
                            newLocation = location.replace(
                                `http://${deviceIp}`, 
                                `/device/${req.params.deviceId}/local`
                            );
                        } else if (location.startsWith('//' + deviceIp)) {
                            newLocation = location.replace(
                                `//${deviceIp}`, 
                                `/device/${req.params.deviceId}/local`
                            );
                        } else if (location.startsWith('/')) {
                            newLocation = `/device/${req.params.deviceId}/local${location}`;
                        } else {
                            newLocation = location;
                        }
                        headersToCopy[key] = newLocation;
                    } else {
                        headersToCopy[key] = location;
                    }
                    return;
                }
                
                // Content-Type koru
                if (lowerKey === 'content-type') {
                    headersToCopy[key] = proxyRes.headers[key];
                    return;
                }
                
                // Diğer headers
                headersToCopy[key] = proxyRes.headers[key];
            });
            
            // CORS headers ekle
            headersToCopy['Access-Control-Allow-Origin'] = '*';
            headersToCopy['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
            headersToCopy['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
            
            res.writeHead(proxyRes.statusCode, headersToCopy);
            
            // Stream veriyi
            proxyRes.pipe(res);
            
            proxyRes.on('end', () => {
                resolve();
            });
        });

        proxyReq.on('error', (err) => {
            console.error('ESP32 Proxy error:', err);
            reject(err);
        });
        
        proxyReq.on('timeout', () => {
            console.error('ESP32 Proxy timeout:', deviceIp);
            proxyReq.destroy();
            reject(new Error('ESP32 connection timeout'));
        });

        // Request body varsa gönder
        if (req.body && Object.keys(req.body).length > 0 && req.method !== 'GET') {
            if (typeof req.body === 'object') {
                proxyReq.write(JSON.stringify(req.body));
            } else {
                proxyReq.write(req.body);
            }
        } else if (req.method === 'POST' || req.method === 'PUT') {
            // Boş body için
            proxyReq.write('');
        }
        
        proxyReq.end();
    });
}

// Ana sayfa
app.get('/', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>ESP32 Dashboard</title>
            <style>
                body { font-family:Arial; padding:20px; text-align:center; background:#f0f2f5; }
                .btn { padding:10px 20px; background:#4CAF50; color:white; text-decoration:none; border-radius:5px; margin:5px; }
                .card { background:white; padding:30px; border-radius:10px; max-width:600px; margin:20px auto; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>📱 ESP32 Dashboard</h1>
                <p>Çevrimiçi: ${onlineCount} / Toplam: ${devices.length} cihaz</p>
                <a href="/dashboard" class="btn">Dashboard'a Git</a>
                <a href="/api/devices" target="_blank" class="btn">API Test</a>
                <a href="/debug" class="btn" style="background:#FF9800;">Debug</a>
            </div>
        </body>
        </html>
    `);
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ESP32 Yerel Arayüz Proxy
app.all('/device/:deviceId/local/*', async (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    const deviceState = deviceStates[deviceId] || {};
    const deviceIp = deviceState.ipAddress;
    
    if (!deviceIp) {
        return res.status(400).json({ 
            error: 'Cihaz IP adresi bilinmiyor',
            deviceId: deviceId
        });
    }
    
    try {
        await proxyESP32Local(deviceIp, req, res);
    } catch (error) {
        console.error('ESP32 Local Proxy error:', error);
        res.status(502).json({ 
            error: 'ESP32 bağlantı hatası',
            message: error.message,
            deviceIp: deviceIp
        });
    }
});

// ESP32 Yerel Arayüz Ana Sayfa
app.get('/device/:deviceId/local', async (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) {
        return res.status(404).send('Cihaz bulunamadı');
    }
    
    const deviceState = deviceStates[deviceId] || {};
    const deviceIp = deviceState.ipAddress;
    
    if (!deviceIp) {
        return res.status(400).send('Cihaz IP adresi bilinmiyor');
    }
    
    try {
        await proxyESP32Local(deviceIp, req, res);
    } catch (error) {
        console.error('ESP32 Local error:', error);
        
        // Fallback HTML sayfası
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${device.name} - ESP32 Yerel Arayüz</title>
                <style>
                    body { font-family: Arial; padding: 40px; text-align: center; background: #f5f5f5; }
                    .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
                    h1 { color: #333; }
                    .error { background: #ffebee; color: #c62828; padding: 15px; border-radius: 8px; margin: 20px 0; }
                    .btn { display: inline-block; padding: 10px 20px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>${device.name} - Yerel Arayüz</h1>
                    <div class="error">
                        <h3>❌ ESP32 Bağlantı Hatası</h3>
                        <p>ESP32 cihazına bağlanılamadı.</p>
                        <p><strong>Hata:</strong> ${error.message}</p>
                        <p><strong>IP Adresi:</strong> ${deviceIp}</p>
                    </div>
                    <div>
                        <a href="http://${deviceIp}" class="btn" target="_blank">Doğrudan Erişim</a>
                        <a href="/dashboard" class="btn">Dashboard'a Dön</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
});

// /device/:id/html endpoint'i - ESP32'nin kendi HTML sayfasını göster
app.get('/device/:deviceId/html', async (req, res) => {
    const deviceId = req.params.deviceId;
    
    console.log(`📄 HTML endpoint çağrıldı: ${deviceId}`);
    console.log(`📊 Mevcut cihazlar:`, devices.map(d => ({ id: d.id, name: d.name })));
    
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) {
        console.log(`❌ Cihaz bulunamadı: ${deviceId}`);
        // Hata yerine dashboard sayfasına yönlendir
        return res.redirect(`/device/${deviceId}`);
    }
    
    const deviceState = deviceStates[deviceId] || {};
    const deviceIp = deviceState.ipAddress;
    
    if (!deviceIp) {
        console.log(`❌ Cihaz IP adresi bilinmiyor: ${deviceId}`);
        // Dashboard sayfasına yönlendir
        return res.redirect(`/device/${deviceId}`);
    }
    
    try {
        // ESP32'nin ana sayfasına proxy yap
        const targetUrl = `http://${deviceIp}/`;
        
        console.log(`📡 ESP32 HTML Proxy: ${deviceId} -> ${targetUrl}`);
        
        // HTTP isteği yap
        return new Promise((resolve, reject) => {
            const options = {
                hostname: deviceIp,
                port: 80,
                path: '/',
                method: 'GET',
                timeout: 8000,
                headers: {
                    'User-Agent': 'ESP32-Dashboard-Proxy/1.0',
                    'Accept': 'text/html',
                    'Accept-Language': 'tr,en;q=0.9',
                    'Cache-Control': 'no-cache'
                }
            };
            
            const proxyReq = http.request(options, (proxyRes) => {
                let htmlContent = '';
                
                proxyRes.on('data', (chunk) => {
                    htmlContent += chunk.toString();
                });
                
                proxyRes.on('end', () => {
                    try {
                        // HTML içeriğini değiştir (base URL'leri düzelt)
                        let modifiedHtml = htmlContent
                            .replace(/href="\//g, `href="/device/${deviceId}/html/`)
                            .replace(/src="\//g, `src="/device/${deviceId}/html/`)
                            .replace(/action="\//g, `action="/device/${deviceId}/html/`)
                            .replace(/url\('\//g, `url('/device/${deviceId}/html/`)
                            .replace(/url\("\//g, `url("/device/${deviceId}/html/`);
                        
                        // Dashboard linkini değiştir
                        modifiedHtml = modifiedHtml.replace(
                            /href="https:\/\/satwebconnect\.onrender\.com\/dashboard"/g,
                            'href="/dashboard" target="_blank"'
                        );
                        
                        // ESP32'nin kendi dashboard linklerini değiştir
                        modifiedHtml = modifiedHtml.replace(
                            /href="https:\/\/satwebconnect\.onrender\.com\/device\/[^"]+"/g,
                            (match) => {
                                return match.replace('https://satwebconnect.onrender.com', '');
                            }
                        );
                        
                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('X-Device-ID', deviceId);
                        res.setHeader('X-Device-IP', deviceIp);
                        res.send(modifiedHtml);
                        console.log(`✅ HTML proxy başarılı: ${deviceId}`);
                        resolve();
                    } catch (error) {
                        console.error('HTML processing error:', error);
                        // Fallback: direkt dashboard sayfasına yönlendir
                        res.redirect(`/device/${deviceId}`);
                        resolve();
                    }
                });
            });
            
            proxyReq.on('error', (err) => {
                console.error('HTML proxy connection error:', err);
                // Fallback: dashboard sayfasına yönlendir
                res.redirect(`/device/${deviceId}`);
                resolve();
            });
            
            proxyReq.on('timeout', () => {
                console.error('HTML proxy timeout:', deviceIp);
                proxyReq.destroy();
                // Fallback: dashboard sayfasına yönlendir
                res.redirect(`/device/${deviceId}`);
                resolve();
            });
            
            proxyReq.end();
        });
        
    } catch (error) {
        console.error('HTML endpoint error:', error);
        // Dashboard sayfasına yönlendir
        res.redirect(`/device/${deviceId}`);
    }
});

// /device/:id/html/ altındaki tüm yollar için proxy
app.all('/device/:deviceId/html/*', async (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    const deviceState = deviceStates[deviceId] || {};
    const deviceIp = deviceState.ipAddress;
    
    if (!deviceIp) {
        return res.status(400).json({ 
            error: 'Cihaz IP adresi bilinmiyor',
            deviceId: deviceId
        });
    }
    
    const originalPath = req.params[0] || '';
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const targetPath = '/' + originalPath + queryString;
    
    console.log(`📄 HTML Proxy Subpath: ${deviceIp}${targetPath}`);
    
    try {
        await proxyESP32Local(deviceIp, req, res);
    } catch (error) {
        console.error('HTML proxy error:', error);
        res.status(502).json({ 
            error: 'ESP32 bağlantı hatası',
            message: error.message
        });
    }
});

// ESP32 Device Info Proxy
app.get('/api/device/proxy-status/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    const deviceState = deviceStates[deviceId] || {};
    const deviceIp = deviceState.ipAddress;
    
    if (!deviceIp) {
        return res.status(400).json({ 
            error: 'Cihaz IP adresi bilinmiyor',
            deviceId: deviceId
        });
    }
    
    try {
        // ESP32'nin /api/status endpoint'ini çağır
        const targetUrl = `http://${deviceIp}/api/status`;
        
        // HTTP isteği yap
        return new Promise((resolve, reject) => {
            const options = {
                hostname: deviceIp,
                port: 80,
                path: '/api/status',
                method: 'GET',
                timeout: 5000,
                headers: {
                    'User-Agent': 'ESP32-Dashboard/1.0',
                    'Accept': 'application/json'
                }
            };
            
            const proxyReq = http.request(options, (proxyRes) => {
                let data = '';
                
                proxyRes.on('data', (chunk) => {
                    data += chunk;
                });
                
                proxyRes.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        // ESP32 verilerini dashboard formatına çevir
                        const response = {
                            deviceId: deviceId,
                            deviceName: device.name,
                            online: (Date.now() - device.lastSeen) < 30000,
                            lastSeen: device.lastSeen,
                            ipAddress: deviceIp,
                            temperature: jsonData.temperature || 25.0,
                            ledState: jsonData.ledState || false,
                            freeHeap: jsonData.freeHeap || 0,
                            uptime: jsonData.uptime || 0,
                            rssi: jsonData.rssi || 0,
                            firmwareVersion: jsonData.firmwareVersion || '1.0.0',
                            directConnection: true,
                            timestamp: Date.now()
                        };
                        
                        res.json(response);
                        resolve();
                    } catch (error) {
                        console.error('JSON parse error:', error);
                        // Fallback response
                        res.json({
                            deviceId: deviceId,
                            deviceName: device.name,
                            online: (Date.now() - device.lastSeen) < 30000,
                            lastSeen: device.lastSeen,
                            ipAddress: deviceIp,
                            message: 'ESP32 connected but JSON parse failed',
                            directConnection: false,
                            timestamp: Date.now()
                        });
                        resolve();
                    }
                });
            });
            
            proxyReq.on('error', (err) => {
                console.error('Proxy connection error:', err);
                // Fallback: local state'i döndür
                res.json({
                    deviceId: deviceId,
                    deviceName: device.name,
                    online: (Date.now() - device.lastSeen) < 30000,
                    lastSeen: device.lastSeen,
                    ipAddress: deviceIp,
                    message: 'ESP32 direct connection failed, using cached data',
                    cached: true,
                    timestamp: Date.now()
                });
                resolve();
            });
            
            proxyReq.on('timeout', () => {
                console.error('Proxy timeout');
                proxyReq.destroy();
                res.json({
                    deviceId: deviceId,
                    deviceName: device.name,
                    online: (Date.now() - device.lastSeen) < 30000,
                    lastSeen: device.lastSeen,
                    ipAddress: deviceIp,
                    message: 'ESP32 connection timeout',
                    timeout: true,
                    timestamp: Date.now()
                });
                resolve();
            });
            
            proxyReq.end();
        });
        
    } catch (error) {
        console.error('Proxy status error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Cihaz detay sayfası
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    const deviceState = deviceStates[deviceId] || { ipAddress: null };
    
    if (!device) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Cihaz Bulunamadı</title></head>
            <body style="font-family:Arial; padding:40px; text-align:center;">
                <h1 style="color:#f44336;">❌ Cihaz Bulunamadı</h1>
                <p><strong>${deviceId}</strong> ID'li cihaz bulunamadı.</p>
                <a href="/dashboard" style="padding:10px 20px; background:#4CAF50; color:white; text-decoration:none; border-radius:5px;">
                    Dashboard'a Dön
                </a>
            </body>
            </html>
        `);
    }
    
    const isOnline = (Date.now() - device.lastSeen) < 30000;
    const otaJob = otaJobs[deviceId];
    const firmwareFile = firmwareFiles[deviceId];
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${device.name} - Cihaz Detayı</title>
            <style>
                body { font-family: Arial; padding: 20px; background: #f5f5f5; }
                .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
                h1 { color: #333; }
                .status { padding: 5px 15px; border-radius: 20px; color: white; font-weight: bold; display: inline-block; }
                .online { background: #4CAF50; }
                .offline { background: #f44336; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
                .info-card { background: #f8f9fa; padding: 15px; border-radius: 8px; }
                .btn { padding: 10px 20px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 5px; display: inline-block; }
                .iframe-container { width: 100%; height: 700px; border: 1px solid #ddd; border-radius: 8px; margin: 20px 0; overflow: hidden; }
                iframe { width: 100%; height: 100%; border: none; }
                .tab-container { margin: 20px 0; }
                .tab { overflow: hidden; border: 1px solid #ccc; background-color: #f1f1f1; border-radius: 8px 8px 0 0; }
                .tab button { background-color: inherit; float: left; border: none; outline: none; cursor: pointer; padding: 14px 16px; transition: 0.3s; font-size: 16px; }
                .tab button:hover { background-color: #ddd; }
                .tab button.active { background-color: #fff; font-weight: bold; }
                .tabcontent { display: none; padding: 20px; border: 1px solid #ccc; border-top: none; border-radius: 0 0 8px 8px; }
            </style>
            <script>
                function openTab(evt, tabName) {
                    var i, tabcontent, tablinks;
                    tabcontent = document.getElementsByClassName("tabcontent");
                    for (i = 0; i < tabcontent.length; i++) {
                        tabcontent[i].style.display = "none";
                    }
                    tablinks = document.getElementsByClassName("tablinks");
                    for (i = 0; i < tablinks.length; i++) {
                        tablinks[i].className = tablinks[i].className.replace(" active", "");
                    }
                    document.getElementById(tabName).style.display = "block";
                    evt.currentTarget.className += " active";
                    
                    // İframe'i yenile
                    if (tabName === 'localInterface') {
                        document.getElementById('esp32Iframe').src = document.getElementById('esp32Iframe').src;
                    }
                }
                
                // Varsayılan olarak yerel arayüz sekmesini aç
                document.addEventListener('DOMContentLoaded', function() {
                    document.getElementById('localInterface').style.display = 'block';
                    document.querySelector('.tablinks').className += ' active';
                });
            </script>
        </head>
        <body>
            <div class="container">
                <h1>${device.name}</h1>
                <span class="status ${isOnline ? 'online' : 'offline'}">
                    ${isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}
                </span>
                
                <div class="tab-container">
                    <div class="tab">
                        <button class="tablinks" onclick="openTab(event, 'localInterface')">🏠 Yerel Arayüz</button>
                        <button class="tablinks" onclick="openTab(event, 'deviceInfo')">📊 Cihaz Bilgileri</button>
                        <button class="tablinks" onclick="openTab(event, 'otaControl')">⚡ OTA Kontrol</button>
                    </div>
                    
                    <div id="localInterface" class="tabcontent">
                        <h3>ESP32 Yerel Kontrol Paneli</h3>
                        <div class="iframe-container">
                            <iframe id="esp32Iframe" src="/device/${deviceId}/local" title="${device.name} Yerel Arayüz"></iframe>
                        </div>
                        <div style="margin-top: 10px;">
                            <button onclick="document.getElementById('esp32Iframe').src = document.getElementById('esp32Iframe').src" 
                                    class="btn" style="background:#4CAF50;">
                                🔄 Yenile
                            </button>
                            <a href="/device/${deviceId}/local" target="_blank" class="btn">🔄 Yeni Sekmede Aç</a>
                            <a href="http://${deviceState.ipAddress}" target="_blank" class="btn">🔗 Doğrudan Erişim</a>
                        </div>
                    </div>
                    
                    <div id="deviceInfo" class="tabcontent">
                        <div class="info-grid">
                            <div class="info-card">
                                <h3>📊 Cihaz Bilgileri</h3>
                                <p><strong>ID:</strong> ${device.id}</p>
                                <p><strong>İsim:</strong> ${device.name}</p>
                                <p><strong>Firmware:</strong> ${device.firmwareVersion || '1.0.0'}</p>
                                <p><strong>IP:</strong> ${deviceState.ipAddress || 'Bilinmiyor'}</p>
                                <p><strong>Port:</strong> ${deviceState.port || 80}</p>
                            </div>
                            
                            <div class="info-card">
                                <h3>🌐 Durum</h3>
                                <p><strong>Son Görülme:</strong> ${new Date(device.lastSeen).toLocaleString()}</p>
                                <p><strong>OTA:</strong> ${otaJob?.active ? 'Aktif' : 'Aktif Değil'}</p>
                                <p><strong>Kayıt Tarihi:</strong> ${new Date(device.registeredAt || Date.now()).toLocaleString()}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div id="otaControl" class="tabcontent">
                        <h3>⚡ OTA Güncelleme</h3>
                        <div class="info-card">
                            <p><strong>OTA Durumu:</strong> ${otaJob?.active ? '🟡 Aktif' : '🟢 Hazır'}</p>
                            ${otaJob?.active ? `
                                <p><strong>Progress:</strong> ${otaJob.progress || 0}%</p>
                                <p><strong>Başlangıç:</strong> ${new Date(otaJob.startedAt).toLocaleString()}</p>
                            ` : ''}
                            ${firmwareFile ? `
                                <p><strong>Firmware:</strong> ${firmwareFile.name} (${Math.round(firmwareFile.size / 1024)} KB)</p>
                            ` : '<p>Yüklenmiş firmware dosyası yok</p>'}
                            
                            <div style="margin-top: 20px;">
                                <a href="/api/ota/status/${deviceId}" target="_blank" class="btn">📊 OTA Durumu</a>
                                <a href="/dashboard" class="btn">📋 Dashboard OTA</a>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div style="margin-top: 20px;">
                    <a href="/dashboard" class="btn">📊 Dashboard</a>
                    <a href="/debug" class="btn" style="background:#FF9800;">🔧 Debug</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Debug sayfası
app.get('/debug', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Debug - ESP32 Dashboard</title>
            <style>
                body { font-family:Arial; padding:20px; background:#f0f2f5; }
                .card { background:white; padding:20px; border-radius:10px; margin:10px 0; }
                pre { background:#f5f5f5; padding:10px; border-radius:5px; overflow:auto; }
                .btn { padding:10px 15px; background:#2196F3; color:white; text-decoration:none; border-radius:5px; margin:5px; display:inline-block; }
                .device-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; }
                .device-item { border: 1px solid #ddd; padding: 15px; border-radius: 8px; }
            </style>
        </head>
        <body>
            <h1>🔧 Debug Panel</h1>
            
            <div style="margin-bottom:20px;">
                <a href="/" class="btn">🏠 Ana Sayfa</a>
                <a href="/dashboard" class="btn">📊 Dashboard</a>
                <a href="/api/debug/json" class="btn">📋 JSON Data</a>
            </div>
            
            <div class="card">
                <h3>📊 İstatistikler</h3>
                <p>Toplam Cihaz: ${devices.length}</p>
                <p>Çevrimiçi Cihaz: ${onlineCount}</p>
                <p>OTA Jobs: ${Object.keys(otaJobs).length}</p>
                <p>Firmware Dosyaları: ${Object.keys(firmwareFiles).length}</p>
                <p>Aktif Proxyler: ${Object.keys(deviceStates).filter(id => deviceStates[id].ipAddress).length}</p>
            </div>
            
            <div class="card">
                <h3>📋 Cihazlar</h3>
                <div class="device-list">
                ${devices.length > 0 ? devices.map(d => {
                    const state = deviceStates[d.id] || {};
                    const isOnline = (Date.now() - d.lastSeen) < 30000;
                    return `
                    <div class="device-item">
                        <strong>${d.name}</strong> (${d.id})<br>
                        <small>IP: ${state.ipAddress || 'Bilinmiyor'}:${state.port || 80}</small><br>
                        <span style="color: ${isOnline ? '#4CAF50' : '#f44336'};">
                            ${isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}
                        </span><br>
                        <div style="margin-top: 10px;">
                            <a href="/device/${d.id}" class="btn" style="background:#4CAF50; padding:5px 10px; font-size:12px;">Detay</a>
                            <a href="/device/${d.id}/local" class="btn" style="background:#2196F3; padding:5px 10px; font-size:12px;">Yerel Arayüz</a>
                            <a href="http://${state.ipAddress}" class="btn" style="background:#FF9800; padding:5px 10px; font-size:12px;" target="_blank">Doğrudan</a>
                        </div>
                    </div>
                `}).join('') : '<p>Henüz cihaz yok</p>'}
                </div>
            </div>
            
            <div class="card">
                <h3>⚡ OTA Jobs</h3>
                <pre>${JSON.stringify(otaJobs, null, 2)}</pre>
            </div>
            
            <div class="card">
                <h3>🌐 Device States</h3>
                <pre>${JSON.stringify(deviceStates, null, 2)}</pre>
            </div>
        </body>
        </html>
    `);
});

// API: Cihaz durumu
app.get('/api/device/status/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    const deviceState = deviceStates[deviceId];
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    const isOnline = (Date.now() - device.lastSeen) < 30000;
    
    res.json({
        device: device,
        deviceState: deviceState || { ipAddress: null, port: 80 },
        online: isOnline,
        lastSeenAgo: Math.round((Date.now() - device.lastSeen) / 1000),
        otaActive: otaJobs[deviceId]?.active || false,
        otaProgress: otaJobs[deviceId]?.progress || 0,
        hasFirmware: !!firmwareFiles[deviceId]
    });
});

// API: Çevrimiçi cihazları getir
app.get('/api/devices', (req, res) => {
    const now = Date.now();
    
    const onlineDevices = devices
        .filter(device => (now - device.lastSeen) < 30000)
        .map(device => {
            const deviceState = deviceStates[device.id] || { ipAddress: null, port: 80 };
            
            return {
                ...device,
                online: true,
                lastSeenAgo: Math.round((now - device.lastSeen) / 1000),
                otaActive: otaJobs[device.id]?.active || false,
                otaProgress: otaJobs[device.id]?.progress || 0,
                hasFirmware: !!firmwareFiles[device.id],
                ipAddress: deviceState.ipAddress,
                port: deviceState.port || 80
            };
        });
    
    res.json(onlineDevices);
});

// API: Cihaz kaydı
app.post('/api/register', (req, res) => {
    const { deviceId, deviceName = 'ESP32', firmwareVersion = '1.0.0', 
            ipAddress = null, port = 80 } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    let device = devices.find(d => d.id === deviceId);
    
    if (device) {
        // Güncelle
        device.lastSeen = Date.now();
        device.name = deviceName || device.name;
        device.firmwareVersion = firmwareVersion || device.firmwareVersion;
    } else {
        // Yeni cihaz
        device = {
            id: deviceId,
            name: deviceName,
            lastSeen: Date.now(),
            online: true,
            firmwareVersion: firmwareVersion,
            registeredAt: Date.now()
        };
        devices.push(device);
    }
    
    // Cihaz durumunu güncelle
    deviceStates[deviceId] = {
        ipAddress: ipAddress,
        port: port,
        lastUpdate: Date.now()
    };
    
    console.log(`✅ Cihaz kaydedildi: ${deviceId} - ${device.name} - IP: ${ipAddress}:${port}`);
    
    res.json({ 
        success: true, 
        device: device,
        deviceState: deviceStates[deviceId],
        totalDevices: devices.length 
    });
});

// API: OTA için dosya yükleme
app.post('/api/ota/upload', upload.single('firmware'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Dosya yüklenmedi' });
    }
    
    const { deviceId } = req.body;
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    if (!req.file.originalname.toLowerCase().endsWith('.bin')) {
        return res.status(400).json({ error: 'Sadece .bin uzantılı dosyalar yüklenebilir' });
    }
    
    // Eski OTA job'ını temizle
    if (otaJobs[deviceId]) {
        otaJobs[deviceId].active = false;
        otaJobs[deviceId].progress = 0;
        console.log(`♻️ Eski OTA job temizlendi: ${deviceId}`);
    }
    
    // Firmware dosyasını memory'de sakla
    firmwareFiles[deviceId] = {
        buffer: req.file.buffer,
        name: req.file.originalname,
        size: req.file.size,
        uploadedAt: Date.now(),
        mimetype: req.file.mimetype
    };
    
    // OTA job oluştur
    otaJobs[deviceId] = {
        active: false,
        progress: 0,
        startedAt: null,
        completedAt: null,
        file: {
            name: req.file.originalname,
            size: req.file.size
        }
    };
    
    console.log(`📁 Firmware memory'ye kaydedildi: ${deviceId} - ${req.file.originalname}`);
    
    res.json({
        success: true,
        message: 'Firmware dosyası yüklendi',
        filename: req.file.originalname,
        size: req.file.size,
        deviceId: deviceId,
        downloadUrl: `/api/ota/download/${deviceId}`,
        otaActive: false,
        hasFile: true
    });
});

// API: OTA firmware indirme
app.get('/api/ota/download/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const firmwareFile = firmwareFiles[deviceId];
    
    console.log(`📥 Firmware indirme isteği: ${deviceId}`);
    
    if (!firmwareFile) {
        return res.status(404).json({ error: 'Firmware dosyası bulunamadı' });
    }
    
    try {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${firmwareFile.name}"`);
        res.setHeader('Content-Length', firmwareFile.size);
        
        console.log(`📥 Firmware gönderiliyor: ${deviceId} - ${firmwareFile.name}`);
        
        res.send(firmwareFile.buffer);
        
    } catch (err) {
        console.error(`❌ Firmware indirme hatası: ${err.message}`);
        res.status(500).json({ error: 'Dosya gönderme hatası' });
    }
});

// API: OTA ilerlemesini güncelle
app.post('/api/ota/progress', (req, res) => {
    const { deviceId, progress, status } = req.body;
    
    console.log(`📊 OTA progress: ${deviceId} - %${progress} - ${status}`);
    
    if (!deviceId || progress === undefined) {
        return res.status(400).json({ error: 'Device ID ve progress gerekli' });
    }
    
    if (!otaJobs[deviceId]) {
        otaJobs[deviceId] = {
            active: false,
            progress: 0,
            startedAt: null,
            completedAt: null
        };
    }
    
    otaJobs[deviceId].progress = progress;
    otaJobs[deviceId].active = status !== 'completed' && status !== 'failed';
    
    if (status === 'completed') {
        otaJobs[deviceId].completedAt = Date.now();
        otaJobs[deviceId].active = false;
        console.log(`✅ OTA tamamlandı: ${deviceId}`);
        
        if (firmwareFiles[deviceId]) {
            delete firmwareFiles[deviceId];
            console.log(`🗑️ Firmware dosyası silindi: ${deviceId}`);
        }
    } else if (status === 'failed') {
        otaJobs[deviceId].active = false;
        console.log(`❌ OTA başarısız: ${deviceId}`);
    }
    
    res.json({ 
        success: true,
        deviceId: deviceId,
        progress: progress
    });
});

// API: OTA başlat
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`🚀 OTA başlatma isteği: ${deviceId}`);
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    const device = devices.find(d => d.id === deviceId);
    const firmwareFile = firmwareFiles[deviceId];
    
    if (!device) {
        return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    if (!firmwareFile) {
        return res.status(400).json({ error: 'Önce firmware dosyası yükleyin' });
    }
    
    // OTA'yı aktif et
    otaJobs[deviceId] = {
        active: true,
        progress: 0,
        startedAt: Date.now(),
        completedAt: null,
        file: {
            name: firmwareFile.name,
            size: firmwareFile.size
        }
    };
    
    console.log(`🚀 OTA başlatıldı: ${deviceId} - ${firmwareFile.name}`);
    
    res.json({
        success: true,
        message: 'OTA güncellemesi başlatıldı',
        deviceId: deviceId,
        filename: firmwareFile.name,
        size: firmwareFile.size,
        downloadUrl: `/api/ota/download/${deviceId}`
    });
});

// API: OTA durumu
app.get('/api/ota/status/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const otaJob = otaJobs[deviceId];
    const firmwareFile = firmwareFiles[deviceId];
    
    const response = {
        active: otaJob?.active || false,
        progress: otaJob?.progress || 0,
        hasFile: !!firmwareFile,
        filename: firmwareFile?.name,
        size: firmwareFile?.size,
        startedAt: otaJob?.startedAt,
        completedAt: otaJob?.completedAt,
        downloadUrl: `/api/ota/download/${deviceId}`,
        deviceId: deviceId
    };
    
    res.json(response);
});

// API: OTA iptal
app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`❌ OTA iptal isteği: ${deviceId}`);
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    if (otaJobs[deviceId]) {
        otaJobs[deviceId].active = false;
        otaJobs[deviceId].progress = 0;
        console.log(`❌ OTA iptal edildi: ${deviceId}`);
    }
    
    res.json({
        success: true,
        message: 'OTA iptal edildi',
        deviceId: deviceId
    });
});

// API: Debug JSON data
app.get('/api/debug/json', (req, res) => {
    res.json({
        devices: devices,
        otaJobs: otaJobs,
        firmwareFiles: Object.keys(firmwareFiles).reduce((acc, key) => {
            acc[key] = {
                name: firmwareFiles[key].name,
                size: firmwareFiles[key].size,
                uploadedAt: firmwareFiles[key].uploadedAt
            };
            return acc;
        }, {}),
        deviceStates: deviceStates,
        timestamp: Date.now()
    });
});

// API: Reset everything
app.post('/api/reset', (req, res) => {
    devices = [];
    otaJobs = {};
    firmwareFiles = {};
    deviceStates = {};
    
    console.log('🔄 Tüm veriler sıfırlandı');
    
    res.json({
        success: true,
        message: 'Tüm veriler sıfırlandı'
    });
});

// Health check
app.get('/health', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    
    const deviceStatuses = devices.map(device => {
        const state = deviceStates[device.id] || {};
        return {
            id: device.id,
            name: device.name,
            online: (Date.now() - device.lastSeen) < 30000,
            ipAddress: state.ipAddress,
            port: state.port || 80
        };
    });
    
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        devices: devices.length,
        online: onlineCount,
        otaJobs: Object.keys(otaJobs).length,
        firmwareFiles: Object.keys(firmwareFiles).length,
        deviceStates: Object.keys(deviceStates).length,
        deviceStatuses: deviceStatuses
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint bulunamadı',
        path: req.path,
        method: req.method,
        timestamp: Date.now(),
        suggestion: 'Geçerli endpointler: /, /dashboard, /debug, /api/*, /device/:id/*, /device/:id/html'
    });
});

// Sunucu
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
========================================
✅ ESP32 Dashboard Server
========================================
🚀 Port: ${PORT}
🏠 Ana Sayfa: http://localhost:${PORT}
📊 Dashboard: http://localhost:${PORT}/dashboard
🔧 Debug: http://localhost:${PORT}/debug
📡 API: http://localhost:${PORT}/api/devices
🏠 ESP32 Yerel Arayüz: http://localhost:${PORT}/device/:id/local
📄 ESP32 HTML: http://localhost:${PORT}/device/:id/html
⚡ OTA: http://localhost:${PORT}/api/ota
❤️  Health: http://localhost:${PORT}/health
========================================
    `);
});