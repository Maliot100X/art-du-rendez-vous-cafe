/**
 * The café agent: Deepgram Voice Agent over
 * wss://agent.deepgram.com/v1/agent/converse, authenticated with a short-lived
 * token minted by our own server (/api/deepgram/token) — never the API key.
 * Voice mode: mic → linear16 @16 kHz up; agent audio linear16 @24 kHz down,
 * played via WebAudio, its loudness driving the avatar's mouth (lip-sync).
 * Text mode: typed messages go up as InjectUserMessage, replies come back as
 * ConversationText (and are spoken too). The agent can add drinks to the
 * order through a client-side function call.
 */
import {categories, drinks} from '../data/store.js';
import {bagStore} from './bag';

export type Agent = {send(text: string): void; stop(): void; mic: boolean; readonly closed: boolean};
type Handlers = {onLevel(v: number): void; onState(s: string): void; onText(role: 'user' | 'assistant', text: string): void; onStream?(s: MediaStream): boolean};

const prompt = () => {
  const lines = categories.map(
    (c) =>
      `${c.title.fr}: ` +
      c.drinks.map((d) => `${d.name.fr} [id ${d.id}] ${d.priceList.map((p) => (p.key ? p.key + ' ' : '') + p.value.toFixed(2).replace('.', ',') + ' €').join(' / ')}`).join('; '),
  );
  return `Tu es Nori, l'hôte du café "Art du Rendez-Vous", Rue des Artistes 1A, 1020 Laeken, Bruxelles (à côté de la gare de Bockstael). Horaires: lun-mer 8h-2h, jeu 8h-minuit, ven-dim 24h/24. Réponds dans la langue du client (français par défaut), en une ou deux phrases chaleureuses. Quand le client veut commander, appelle add_to_order avec l'id exact. N'invente jamais de boisson ni de prix. Carte complète (${drinks.length} boissons):\n${lines.join('\n')}`;
};

export async function startAgent(opts: {mic: boolean} & Handlers): Promise<Agent> {
  const {onLevel, onState, onText} = opts;
  onState('connexion…');
  const r = await fetch('/api/deepgram/token', {method: 'POST'});
  if (!r.ok) throw new Error('voice unavailable');
  const {access_token} = await r.json();
  const ws = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', ['bearer', access_token]);
  ws.binaryType = 'arraybuffer';
  const ctx = new AudioContext({sampleRate: 24000});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  // If the avatar player takes the stream, it plays the audio (delayed for lip look-ahead); else play it here.
  const dest = ctx.createMediaStreamDestination();
  analyser.connect(dest);
  if (!opts.onStream?.(dest.stream)) analyser.connect(ctx.destination);
  let playAt = 0;
  let raf = 0;
  let sources: AudioBufferSourceNode[] = [];
  const buf = new Uint8Array(analyser.fftSize);
  const meter = () => {
    analyser.getByteTimeDomainData(buf);
    let s = 0;
    for (const b of buf) s += ((b - 128) / 128) ** 2;
    onLevel(Math.min(1, Math.sqrt(s / buf.length) * 5));
    raf = requestAnimationFrame(meter);
  };
  meter();

  let mic: MediaStream | null = null;
  let micCtx: AudioContext | null = null;
  let proc: ScriptProcessorNode | null = null;
  if (opts.mic) {
    mic = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}});
    micCtx = new AudioContext({sampleRate: 16000});
    const src = micCtx.createMediaStreamSource(mic);
    proc = micCtx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = (e) => {
      if (ws.readyState !== 1) return;
      const f = e.inputBuffer.getChannelData(0);
      const out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
      ws.send(out.buffer);
    };
    src.connect(proc);
    proc.connect(micCtx.destination);
  }

  const queue: string[] = [];
  let ready = false;
  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: 'Settings',
        audio: {input: {encoding: 'linear16', sample_rate: 16000}, output: {encoding: 'linear16', sample_rate: 24000, container: 'none'}},
        agent: {
          language: 'fr',
          listen: {provider: {type: 'deepgram', model: 'nova-3'}},
          think: {
            provider: {type: 'open_ai', model: 'gpt-4o-mini'},
            prompt: prompt(),
            functions: [
              {
                name: 'add_to_order',
                description: 'Ajoute une boisson de la carte à la commande du client.',
                parameters: {
                  type: 'object',
                  properties: {drink_id: {type: 'string', description: 'id exact de la boisson'}, quantity: {type: 'integer', minimum: 1}},
                  required: ['drink_id'],
                },
              },
            ],
          },
          speak: {provider: {type: 'deepgram', model: 'aura-2-agathe-fr'}},
          greeting: 'Bonjour et bienvenue au Rendez-Vous ! Qu’est-ce qui vous ferait plaisir ?',
        },
      }),
    );
  };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const m = JSON.parse(e.data);
      if (m.type === 'SettingsApplied') {
        ready = true;
        onState(opts.mic ? 'à l’écoute' : 'en ligne');
        queue.splice(0).forEach((t) => ws.send(JSON.stringify({type: 'InjectUserMessage', content: t})));
      }
      if (m.type === 'ConversationText') onText(m.role === 'user' ? 'user' : 'assistant', m.content);
      if (m.type === 'UserStartedSpeaking') {
        sources.forEach((s) => s.stop()); // barge-in
        sources = [];
        playAt = ctx.currentTime;
      }
      if (m.type === 'FunctionCallRequest') {
        for (const f of m.functions ?? []) {
          let content = 'inconnu';
          try {
            const a = JSON.parse(f.arguments || '{}');
            const d = drinks.find((x) => x.id === a.drink_id);
            if (d) {
              bagStore.add(d.id, Math.max(1, a.quantity | 0 || 1));
              bagStore.flash(d.id);
              content = `ajouté: ${d.name.fr}`;
            }
          } catch {
            /* malformed arguments */
          }
          ws.send(JSON.stringify({type: 'FunctionCallResponse', id: f.id, name: f.name, content}));
        }
      }
      if (m.type === 'Error') onState('erreur');
      return;
    }
    const pcm = new Int16Array(e.data as ArrayBuffer);
    const ab = ctx.createBuffer(1, pcm.length, 24000);
    const ch = ab.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const n = ctx.createBufferSource();
    n.buffer = ab;
    n.connect(analyser);
    playAt = Math.max(playAt, ctx.currentTime);
    n.start(playAt);
    playAt += ab.duration;
    sources.push(n);
    n.onended = () => (sources = sources.filter((s) => s !== n));
  };
  ws.onerror = () => onState('erreur');
  ws.onclose = () => onState('terminé');
  const keepAlive = window.setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({type: 'KeepAlive'})), 4000);

  return {
    mic: opts.mic,
    get closed() {
      return ws.readyState > 1;
    },
    send(text) {
      if (ready) ws.send(JSON.stringify({type: 'InjectUserMessage', content: text}));
      else queue.push(text);
    },
    stop() {
      clearInterval(keepAlive);
      cancelAnimationFrame(raf);
      ws.close();
      mic?.getTracks().forEach((t) => t.stop());
      proc?.disconnect();
      micCtx?.close();
      ctx.close();
      onLevel(0);
    },
  };
}
