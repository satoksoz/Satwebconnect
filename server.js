const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const http = require('http');
const fs = require('fs');

const app = express();

// Render.com için CORS ayarları
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Forwarded-For']
}));

// Trust proxy for Render.com
app.set('trust proxy', true);

// Body parser middleware - Render.com için limit artırıldı
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static('public'));

// Memory storage for uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    }
});

// In-memory data storage (Render.com stateless uyumlu)
let devices = [];
let otaJobs = {};
let firmwareFiles = {};
let deviceStates = {};

// IP alma fonksiyonu Render.com için
const getClientIP = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.ip || '127.0.0.1';
};

// ESP32 Proxy Fonksiyonu (Render.com için optimize)
async function proxyESP32Local(deviceIp, req, res) {
    return new Promise((resolve, reject) => {
        // Path'i çıkar
        const originalPath = req.originalUrl.replace(`/device/${req.params.deviceId}/local`, '') || '/';
        const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        const targetPath = originalPath + queryString;
        
        console.log(`🔗 ESP32 Proxy [Render]: ${deviceIp}${targetPath} - Method: ${req.method}`);
        
        const options = {
            hostname: deviceIp,
            port: 80,
            path: targetPath === '/' ? '/' : targetPath,
            method: req.method,
            headers: {
                ...req.headers,
                host: deviceIp,
                'x-forwarded-for': getClientIP(req),
                'x-forwarded-host': req.get('host'),
                'x-forwarded-proto': req.protocol,
                'User-Agent': 'ESP32-Dashboard-Render/2.0',
                'Accept': req.headers.accept || '*/*',
                'Content-Type': req.headers['content-type'] || 'application/json'
            },
            timeout: 15000 // Render.com için timeout artırıldı
        };

        // ESP32 uyumluluğu için header'ları temizle
        delete options.headers['content-length'];
        delete options.headers['accept-encoding'];
        delete options.headers['referer'];
        delete options.headers['origin'];
        delete options.headers['if-none-match'];
        delete options.headers['if-modified-since'];

        const proxyReq = http.request(options, (proxyRes) => {
            let contentType = proxyRes.headers['content-type'] || '';
            const isHtml = contentType.includes('text/html');
            
            if (isHtml) {
                let body = '';
                proxyRes.on('data', (chunk) => {
                    body += chunk.toString();
                });
                
                proxyRes.on('end', () => {
                    try {
                        // HTML içeriğini düzenle
                        const modifiedBody = rewriteHtmlLinks(body, req.params.deviceId, deviceIp);
                        
                        // Headers'ı kopyala
                        const headersToCopy = { ...proxyRes.headers };
                        headersToCopy['content-length'] = Buffer.byteLength(modifiedBody, 'utf8');
                        
                        // CORS headers ekle
                        headersToCopy['Access-Control-Allow-Origin'] = '*';
                        headersToCopy['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
                        headersToCopy['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
                        
                        // Cache kontrolü
                        headersToCopy['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                        headersToCopy['Pragma'] = 'no-cache';
                        headersToCopy['Expires'] = '0';
                        
                        res.writeHead(proxyRes.statusCode, headersToCopy);
                        res.end(modifiedBody);
                        console.log(`✅ HTML Proxy complete [Render]: ${deviceIp}${targetPath}`);
                        resolve();
                    } catch (error) {
                        console.error('HTML processing error:', error);
                        reject(error);
                    }
                });
            } else {
                // Non-HTML içerik için direkt pipe
                const headersToCopy = { ...proxyRes.headers };
                
                // CORS headers ekle
                headersToCopy['Access-Control-Allow-Origin'] = '*';
                headersToCopy['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
                headersToCopy['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
                
                // Location header'ını rewrite et
                if (headersToCopy['location']) {
                    const location = headersToCopy['location'];
                    if (location.includes(deviceIp) || location.startsWith('/')) {
                        headersToCopy['location'] = rewriteUrl(location, req.params.deviceId, deviceIp);
                    }
                }
                
                res.writeHead(proxyRes.statusCode, headersToCopy);
                proxyRes.pipe(res);
                
                proxyRes.on('end', () => {
                    console.log(`✅ Proxy complete [Render]: ${deviceIp}${targetPath} - Status: ${proxyRes.statusCode}`);
                    resolve();
                });
            }
        });

        proxyReq.on('error', (err) => {
            console.error('ESP32 Proxy error [Render]:', err);
            reject(err);
        });
        
        proxyReq.on('timeout', () => {
            console.error('ESP32 Proxy timeout [Render]:', deviceIp);
            proxyReq.destroy();
            reject(new Error('ESP32 connection timeout'));
        });

        // Request body gönder (POST/PUT için)
        if (req.method === 'POST' || req.method === 'PUT') {
            let bodyData = '';
            
            req.on('data', (chunk) => {
                bodyData += chunk.toString();
            });
            
            req.on('end', () => {
                if (bodyData) {
                    proxyReq.setHeader('Content-Type', req.headers['content-type'] || 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                }
                proxyReq.end();
            });
        } else {
            proxyReq.end();
        }
    });
}

// HTML içindeki linkleri rewrite et
function rewriteHtmlLinks(html, deviceId, deviceIp) {
    // Base URL'yi değiştir
    let modified = html.replace(
        /<head>/i,
        `<head>\n<base href="/device/${deviceId}/local/">\n`
    );
    
    // JavaScript fetch çağrılarını düzenle
    modified = modified.replace(
        /fetch\('\/api\/([^']+)'/gi,
        `fetch('/device/${deviceId}/local/api/$1'`
    );
    
    modified = modified.replace(
        /fetch\("\/api\/([^"]+)"\)/gi,
        `fetch("/device/${deviceId}/local/api/$1")`
    );
    
    // JavaScript içindeki API endpoint'lerini düzenle
    modified = modified.replace(
        /'\/api\/([^']+)'/gi,
        `'/device/${deviceId}/local/api/$1'`
    );
    
    modified = modified.replace(
        /"\/api\/([^"]+)"/gi,
        `"/device/${deviceId}/local/api/$1"`
    );
    
    // href="..." linklerini düzenle
    modified = modified.replace(
        /href="(\/[^"]*)"/gi,
        (match, path) => {
            // Dashboard linklerini koru
            if (path.includes('/dashboard') || path.includes('dashboard')) {
                return match;
            }
            return `href="/device/${deviceId}/local${path}"`;
        }
    );
    
    // src="..." linklerini düzenle
    modified = modified.replace(
        /src="(\/[^"]*)"/gi,
        (match, path) => `src="/device/${deviceId}/local${path}"`
    );
    
    // action="..." form action'larını düzenle
    modified = modified.replace(
        /action="(\/[^"]*)"/gi,
        (match, path) => `action="/device/${deviceId}/local${path}"`
    );
    
    // CSS url() linklerini düzenle
    modified = modified.replace(
        /url\(\s*'(\/[^']*)'\s*\)/gi,
        (match, path) => `url('/device/${deviceId}/local${path}')`
    );
    
    modified = modified.replace(
        /url\(\s*"(\/[^"]*)"\s*\)/gi,
        (match, path) => `url("/device/${deviceId}/local${path}")`
    );
    
    // Doğrudan IP adresi içeren linkleri de düzenle
    modified = modified.replace(
        new RegExp(`http://${deviceIp}`, 'gi'),
        `/device/${deviceId}/local`
    );
    
    // Absolute URL'leri düzenle
    modified = modified.replace(
        new RegExp(`http://${deviceIp}(:\\d+)?`, 'gi'),
        `/device/${deviceId}/local`
    );
    
    return modified;
}

