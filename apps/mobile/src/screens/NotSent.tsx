import type { ReactNode } from 'react';
import { copy } from '../copy';
import { href } from '../router';
import type { MobileStore } from '../state/store';
import { RigsRequests } from './rigs/Requests';
import { TabPage, hostName, useShell } from '../shell/Shell';
import { Icon } from '../ui/icons';
import { Box, EmptyState } from '../ui/kit/Box';
import { kitButtonClass } from '../ui/kit/Controls';
import { useWide } from '../ui/layout';

/*
 * The tabs whose data the PC does not send to the phone yet (docs/mockups/ledge-mobile-refonte/m0-socle.html, §2 and §3,
 * answer A of question Q3): they stay, and say so. B4 and B5 bring Desktop's own empty states.
 */


/** The empty state in its frame on a phone (§3); in the list's column on a wide screen, unframed, lower (§2). */
function Frame({ label, children }: { label: string; children: ReactNode }) {
  const wide = useWide();
  return wide ? <section aria-label={label} className="pt-[34px]">{children}</section> : <Box label={label}>{children}</Box>;
}

/** « MR et PR » before B5. */
export function Prs() {
  const { pc } = useShell();
  return (
    <TabPage title={copy.prs.title} subtitle={copy.prs.subtitle}>
      <Frame label={copy.prs.title}>
        <EmptyState glyph={<Icon name="pr" className="size-[22px]" />} title={copy.prs.notSent(hostName(pc))} body={copy.prs.notSentBody} />
      </Frame>
      <p className="text-small text-muted">{copy.prs.tracked}</p>
    </TabPage>
  );
}

/** « Rigs » before B4: OpenRig's requests above it all the same, since they do not come with the rigs (#40 D1, design-ux 17:23Z). */
export function Rigs({ store }: { store: MobileStore }) {
  const { pc } = useShell();
  return (
    <TabPage title={copy.rigs.title} subtitle={copy.rigs.subtitle}>
      <RigsRequests store={store} />
      <Frame label={copy.rigs.title}>
        <EmptyState glyph={<Icon name="rigs" className="size-[22px]" />} title={copy.rigs.notSent(hostName(pc))} body={copy.rigs.notSentBody} />
      </Frame>
    </TabPage>
  );
}


/** The right pane of a tab on a wide screen, before anything opens there (§2): its glyph, « Rien à afficher », what will open. */
export function EmptyPane({ icon, title, body }: { icon: 'pr' | 'rigs'; title: string; body: string }) {
  return (
    <div data-split-empty="" className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-muted">
      <Icon name={icon} className="size-[18px]" />
      <h2 className="mt-2.5 text-[17px] font-semibold text-fg">{title}</h2>
      <p className="max-w-[320px] text-small">{body}</p>
    </div>
  );
}
