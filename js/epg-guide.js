/* MDStream 5.0 — Grade de TV: somente a programação retornada pelo provedor. */
(function(){
  'use strict';
  function decode(value){
    const raw=String(value||'');
    if(!raw) return '';
    // Xtream frequentemente retorna título e descrição em Base64; outros servidores devolvem texto.
    if(!/^[A-Za-z0-9+/\s]+=*$/.test(raw) || raw.length%4 !== 0) return raw;
    try {
      const bytes=atob(raw); const encoded=Array.from(bytes,c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
      const decoded=decodeURIComponent(encoded);
      if(/[\u0000-\u0008\u000E-\u001F]/.test(decoded)) return raw;
      return decoded;
    }catch(_){return raw;}
  }
  function parseDate(value, fallback){
    const num=Number(value); if(Number.isFinite(num)&&num>1e9) return num*(num>1e12?1:1000);
    if(!value) return fallback;
    // Horários sem fuso seguem o horário local da TV; timestamps são preferidos.
    const parsed=Date.parse(String(value).replace(' ','T'));
    return Number.isFinite(parsed)?parsed:fallback;
  }
  function fmt(t){return new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}
  class Guide{
    constructor(root,client,callbacks){
      this.root=root;this.client=client;this.callbacks=callbacks;this.cache=new Map();this.seq=0;
      this.channels=[];this.limit=18;this.start=Math.floor(Date.now()/1800000)*1800000;
      this.period=2*60*60*1000;this.sourceAvailable=true;this.maxConcurrent=3;
    }
    setClient(client){if(this.client!==client){this.client=client;this.cache.clear();} }
    async fetchEPG(channel){
      if(!channel || channel.directUrl || !this.client || !this.client.getShortEPG) return [];
      const key=String(channel.id); const old=this.cache.get(key);
      if(old && Date.now()-old.at<8*60*1000) return old.rows;
      try{
        const data=await this.client.getShortEPG(channel.id,8);
        const raw=Array.isArray(data)?data:(data && Array.isArray(data.epg_listings)?data.epg_listings:[]);
        const rows=raw.map(p=>({
          title:decode(p.title)||'Programa sem título', description:decode(p.description),
          start:parseDate(p.start_timestamp,p.start),end:parseDate(p.stop_timestamp,p.end)
        })).filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start).sort((a,b)=>a.start-b.start);
        this.cache.set(key,{rows,at:Date.now()});return rows;
      }catch(_){this.cache.set(key,{rows:[],at:Date.now()});return [];}
    }
    render(channels){
      this.channels=(channels||[]).slice();this.seq++; const sequence=this.seq;
      this.root.replaceChildren(); this.root.hidden=false;
      this.start=Math.floor(Date.now()/1800000)*1800000-1800000;
      this.root.style.setProperty('--guide-now-pct',Math.max(0,Math.min(100,(Date.now()-this.start)/this.period*100))+'%');
      const top=document.createElement('div');top.className='guide-toolbar';
      const header=document.createElement('div');header.className='guide-toolbar-copy';
      const title=document.createElement('h2');title.textContent='Guia de programação';
      const info=document.createElement('p');info.textContent='Selecione um canal para prévia • Tela cheia para ampliar';
      header.append(title,info);top.appendChild(header);
      const times=document.createElement('div');times.className='guide-clock';
      for(let i=0;i<4;i++){const t=document.createElement('span');t.textContent=fmt(this.start+i*1800000);times.appendChild(t);}
      top.appendChild(times);this.root.appendChild(top);
      const list=document.createElement('div');list.className='guide-scroll';this.root.appendChild(list);
      const first=this.channels.slice(0,this.limit);
      first.forEach(channel=>{
        const row=document.createElement('div');row.className='guide-row';row.dataset.channelId=channel.id;
        const pick=document.createElement('button');pick.type='button';pick.className='guide-channel';
        const imageUrl=typeof this.callbacks.safeImage==='function'?this.callbacks.safeImage(channel.image):'';
        if(imageUrl){const img=document.createElement('img');img.src=imageUrl;img.alt='';img.onerror=()=>img.remove();pick.appendChild(img);}
        const name=document.createElement('span');name.textContent=channel.name;pick.appendChild(name);
        pick.onclick=()=>this.select(channel,row);pick.onfocus=()=>this.loadRow(channel,row,sequence);
        const timeline=document.createElement('div');timeline.className='guide-timeline';
        const placeholder=document.createElement('div');placeholder.className='guide-empty';placeholder.textContent='Selecione para consultar programação';
        timeline.appendChild(placeholder); row.append(pick,timeline);list.appendChild(row);
      });
      if(this.channels.length>this.limit){
        const more=document.createElement('button');more.type='button';more.className='guide-more';
        more.textContent='Mostrar mais canais';more.onclick=()=>{
          const oldLimit=this.limit;this.limit+=18;this.render(this.channels);
          const next=this.root.querySelectorAll('.guide-row')[oldLimit];
          if(next)next.querySelector('.guide-channel').focus();
        };list.appendChild(more);
      }
      // Consulta somente poucos canais inicialmente, evitando sobrecarregar o provedor.
      first.slice(0,Math.min(6,first.length)).forEach((c,i)=>setTimeout(()=>{
        if(sequence===this.seq){const row=Array.from(list.querySelectorAll('.guide-row')).find(r=>r.dataset.channelId===String(c.id));if(row)this.loadRow(c,row,sequence);}
      },i*120));
      const marker=document.createElement('div');marker.className='guide-now-marker';marker.setAttribute('aria-hidden','true');
      this.root.appendChild(marker);
    }
    select(channel,row){
      Array.from(this.root.querySelectorAll('.guide-row')).forEach(r=>r.classList.toggle('selected',r===row));
      this.callbacks.select(channel,row.querySelector('.guide-channel'));
    }
    async loadRow(channel,row,sequence){
      if(row.dataset.loaded==='yes') return;
      if(row.dataset.loading==='yes') return;
      row.dataset.loading='yes';
      const programs=await this.fetchEPG(channel);
      if(sequence!==this.seq || !row.isConnected) return;
      row.dataset.loaded='yes';row.dataset.loading='no';
      const timeline=row.querySelector('.guide-timeline');timeline.replaceChildren();
      const start=this.start,end=start+this.period;
      const relevant=programs.filter(p=>p.end>start && p.start<end);
      if(!relevant.length){
        const noData=document.createElement('button');noData.type='button';noData.className='guide-program guide-no-data';
        noData.textContent='Sem programação disponível';noData.onclick=()=>this.select(channel,row);
        noData.style.left='0%';noData.style.width='100%';timeline.appendChild(noData);
      }else{
        relevant.forEach(program=>{
          const left=Math.max(0,(program.start-start)/this.period)*100;
          const right=Math.min(1,(program.end-start)/this.period)*100;
          const block=document.createElement('button');block.type='button';block.className='guide-program';
          block.style.left=left+'%';block.style.width=Math.max(1,(right-left))+'%';
          const title=document.createElement('strong');title.textContent=program.title;
          const meta=document.createElement('small');meta.textContent=fmt(program.start)+' – '+fmt(program.end);
          block.append(title,meta);block.title=program.title;
          const now=Date.now();if(program.start<=now && now<program.end)block.classList.add('is-on-now');
          block.onclick=()=>{this.select(channel,row);this.callbacks.program(program);};
          timeline.appendChild(block);
        });
      }
      const current=programs.find(p=>p.start<=Date.now()&&p.end>Date.now());
      if(current&&this.callbacks.programForChannel) this.callbacks.programForChannel(channel,current);
    }
  }
  window.MDStreamGuide=Guide;
})();
