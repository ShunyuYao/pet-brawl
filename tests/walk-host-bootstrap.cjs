'use strict';
const fs=require('node:fs'),path=require('node:path');
const profile=process.env.PET_USERDATA_DIR;
if(process.env.PET_E2E_TEST!=='1'||!profile?.includes('pet-plugin-appearance-brawl-walk-'))throw Error('isolated walk preview only');
require(path.join(process.env.BRAWL_HOST_ROOT,'tests/helpers/appearance-hidden-bootstrap'));
// Explicit user-requested preview: reveal only the tested game after assertions.
if(process.env.BRAWL_WALK_PREVIEW==='1'){
 const {BaseWindow}=require('electron');
 setInterval(()=>{const file=path.join(profile,'show-game');if(!fs.existsSync(file))return;
  const win=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL().includes('/work-player.html')));
  if(win){fs.unlinkSync(file);win.show();win.focus();fs.writeFileSync(path.join(profile,'shown.json'),JSON.stringify({visible:win.isVisible(),focused:win.isFocused()}));}
 },250).unref();
}
