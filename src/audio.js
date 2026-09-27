// All sound is synthesized with WebAudio at runtime: no recordings, no files.
// Music and sound effects default to ON, but browsers only allow audio after a user
// gesture, so the context is created on the first click / key press (unlock()).
//
// Music: an original 16-bar battle loop in A minor at 150 BPM, scheduled with a
// look-ahead clock. Menus play a soft layer (pad + arpeggio + bass); the fight adds
// drums and the lead melody, cross-faded.
const BPM=150,STEP=60/BPM/4; // one 16th note
const midi=n=>440*Math.pow(2,(n-69)/12);
// Chords per bar: [bass root, chord tones]
const CH={Am:[45,[57,60,64]],F:[41,[53,57,60]],C:[48,[55,60,64]],G:[43,[55,59,62]],E:[40,[56,59,64]],Em:[40,[55,59,64]],Dm:[38,[53,57,62]]};
const PROG=['Am','F','C','G','Am','F','G','E','F','G','Em','Am','Dm','G','C','E'];
// Lead melody: 8 eighth notes per bar (null = rest).
const LEAD=[
  [76,null,74,76,79,null,76,74],[72,null,72,74,76,null,72,69],[67,null,72,null,76,74,72,null],[74,null,null,71,74,76,79,null],
  [81,null,79,76,79,null,76,74],[77,null,76,74,72,null,74,76],[79,null,null,77,76,74,71,74],[76,null,null,null,80,null,76,null],
  [72,74,76,null,77,76,74,72],[71,74,79,null,77,null,74,null],[71,null,76,null,79,null,76,74],[76,null,null,null,null,null,72,74],
  [77,null,76,74,77,null,81,null],[79,null,77,76,74,null,71,74],[76,79,84,null,79,76,72,null],[80,null,76,null,80,83,null,null],
];
const KICK=new Set([0,6,8,11]),SNARE=new Set([4,12]),BASS_STEPS=[0,3,6,8,10,12,14];

