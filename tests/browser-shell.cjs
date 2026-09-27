'use strict';
// Opens the unmodified built HTML (no preload, no pet SDK) in a hidden Chromium window.
const {app,BrowserWindow}=require('electron');
if(!process.env.BRAWL_E2E_PROFILE?.includes('pet-brawl-e2e-')||!process.env.BRAWL_HTML)throw Error('isolated test only');
app.setPath('userData',process.env.BRAWL_E2E_PROFILE);
app.whenReady().then(()=>{
  const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  w.loadFile(process.env.BRAWL_HTML);
});
app.on('window-all-closed',()=>app.quit());
