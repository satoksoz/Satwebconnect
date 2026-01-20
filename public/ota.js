const deviceSelect = document.getElementById("deviceSelect");
const otaBtn = document.getElementById("otaBtn");
const binFile = document.getElementById("binFile");
const otaStatus = document.getElementById("otaStatus");

let devices = ["Sat_123ABC","Sat_456DEF"]; // örnek cihaz listesi, gerçek WS ile dinlenebilir

// Dropdown doldur
devices.forEach(d => {
  const option = document.createElement("option");
  option.value = d;
  option.textContent = d;
  deviceSelect.appendChild(option);
});

otaBtn.onclick = async () => {
  const deviceId = deviceSelect.value;
  if (!deviceId) return alert("Cihaz seçin");
  if (!binFile.files.length) return alert("Bin dosyası seçin");

  const formData = new FormData();
  formData.append("binfile", binFile.files[0]);

  otaStatus.textContent = "Yükleniyor...";

  const res = await fetch(`/ota/${deviceId}`, {
    method: "POST",
    body: formData
  });

  const text = await res.text();
  otaStatus.textContent = text;
};