// URL rewrite fonksiyonu
function rewriteUrl(url, deviceId, deviceIp) {
    if (url.includes(`http://${deviceIp}`)) {
        return url.replace(`http://${deviceIp}`, `/device/${deviceId}/local`);
    } else if (url.startsWith('/')) {
        return `/device/${deviceId}/local${url}`;
    }
    return url;
}

// ESP32 proxy handler
async function handleESP32Proxy(req, res) {
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
            deviceId: deviceId,
            note: 'ESP32 cihazının public IP adresini kaydetmesi gerekiyor'
        });
    }
    
    try {
        await proxyESP32Local(deviceIp, req, res);
    } catch (error) {
        console.error('ESP32 Local Proxy error [Render]:', error);
        
        // Fallback HTML sayfası
        res.status(502).send(`
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
                    .info { background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0; }
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
                        <p><strong>Render URL:</strong> ${req.get('host')}</p>
                    </div>
                    
                    <div class="info">
                        <h4>🔧 Sorun Giderme İpuçları:</h4>
                        <p>1. ESP32 cihazınızın <strong>public IP</strong> adresine sahip olduğundan emin olun</p>
                        <p>2. Firewall/port ayarlarını kontrol edin (Port 80 açık olmalı)</p>
                        <p>3. ESP32 kodunda serverUrl'yi Render URL'niz ile güncelleyin</p>
                    </div>
                    
                    <div>
                        <a href="http://${deviceIp}" class="btn" target="_blank">🔗 Doğrudan Erişim (Port 80)</a>
                        <a href="/dashboard" class="btn">📊 Dashboard'a Dön</a>
                        <a href="/device/${deviceId}" class="btn">📋 Cihaz Detayı</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
}

// Ana sayfa
app.get('/', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    const renderUrl = req.get('host');
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>ESP32 Dashboard - Render.com</title>
            <style>
                body { font-family:Arial; padding:20px; text-align:center; background:#f0f2f5; }
                .btn { padding:10px 20px; background:#4CAF50; color:white; text-decoration:none; border-radius:5px; margin:5px; }
                .card { background:white; padding:30px; border-radius:10px; max-width:600px; margin:20px auto; }
                .info { background:#e3f2fd; padding:15px; border-radius:8px; margin:15px 0; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>📱 ESP32 Dashboard</h1>
                <p><strong>Render.com Deployment</strong></p>
                <p>Çevrimiçi: ${onlineCount} / Toplam: ${devices.length} cihaz</p>
                
                <div class="info">
                    <h3>🌐 Render.com Bilgileri</h3>
                    <p><strong>URL:</strong> ${renderUrl}</p>
                    <p><strong>Port:</strong> ${process.env.PORT || 3000}</p>
                    <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'production'}</p>
                </div>
                
                <a href="/dashboard" class="btn">Dashboard'a Git</a>
                <a href="/api/devices" target="_blank" class="btn">API Test</a>
                <a href="/debug" class="btn" style="background:#FF9800;">Debug</a>
                <a href="/setup" class="btn" style="background:#9C27B0;">ESP32 Kurulum Rehberi</a>
            </div>
        </body>
        </html>
    `);
});

