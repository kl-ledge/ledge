import { copy } from '../copy';
import { overWindows, resetIsDate, resetLabel, shownUsage } from '../model/usage';
import { useMobile, type MobileStore } from '../state/store';
import { Limits, windowLabel } from '../ui/Limits';
import { BackLink } from '../ui/Header';
import { Notice } from '../ui/Notice';
import { useNow } from '../useNow';

/** The usage alert of the moment: a reached window first, else one past the PC's threshold; only from a fresh link (M9). */
export function useUsageAlert(store: MobileStore) {
  const state = useMobile(store);
  const now = useNow();
  // Never from values the link may have outdated, as the point did (M9): offline, no alert.
  if (!state.daemon?.usage || !state.usage || !state.fresh) return null;
  const over = overWindows(shownUsage(state.usage, now, state.fresh), state.usageAlert, now);
  return over.find(o => o.tone === 'red') ?? over[0] ?? null;
}

/**
 * Réglages › Usage (#40 D9, docs/mockups/ledge-remove-chat-p2.html, card 10): the « LIMITES » the point showed, as a screen of
 * its own: per harness its 5 h and week windows (a month for Cursor), with today's words; the alert, if one, at its head. Reading,
 * a PC that does not answer (« Pas de lecture depuis … ») and a harness to reconnect say so.
 */
export function Usage({ store }: { store: MobileStore }) {
  const state = useMobile(store);
  const now = useNow();
  const P = copy.limits;
  const alert = useUsageAlert(store);
  const name = (h: string) => P.harness[h] ?? h;
  const said = alert && (() => {
    const which = windowLabel(alert.window);
    const head = alert.tone === 'red' ? P.reachedLabel(name(alert.harness), which) : P.overLabel(name(alert.harness), which, alert.window.pct);
    const at = alert.window.resetsAt ? resetLabel(alert.window.resetsAt, now) : null;
    return at ? `${head} · ${resetIsDate(alert.window.resetsAt!, now) ? P.resumesOn(at) : P.resumes(at)}` : head;
  })();
  return (
    <>
      <header className="bleed flex h-14 flex-none items-center gap-2 border-b border-line pr-1.5 pl-2.5">
        <BackLink fallback={{ name: 'connection' }} label={copy.connection.title} />
        <h1 className="text-base font-semibold">{copy.settings.usage}</h1>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-5 pb-[34px]">
        {said && <Notice title={said} tone={alert.tone === 'red' ? 'danger' : 'warning'} role="status" />}
        {state.usage === null
          ? <p role="status" className="text-small text-muted">{P.loading}</p>
          : <div className="rounded-[10px] border border-line bg-surface px-4 py-2"><Limits usage={state.usage} now={now} alert={state.usageAlert} fresh={state.fresh} heading={false} /></div>}
      </main>
    </>
  );
}
