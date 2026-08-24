import type { Dictionary } from "@/lib/i18n/dictionary";
import { navigationFor, type NavItem } from "@/lib/workspace/navigation";
import type { Workspace } from "@/lib/workspace/types";

/**
 * What the command palette can do — derived, never authored twice.
 *
 * ## It is navigation, not search
 *
 * Every command is a route this account can already see in the sidebar. The
 * palette calls no API, indexes no content, and never invents a result: a
 * box that looks like search but only knows nine page names is worse than a
 * box that plainly is a jump list.
 *
 * ## Built from the SAME nav definition the sidebar renders
 *
 * Role filtering, ordering and grouping all come from `navigationFor`, so a
 * recruiter who cannot see Compare cannot jump to it either, and a route
 * added to the nav appears here for free. Nothing here is a security
 * boundary — the backend guards every one of these pages — but a palette
 * offering doors that are not in the sidebar would still be a bug.
 */
/** Broadcast by the header button; the palette listens for it. */
export const OPEN_PALETTE_EVENT = "hrc:palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

export interface Command {
  id: string;
  href: string;
  label: string;
  /** The area heading this command sits under, already localized. */
  group: string;
}

export function commandsFor(workspace: Workspace, d: Dictionary): Command[] {
  const { primary, secondary } = navigationFor(workspace);
  const fallbackGroup =
    workspace.kind === "personal" ? d.nav.sectionJobSearch : d.nav.sectionWorkspace;

  const toCommand = (item: NavItem): Command => ({
    id: item.href,
    href: item.href,
    label: d.nav[item.labelKey],
    group: item.groupKey ? d.nav[item.groupKey] : fallbackGroup,
  });

  return [
    ...primary.map(toCommand),
    // Secondary entries have no group of their own in the sidebar; in a flat
    // list they need one, and "Account" is what they are.
    ...secondary.map((item) => ({
      ...toCommand(item),
      group: d.nav.sectionAccount,
    })),
  ];
}

/**
 * Case- and diacritic-insensitive substring match on the visible label.
 *
 * Deliberately not fuzzy. A fuzzy matcher ranks "Settings" above "Saved jobs"
 * for the query "s" on grounds no reader can predict; a substring match is
 * boring and always explicable. Normalisation matters for the non-Latin
 * locales, where a composed and a decomposed character look identical.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const needle = normalize(query);
  if (needle.length === 0) return commands;
  return commands.filter((command) => normalize(command.label).includes(needle));
}

function normalize(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().trim();
}

/** Groups a filtered list, preserving order. Empty groups never appear. */
export function groupCommands(
  commands: Command[],
): { group: string; commands: Command[] }[] {
  const groups: { group: string; commands: Command[] }[] = [];
  for (const command of commands) {
    const last = groups[groups.length - 1];
    if (last && last.group === command.group) last.commands.push(command);
    else groups.push({ group: command.group, commands: [command] });
  }
  return groups;
}

/** Wraps around at both ends, so the arrow keys never dead-end. */
export function moveActiveIndex(
  current: number,
  delta: number,
  length: number,
): number {
  if (length === 0) return 0;
  return (current + delta + length) % length;
}