// ESP32 Kurulum Rehberi Sayfası
app.get('/setup', (req, res) => {
    const renderUrl = req.protocol + '://' + req.get('host');
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ESP32 Kurulum Rehberi - Render.com</title>
            <style>
                body { font-family: Arial; padding: 20px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
                h1, h2, h3 { color: #333; }
                .step { background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #4CAF50; }
                .code { background: #2d2d2d; color: #fff; padding: 15px; border-radius: 5px; overflow-x: auto; font-family: monospace; }
                .important { background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ffc107; }
                .btn { padding: 10px 20px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; display: inline-block; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 ESP32 Kurulum Rehberi - Render.com</h1>
                
                <div class="important">
                    <h3>⚠️ ÖNEMLİ NOT:</h3>
                    <p>Render.com'da çalıştırmak için ESP32'nizin <strong>PUBLIC IP</strong> adresine ihtiyacınız var!</p>
                    <p>1. Modeminizde port forwarding yapın (Port 80 → ESP32 local IP)</p>
                    <p>2. Veya DynDNS/NO-IP gibi hizmetler kullanın</p>
                    <p>3. ESP32 kodundaki <strong>serverUrl</strong>'yi güncelleyin</p>
                </div>
                
                <div class="step">
                    <h2>📝 1. ESP32 Kodunu Güncelle</h2>
                    <p>ESP32 kodunuzda şu satırı bulun:</p>
                    <div class="code">
                        const char* serverUrl = "http://192.168.137.1:3000";
                    </div>
                    <p>Yukarıdaki satırı şu şekilde değiştirin:</p>
                    <div class="code">
                        const char* serverUrl = "${renderUrl}";
                    </div>
                </div>
                
                <div class="step">
                    <h2>🔧 2. Public IP Ayarları</h2>
                    <p>ESP32 kayıt API'sine public IP'nizi göndermek için:</p>
                    <div class="code">
                        // ESP32 kodunda registerDevice() fonksiyonunu bulun
                        doc["ipAddress"] = "SIZIN_PUBLIC_IP_ADRESINIZ"; // Burayı public IP ile değiştirin
                        doc["port"] = 80; // Port 80 açık olmalı
                    </div>
                </div>
                
                <div class="step">
                    <h2>🌐 3. Network Yapılandırması</h2>
                    <p>ESP32'nizi public internet'e açmak için:</p>
                    <ul>
                        <li>Modem ayarlarınıza girin</li>
                        <li>Port Forwarding/Port Yönlendirme bölümünü bulun</li>
                        <li>External Port: 80, Internal Port: 80, Internal IP: ESP32'nizin local IP'si</li>
                        <li>TCP protokolünü seçin ve kaydedin</li>
                    </ul>
                </div>
                
                <div class="step">
                    <h2>✅ 4. Test</h2>
                    <p>Kurulumu test etmek için:</p>
                    <ol>
                        <li>ESP32'yi yeniden başlatın</li>
                        <li><a href="/dashboard" target="_blank">Dashboard</a>'ı açın</li>
                        <li>Cihazınızın online görünmesini bekleyin</li>
                        <li>"Yerel Arayüz" butonuna tıklayın</li>
                    </ol>
                </div>
                
                <div style="margin-top: 30px;">
                    <a href="/" class="btn">🏠 Ana Sayfa</a>
                    <a href="/dashboard" class="btn">📊 Dashboard</a>
                    <a href="/debug" class="btn" style="background:#FF9800;">🔧 Debug</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ESP32 Yerel Arayüz Proxy - TÜM YOLLAR İÇİN
app.all('/device/:deviceId/local/*', async (req, res) => {
    await handleESP32Proxy(req, res);
});

// ESP32 Yerel Arayüz Ana Sayfa
app.all('/device/:deviceId/local', async (req, res) => {
    await handleESP32Proxy(req, res);
});

// Cihaz detay sayfası
app.get('/device/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.find(d => d.id === deviceId);
    const deviceState = deviceStates[deviceId] || { ipAddress: null };
    const renderUrl = req.get('host');
    
    if (!device) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cihaz Bulunamadı</title>
                <style>
                    body { font-family:Arial; padding:40px; text-align:center; background:#f5f5f5; }
                    .container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
                    .error { color:#f44336; margin:20px 0; }
                    .btn { padding:10px 20px; background:#4CAF50; color:white; text-decoration:none; border-radius:5px; margin:10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1 class="error">❌ Cihaz Bulunamadı</h1>
                    <p><strong>${deviceId}</strong> ID'li cihaz bulunamadı.</p>
                    <p>Bu cihaz henüz Render.com dashboard'a kaydolmamış.</p>
                    <div style="margin-top: 20px;">
                        <a href="/dashboard" class="btn">📊 Dashboard'a Dön</a>
                        <a href="/setup" class="btn" style="background:#9C27B0;">🚀 Kurulum Rehberi</a>
                    </div>
                </div>
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
                .warning { background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ffc107; }
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
                    
                    if (tabName === 'localInterface') {
                        document.getElementById('esp32Iframe').src = document.getElementById('esp32Iframe').src;
                    }
                }
                
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
                
                ${!deviceState.ipAddress ? `
                <div class="warning">
                    <h4>⚠️ Public IP Gerekli</h4>
                    <p>Bu cihazın yerel arayüzüne erişmek için public IP adresi gerekiyor.</p>
                    <p>ESP32 kodunuzda <strong>serverUrl</strong>'yi "${renderUrl}" olarak güncelleyin ve public IP'nizi kaydedin.</p>
                    <a href="/setup" class="btn" style="background:#9C27B0;">🚀 Kurulum Rehberi</a>
                </div>
                ` : ''}
                
                <div class="tab-container">
                    <div class="tab">
                        <button class="tablinks" onclick="openTab(event, 'localInterface')">🏠 Yerel Arayüz</button>
                        <button class="tablinks" onclick="openTab(event, 'deviceInfo')">📊 Cihaz Bilgileri</button>
                        <button class="tablinks" onclick="openTab(event, 'otaControl')">⚡ OTA Kontrol</button>
                    </div>
                    
                    <div id="localInterface" class="tabcontent">
                        <h3>ESP32 Yerel Kontrol Paneli</h3>
                        ${deviceState.ipAddress ? `
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
                        ` : `
                        <div class="warning" style="text-align: center; padding: 40px;">
                            <h3>🔌 IP Adresi Gerekli</h3>
                            <p>Yerel arayüzü görüntülemek için cihaz IP adresi gerekiyor.</p>
                            <p>ESP32 cihazınızın kayıt sırasında public IP adresini göndermesini sağlayın.</p>
                            <a href="/setup" class="btn" style="background:#9C27B0; margin-top: 15px;">🚀 Kurulum Rehberi</a>
                        </div>
                        `}
                    </div>
                    
                    <div id="deviceInfo" class="tabcontent">
                        <div class="info-grid">
                            <div class="info-card">
                                <h3>📊 Cihaz Bilgileri</h3>
                                <p><strong>ID:</strong> ${device.id}</p>
                                <p><strong>İsim:</strong> ${device.name}</p>
                                <p><strong>Firmware:</strong> ${device.firmwareVersion || '1.0.0'}</p>
                                <p><strong>IP:</strong> ${deviceState.ipAddress || 'Public IP Gerekli'}</p>
                                <p><strong>Port:</strong> ${deviceState.port || 80}</p>
                                <p><strong>Render URL:</strong> ${renderUrl}</p>
                            </div>
                            
                            <div class="info-card">
                                <h3>🌐 Durum</h3>
                                <p><strong>Son Görülme:</strong> ${new Date(device.lastSeen).toLocaleString()}</p>
                                <p><strong>OTA:</strong> ${otaJob?.active ? 'Aktif' : 'Aktif Değil'}</p>
                                <p><strong>Kayıt Tarihi:</strong> ${new Date(device.registeredAt || Date.now()).toLocaleString()}</p>
                                <p><strong>Çevrimiçi:</strong> ${isOnline ? 'Evet' : 'Hayır'}</p>
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
                    <a href="/setup" class="btn" style="background:#9C27B0;">🚀 Kurulum Rehberi</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Debug sayfası
app.get('/debug', (req, res) => {
    const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 30000).length;
    const renderUrl = req.get('host');
    const serverPort = process.env.PORT || 3000;
    
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
                .server-info { background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 15px 0; }
            </style>
        </head>
        <body>
            <h1>🔧 Debug Panel - Render.com</h1>
            
            <div class="server-info">
                <h3>🌐 Server Information</h3>
                <p><strong>Render URL:</strong> ${renderUrl}</p>
                <p><strong>Port:</strong> ${serverPort}</p>
                <p><strong>Node Environment:</strong> ${process.env.NODE_ENV || 'production'}</p>
                <p><strong>Node Version:</strong> ${process.version}</p>
                <p><strong>Memory Usage:</strong> ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB</p>
            </div>
            
            <div style="margin-bottom:20px;">
                <a href="/" class="btn">🏠 Ana Sayfa</a>
                <a href="/dashboard" class="btn">📊 Dashboard</a>
                <a href="/api/debug/json" class="btn">📋 JSON Data</a>
                <a href="/setup" class="btn" style="background:#9C27B0;">🚀 Kurulum Rehberi</a>
            </div>
            
            <div class="card">
                <h3>📊 İstatistikler</h3>
                <p>Toplam Cihaz: ${devices.length}</p>
                <p>Çevrimiçi Cihaz: ${onlineCount}</p>
                <p>OTA Jobs: ${Object.keys(otaJobs).length}</p>
                <p>Firmware Dosyaları: ${Object.keys(firmwareFiles).length}</p>
                <p>Cihaz Durumları: ${Object.keys(deviceStates).length}</p>
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
                        <small>IP: ${state.ipAddress || 'Public IP Gerekli'}:${state.port || 80}</small><br>
                        <span style="color: ${isOnline ? '#4CAF50' : '#f44336'};">
                            ${isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}
                        </span><br>
                        <div style="margin-top: 10px;">
                            <a href="/device/${d.id}" class="btn" style="background:#4CAF50; padding:5px 10px; font-size:12px;">Detay</a>
                            ${state.ipAddress ? `
                                <a href="/device/${d.id}/local" class="btn" style="background:#2196F3; padding:5px 10px; font-size:12px;">Yerel Arayüz</a>
                                <a href="http://${state.ipAddress}" class="btn" style="background:#FF9800; padding:5px 10px; font-size:12px;" target="_blank">Doğrudan</a>
                            ` : `
                                <span style="color:#f44336; font-size:11px;">Public IP gerekli</span>
                            `}
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
        hasFirmware: !!firmwareFiles[deviceId],
        renderUrl: req.get('host')
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
                port: deviceState.port || 80,
                renderUrl: req.get('host')
            };
        });
    
    res.json(onlineDevices);
});

// API: Cihaz kaydı (Render.com için güncellendi)
app.post('/api/register', (req, res) => {
    const { deviceId, deviceName = 'ESP32', firmwareVersion = '1.0.0', 
            ipAddress = null, port = 80, gatewayIp = null } = req.body;
    
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
            registeredAt: Date.now(),
            renderRegistered: true
        };
        devices.push(device);
    }
    
    // Cihaz durumunu güncelle
    deviceStates[deviceId] = {
        ipAddress: ipAddress,
        port: port,
        gatewayIp: gatewayIp,
        lastUpdate: Date.now(),
        renderUrl: req.get('host')
    };
    
    console.log(`✅ Cihaz kaydedildi [Render]: ${deviceId} - ${device.name} - IP: ${ipAddress}:${port}`);
    
    res.json({ 
        success: true, 
        device: device,
        deviceState: deviceStates[deviceId],
        totalDevices: devices.length,
        renderUrl: req.get('host'),
        message: ipAddress ? 'Cihaz başarıyla kaydedildi' : 'Cihaz kaydedildi ama public IP gerekli'
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
        console.log(`♻️ Eski OTA job temizlendi [Render]: ${deviceId}`);
    }
    
    // Firmware dosyasını memory'de sakla
    firmwareFiles[deviceId] = {
        buffer: req.file.buffer,
        name: req.file.originalname,
        size: req.file.size,
        uploadedAt: Date.now(),
        mimetype: req.file.mimetype,
        renderUploaded: true
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
        },
        renderUrl: req.get('host')
    };
    
    console.log(`📁 Firmware memory'ye kaydedildi [Render]: ${deviceId} - ${req.file.originalname}`);
    
    res.json({
        success: true,
        message: 'Firmware dosyası yüklendi',
        filename: req.file.originalname,
        size: req.file.size,
        deviceId: deviceId,
        downloadUrl: `/api/ota/download/${deviceId}`,
        otaActive: false,
        hasFile: true,
        renderUrl: req.get('host')
    });
});

// API: OTA firmware indirme
app.get('/api/ota/download/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const firmwareFile = firmwareFiles[deviceId];
    
    console.log(`📥 Firmware indirme isteği [Render]: ${deviceId}`);
    
    if (!firmwareFile) {
        return res.status(404).json({ error: 'Firmware dosyası bulunamadı' });
    }
    
    try {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${firmwareFile.name}"`);
        res.setHeader('Content-Length', firmwareFile.size);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        console.log(`📥 Firmware gönderiliyor [Render]: ${deviceId} - ${firmwareFile.name}`);
        
        res.send(firmwareFile.buffer);
        
    } catch (err) {
        console.error(`❌ Firmware indirme hatası [Render]: ${err.message}`);
        res.status(500).json({ error: 'Dosya gönderme hatası' });
    }
});

// API: OTA ilerlemesini güncelle
app.post('/api/ota/progress', (req, res) => {
    const { deviceId, progress, status } = req.body;
    
    console.log(`📊 OTA progress [Render]: ${deviceId} - %${progress} - ${status}`);
    
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
        console.log(`✅ OTA tamamlandı [Render]: ${deviceId}`);
        
        if (firmwareFiles[deviceId]) {
            delete firmwareFiles[deviceId];
            console.log(`🗑️ Firmware dosyası silindi [Render]: ${deviceId}`);
        }
    } else if (status === 'failed') {
        otaJobs[deviceId].active = false;
        console.log(`❌ OTA başarısız [Render]: ${deviceId}`);
    }
    
    res.json({ 
        success: true,
        deviceId: deviceId,
        progress: progress,
        status: status,
        renderUrl: req.get('host')
    });
});

// API: OTA başlat
app.post('/api/ota/start', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`🚀 OTA başlatma isteği [Render]: ${deviceId}`);
    
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
        },
        renderUrl: req.get('host')
    };
    
    console.log(`🚀 OTA başlatıldı [Render]: ${deviceId} - ${firmwareFile.name}`);
    
    res.json({
        success: true,
        message: 'OTA güncellemesi başlatıldı',
        deviceId: deviceId,
        filename: firmwareFile.name,
        size: firmwareFile.size,
        downloadUrl: `/api/ota/download/${deviceId}`,
        renderUrl: req.get('host')
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
        deviceId: deviceId,
        renderUrl: req.get('host')
    };
    
    res.json(response);
});