export function createAudio({music=true,sfx=true}={}){
  let ctx=null,master=null,musicBus=null,sfxBus=null,layers=null,sfxOn=sfx,musicOn=music,mode='menu';
  let timer=null,nextTime=0,step=0,noiseBuf=null;
  function ensure(){
    if(!ctx){
      ctx=new AudioContext();master=ctx.createGain();master.gain.value=.55;
      const comp=ctx.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=4;master.connect(comp);comp.connect(ctx.destination);
      musicBus=ctx.createGain();musicBus.gain.value=musicOn?.42:0;musicBus.connect(master);
      sfxBus=ctx.createGain();sfxBus.gain.value=1;sfxBus.connect(master);
      layers={soft:ctx.createGain(),drums:ctx.createGain(),lead:ctx.createGain()};
      for(const g of Object.values(layers))g.connect(musicBus);
      layers.soft.gain.value=1;layers.drums.gain.value=mode==='fight'?1:0;layers.lead.gain.value=mode==='fight'?1:0;
      const len=ctx.sampleRate;noiseBuf=ctx.createBuffer(1,len,ctx.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
    }
    if(ctx.state==='suspended')void ctx.resume();
    return ctx;
  }
  // ---------- instruments ----------
  function osc(type,freq,t,dur,{gain=.1,dest,attack=.005,release=null,detune=0,filter=null}={}){
    const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.detune.value=detune;
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+attack);g.gain.exponentialRampToValueAtTime(.0001,t+(release??dur));
    let node=o;if(filter){const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=filter;o.connect(f);node=f;}
    node.connect(g);g.connect(dest);o.start(t);o.stop(t+(release??dur)+.05);return o;
  }
  function noise(t,dur,{gain=.2,type='highpass',freq=6000,q=.7,dest}){
    const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();s.buffer=noiseBuf;f.type=type;f.frequency.value=freq;f.Q.value=q;
    g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(f);f.connect(g);g.connect(dest);s.start(t,Math.random()*.5);s.stop(t+dur+.02);
  }
  function kick(t){const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(45,t+.12);g.gain.setValueAtTime(.9,t);g.gain.exponentialRampToValueAtTime(.0001,t+.22);o.connect(g);g.connect(layers.drums);o.start(t);o.stop(t+.25);}
  function snare(t,v=1){noise(t,.16,{gain:.35*v,type:'bandpass',freq:1800,q:.8,dest:layers.drums});osc('triangle',190,t,.09,{gain:.18*v,dest:layers.drums});}
  function hat(t,open=false){noise(t,open?.18:.04,{gain:open?.1:.07,freq:8000,dest:layers.drums});}
  function scheduleStep(s,t){
    const bar=Math.floor(s/16)%PROG.length,i=s%16,[root,tones]=CH[PROG[bar]];
    // Pad: one long chord per bar.
    if(i===0)for(const n of tones){osc('triangle',midi(n),t,STEP*16,{gain:.045,dest:layers.soft,attack:.08,filter:1800});osc('sawtooth',midi(n),t,STEP*16,{gain:.012,dest:layers.soft,attack:.1,detune:7,filter:1200});}
    // Arpeggio: chord tones + octave, 16ths.
    const arp=[...tones.map(n=>n+12),tones[0]+24],a=arp[[0,1,2,3,2,1,0,1][i%8]];
    osc('square',midi(a),t,STEP*.9,{gain:.018,dest:layers.soft,filter:2600});
    // Bass: syncopated octaves.
    if(BASS_STEPS.includes(i))osc('sawtooth',midi(root+(i===6||i===14?12:0)),t,STEP*1.6,{gain:.11,dest:layers.soft,filter:700});
    // Drums (fight layer), with a snare fill every fourth bar.
    const fill=bar%4===3&&i>=12;
    if(KICK.has(i))kick(t);
    if(SNARE.has(i)&&!fill)snare(t);
    if(fill)snare(t,.55+.15*(i-12));
    if(i%2===0)hat(t,i===14);
    // Lead (fight layer): eighth notes.
    if(i%2===0){const n=LEAD[bar][i/2];if(n){const dur=STEP*1.9;osc('square',midi(n),t,dur,{gain:.05,dest:layers.lead,filter:3200});osc('sawtooth',midi(n),t,dur,{gain:.025,dest:layers.lead,detune:-8,filter:2400});}}
  }
  function scheduler(){
    if(!ctx||!musicOn)return;
    while(nextTime<ctx.currentTime+.15){scheduleStep(step,nextTime);nextTime+=STEP;step++;}
  }
  function startMusic(){if(!ctx||timer)return;nextTime=ctx.currentTime+.08;step=0;timer=setInterval(scheduler,25);}
  function stopMusic(){clearInterval(timer);timer=null;}
  function fadeLayers(){
    if(!ctx)return;const t=ctx.currentTime,fight=mode==='fight';
    for(const [k,v] of [['drums',fight?1:0],['lead',fight?1:0],['soft',fight?.85:1]]){const g=layers[k].gain;g.cancelScheduledValues(t);g.setValueAtTime(g.value,t);g.linearRampToValueAtTime(v,t+.8);}
  }
  // ---------- sound effects ----------
  function tone(freq,dur,{type='square',gain=.12,slide=0,delay=0}={}){
    const t=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*slide),t+dur);
    g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(sfxBus);o.start(t);o.stop(t+dur+.02);
  }
  const hiss=(dur,{gain=.2,filter=1200,delay=0,type='lowpass'}={})=>noise(ctx.currentTime+delay,dur,{gain,type,freq:filter,dest:sfxBus});
  const SFX={
    hit:({dmg=5,kb=0}={})=>{const big=Math.min(1,kb/140);hiss(.12+big*.25,{gain:.25+big*.3,filter:900+dmg*80});tone(220-big*120,.15+big*.3,{type:'square',gain:.08+big*.08,slide:.4});if(big>.7)hiss(.5,{gain:.2,filter:300,delay:.05});},
    shield:()=>{tone(1200,.08,{type:'triangle',gain:.08});hiss(.08,{gain:.12,filter:4000,type:'highpass'});},
    parry:()=>{[1568,2093].forEach((f,i)=>tone(f,.25,{type:'sine',gain:.12,delay:i*.05}));},
    ko:()=>{hiss(.9,{gain:.4,filter:500});tone(90,.9,{type:'sawtooth',gain:.14,slide:.3});[523,784,1046].forEach((f,i)=>tone(f,.3,{type:'triangle',gain:.07,delay:.15+i*.08}));},
    jump:()=>tone(420,.1,{type:'triangle',gain:.06,slide:1.6}),
    charge:()=>tone(300,.5,{type:'sawtooth',gain:.05,slide:2.5}),
    grab:()=>tone(260,.08,{type:'square',gain:.08}),
    spawn:()=>tone(520,.12,{type:'triangle',gain:.08,slide:.6}),
    reflect:()=>tone(1400,.12,{type:'square',gain:.07,slide:1.4}),
    shieldbreak:()=>{hiss(.4,{gain:.3,filter:3000});tone(880,.6,{type:'sawtooth',gain:.08,slide:.25});},
    slam:()=>{hiss(.35,{gain:.35,filter:400});tone(70,.4,{type:'sine',gain:.25,slide:.5});},
    countdown:()=>tone(523,.18,{type:'square',gain:.12}),
    go:()=>{tone(1046,.45,{type:'square',gain:.13});tone(784,.45,{type:'triangle',gain:.11});},
    game:()=>[784,659,523].forEach((f,i)=>tone(f,.3,{type:'square',gain:.1,delay:i*.14})),
    win:()=>[523,659,784,1046,784,1046].forEach((f,i)=>tone(f,.22,{type:'square',gain:.1,delay:i*.13})),
    armor:()=>tone(180,.12,{type:'square',gain:.07}),
    revenge:()=>{tone(150,.35,{type:'sawtooth',gain:.09,slide:1.8});hiss(.25,{gain:.18,filter:1200});},
    kopunch:()=>{[392,523,659,784].forEach((f,i)=>tone(f,.14,{type:'square',gain:.09,delay:i*.05}));},
    click:()=>tone(880,.05,{type:'triangle',gain:.05}),
  };
  return {
    get sfx(){return sfxOn;},get music(){return musicOn;},get unlocked(){return !!ctx&&ctx.state==='running';},
    diagnostics:()=>({steps:step,mode,running:!!timer,drums:layers?.drums.gain.value??0}),
    // Call from the first user gesture; safe to call repeatedly.
    unlock(){if(!sfxOn&&!musicOn)return;ensure();if(musicOn)startMusic();},
    setSfx(on){sfxOn=on;if(on)ensure();},
    setMusic(on){musicOn=on;if(on){ensure();musicBus.gain.value=.42;startMusic();}else{stopMusic();if(musicBus)musicBus.gain.value=0;}},
    setMode(m){if(m===mode)return;mode=m;fadeLayers();},
    play(name,arg){if(sfxOn&&ctx&&ctx.state==='running')SFX[name]?.(arg);},
    dispose(){stopMusic();ctx?.close();},
  };
}
