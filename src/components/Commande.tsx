import {useEffect, useRef, useState} from 'react';
import QRCode from 'qrcode';
import {categories, drinks, formatPrice} from '../content';
import {bagCount, bagStore, useBag} from '../lib/bag';
import {onFrame} from '../lib/scroll';
import {startAgent, type Agent} from '../lib/voice';
import {createHostStage} from '../gl/hostStage';
import type {Host} from '../gl/host';
import {useReducedMotion} from '../hooks/useReducedMotion';
import {L2DHost, type L2DHandle} from './L2DHost';

const USE_VRM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('host') === 'vrm';

type Msg = {role: 'user' | 'assistant'; text: string};
const SUGGEST = ['cafe-latte', 'cappuccino-chantilly', 'aperol-spritz', 'orval', 'chocolat-chaud', 'kir-royal'];

/**
 * Commande: the order (every line, quantities, exact prices, total), the host
 * live in 3D behind the bar, and the agent — talk (mic) or type. Server-side
 * Deepgram token only. A QR code opens this same page with the agent on a phone.
 */
export function Commande() {
  const reduced = useReducedMotion();
  const bag = useBag();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<Host | null>(null);
  const agentRef = useRef<Agent | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const l2dRef = useRef<L2DHandle>(null);
  const [state, setState] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([{role: 'assistant', text: 'Bonjour ! Je suis Nori. Dites-moi ce qui vous ferait plaisir, je l’ajoute à votre commande.'}]);
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let st: ReturnType<typeof createHostStage> | null = null;
    try {
      st = createHostStage(canvasRef.current!, {
        reduced,
        vrm: USE_VRM,
        onHost: (h) => {
          hostRef.current = h;
          (window as unknown as {__host: Host}).__host = h;
          h.wave();
          h.speak(2.2);
        },
      });
    } catch (err) {
      console.warn('WebGL unavailable for the host', err);
    }
    const off = onFrame(() => st?.render());
    const url = `${location.origin}${location.pathname}#/commande?agent=1`;
    QRCode.toCanvas(qrRef.current, url, {width: 132, margin: 1, color: {dark: '#2a1d17', light: '#f6eedd'}}).catch(() => {});
    return () => {
      off();
      agentRef.current?.stop();
      st?.dispose();
    };
  }, [reduced]);

  useEffect(() => {
    logRef.current?.scrollTo({top: 1e6, behavior: 'smooth'});
  }, [msgs]);

  const handlers = {
    onLevel: (v: number) => hostRef.current?.setMouth(v),
    onStream: (s: MediaStream) => !USE_VRM && !!l2dRef.current?.attachVoice(s),
    onState: setState,
    onText: (role: 'user' | 'assistant', t: string) => {
      if (role === 'assistant') setMsgs((m) => [...m, {role, text: t}]);
      else if (agentRef.current?.mic) setMsgs((m) => [...m, {role, text: t}]);
    },
  };
  const ensure = async (mic: boolean) => {
    if (agentRef.current && !agentRef.current.closed && agentRef.current.mic === mic) return agentRef.current;
    agentRef.current?.stop();
    agentRef.current = await startAgent({mic, ...handlers});
    return agentRef.current;
  };
  const toggleMic = async () => {
    if (agentRef.current?.mic) {
      agentRef.current.stop();
      agentRef.current = null;
      setState('');
      return;
    }
    try {
      await ensure(true);
    } catch {
      setState('voix indisponible');
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    setMsgs((m) => [...m, {role: 'user', text: t}]);
    try {
      const a = await ensure(agentRef.current?.mic ?? false);
      a.send(t);
    } catch {
      setMsgs((m) => [...m, {role: 'assistant', text: 'Je suis momentanément indisponible — commandez directement au comptoir.'}]);
    }
  };

  const lines = drinks.filter((d) => bag[d.id]);
  const total = lines.reduce((a, d) => a + d.fromPrice * bag[d.id], 0);
  const count = bagCount(bag);

  return (
    <section id="commande" aria-labelledby="commande-title" className="relative min-h-svh">
      <canvas ref={canvasRef} className="fixed inset-0 -z-0 size-full" aria-hidden="true" />
      {!USE_VRM && <L2DHost ref={l2dRef} className="fixed bottom-[22svh] left-[8%] z-0 h-[70svh] w-[40vw] max-md:left-0 max-md:bottom-[40svh] max-md:h-[42svh] max-md:w-full" />}
      <div className="relative z-10 mx-auto grid max-w-[1680px] gap-6 px-5 pt-24 pb-16 md:grid-cols-[1fr_minmax(0,26rem)] md:px-10 md:pt-28">
        <div className="flex flex-col justify-between gap-6">
          <div>
            <p className="label text-gold-light">Commande · au comptoir ou à table</p>
            <h1 id="commande-title" className="display mt-2 text-[clamp(36px,4.6vw,80px)] text-[#fff6ea]">
              Nori <em className="text-gold-light">prend votre commande</em>
            </h1>
          </div>

          {/* agent chat */}
          <div className="mt-[34svh] w-full max-w-xl rounded-[22px] border border-cream/15 bg-ink/65 p-4 text-cream backdrop-blur-md md:mt-auto">
            <div ref={logRef} className="max-h-48 space-y-2 overflow-y-auto pr-1 text-[14px]" aria-live="polite">
              {msgs.map((m, i) => (
                <p key={i} className={m.role === 'user' ? 'ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-gold/90 px-3 py-2 text-ink' : 'w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-cream/10 px-3 py-2'}>
                  {m.text}
                </p>
              ))}
            </div>
            <form onSubmit={submit} className="mt-3 flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Écrivez : « deux cafés latte, s’il vous plaît »"
                className="min-w-0 flex-1 rounded-full border border-cream/20 bg-ink/50 px-4 py-2.5 text-[14px] text-cream placeholder:text-cream/40 focus:border-gold focus:outline-none"
                aria-label="Message à l’hôte"
              />
              <button type="submit" className="rounded-full bg-cream px-4 text-[13px] font-medium text-ink">
                Envoyer
              </button>
              <button type="button" onClick={toggleMic} className={`rounded-full px-4 text-[13px] font-medium ${agentRef.current?.mic ? 'bg-[#ff4a3d] text-white' : 'border border-cream/30 text-cream'}`} aria-label="Parler à l’hôte">
                {agentRef.current?.mic ? '■ Stop' : '🎙 Parler'}
              </button>
            </form>
            {state && <p className="label mt-2 text-cream/50">Agent : {state}</p>}
          </div>
        </div>

        {/* order */}
        <aside className="rounded-[24px] border border-cream/15 bg-ink/70 p-5 text-cream backdrop-blur-md md:p-6" aria-label="Votre commande">
          <div className="flex items-baseline justify-between">
            <h2 className="display text-[30px]">Votre commande</h2>
            <span className="label text-cream/50">{count} boisson{count === 1 ? '' : 's'}</span>
          </div>
          {lines.length === 0 ? (
            <p className="mt-4 text-[14px] text-cream/60">Rien pour l’instant. Ajoutez une boisson ci-dessous, depuis la carte, ou demandez à Nori.</p>
          ) : (
            <ul className="mt-4 divide-y divide-cream/10">
              {lines.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2.5" data-line={d.id}>
                  <img src={d.img.s} alt="" width={44} height={44} className="size-11 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px]">{d.name.fr}</p>
                    <p className="label text-cream/45">{categories[d.categoryIndex].title.fr} · {formatPrice(d.fromPrice)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => bagStore.set(d.id, bag[d.id] - 1)} className="grid size-7 place-items-center rounded-full border border-cream/25" aria-label={`Retirer un ${d.name.fr}`}>
                      −
                    </button>
                    <span className="w-5 text-center tabular-nums">{bag[d.id]}</span>
                    <button type="button" onClick={() => bagStore.add(d.id, 1)} className="grid size-7 place-items-center rounded-full border border-cream/25" aria-label={`Ajouter un ${d.name.fr}`}>
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-baseline justify-between border-t border-cream/15 pt-4">
            <span className="label text-cream/60">Total</span>
            <span className="display text-[34px] text-gold-light tabular-nums">{formatPrice(total)}</span>
          </div>
          <button
            type="button"
            disabled={!lines.length}
            onClick={() => setSent(`RDV-${String(Date.now()).slice(-4)}`)}
            className="glint label mt-4 w-full rounded-full bg-gold px-6 py-3.5 text-ink disabled:opacity-40"
          >
            <span className="relative z-10">Envoyer au comptoir</span>
          </button>
          {sent && (
            <p className="mt-3 rounded-xl bg-cream/10 p-3 text-[13px]" role="status">
              Commande <strong>{sent}</strong> prête à montrer au comptoir — paiement sur place.
            </p>
          )}

          <p className="label mt-6 text-gold-light">Suggestions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGEST.map((id) => drinks.find((d) => d.id === id)).filter(Boolean).map((d) => (
              <button key={d!.id} type="button" onClick={() => { bagStore.add(d!.id, 1); bagStore.flash(d!.id); }} className="rounded-full border border-cream/20 px-3 py-1.5 text-[12.5px] hover:border-gold">
                {d!.name.fr} · {formatPrice(d!.fromPrice)}
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-4 rounded-2xl bg-cream/5 p-3">
            <canvas ref={qrRef} width={132} height={132} className="rounded-lg" aria-label="QR code vers l’agent" />
            <p className="text-[13px] text-cream/70">
              <span className="label block text-gold-light">Sur votre téléphone</span>
              Scannez pour parler à Nori depuis votre table.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