// API: OTA iptal
app.post('/api/ota/cancel', (req, res) => {
    const { deviceId } = req.body;
    
    console.log(`❌ OTA iptal isteği [Render]: ${deviceId}`);
    
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID gerekli' });
    }
    
    if (otaJobs[deviceId]) {
        otaJobs[deviceId].active = false;
        otaJobs[deviceId].progress = 0;
        console.log(`❌ OTA iptal edildi [Render]: ${deviceId}`);
    }
    
    res.json({
        success: true,
        message: 'OTA iptal edildi',
        deviceId: deviceId,
        renderUrl: req.get('host')
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
        serverInfo: {
            renderUrl: req.get('host'),
            port: process.env.PORT || 3000,
            nodeEnv: process.env.NODE_ENV || 'production',
            timestamp: Date.now(),
            memoryUsage: process.memoryUsage()
        }
    });
});

// API: Reset everything
app.post('/api/reset', (req, res) => {
    devices = [];
    otaJobs = {};
    firmwareFiles = {};
    deviceStates = {};
    
    console.log('🔄 Tüm veriler sıfırlandı [Render]');
    
    res.json({
        success: true,
        message: 'Tüm veriler sıfırlandı',
        renderUrl: req.get('host')
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
            port: state.port || 80,
            hasPublicIp: !!state.ipAddress
        };
    });
    
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        server: 'ESP32 Dashboard - Render.com',
        version: '2.0.0',
        renderUrl: req.get('host'),
        devices: {
            total: devices.length,
            online: onlineCount,
            withPublicIp: deviceStatuses.filter(d => d.hasPublicIp).length
        },
        otaJobs: Object.keys(otaJobs).length,
        firmwareFiles: Object.keys(firmwareFiles).length,
        deviceStates: Object.keys(deviceStates).length,
        deviceStatuses: deviceStatuses,
        system: {
            nodeVersion: process.version,
            memory: process.memoryUsage(),
            uptime: process.uptime()
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint bulunamadı',
        path: req.path,
        method: req.method,
        timestamp: Date.now(),
        server: 'ESP32 Dashboard - Render.com',
        renderUrl: req.get('host'),
        suggestion: 'Geçerli endpointler: /, /dashboard, /debug, /setup, /api/*, /device/:id/*'
    });
});

// Sunucu başlatma
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
========================================
✅ ESP32 Dashboard Server - Render.com
========================================
🚀 Port: ${PORT}
🌐 Environment: ${process.env.NODE_ENV || 'production'}
📊 Version: 2.0.0
🏠 Server: 0.0.0.0
========================================
NOT: ESP32'lerin PUBLIC IP adresine ihtiyacı var!
Kurulum rehberi: /setup
========================================
    `);
});