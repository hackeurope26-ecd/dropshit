chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SHOW_RESULTS') {
    const product = message.product;

    // Remove existing panel if there is one
    document.getElementById('smartspend-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'smartspend-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      background: white;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      width: 320px;
      font-family: sans-serif;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-weight:700;font-size:16px">💰 SmartSpend</span>
        <span id="ss-close" style="cursor:pointer;font-size:20px;color:#999">×</span>
      </div>
      <img src="${product.main_image}" style="width:100%;height:180px;object-fit:contain;border-radius:8px;background:#f5f5f5"/>
      <div style="margin-top:12px;font-weight:600;font-size:15px">${product.title}</div>
      <div style="color:#16a34a;font-weight:700;font-size:18px;margin-top:4px">${product.currency} ${product.price}</div>
      <div style="color:#666;font-size:12px;margin-top:4px">${product.brand}</div>
      <div style="color:#888;font-size:12px;margin-top:8px">${product.description?.slice(0, 100)}...</div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px">
        ${product.tags?.map(tag => `
          <span style="background:#f0f0f0;padding:4px 8px;border-radius:20px;font-size:11px">${tag}</span>
        `).join('')}
      </div>
    `;

    document.body.appendChild(panel);
    document.getElementById('ss-close').onclick = () => panel.remove();
  }
});