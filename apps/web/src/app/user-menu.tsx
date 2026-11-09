import type { SessionResponse } from '@core-studio/contracts';
import { ChevronDown, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useSignOut } from '../features/teams/teams-api';
import { setTheme, type ThemePreference, useThemePreference } from '../lib/theme';

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function UserMenu({ session }: { session: SessionResponse }) {
  const signOut = useSignOut();
  const theme = useThemePreference();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent">
        <span aria-label="Signed in as">{session.user.displayName}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="min-w-48 rounded-md border border-border bg-surface p-1 text-sm shadow-lg"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-text-muted">
            {session.user.email ?? session.user.displayName}
            {session.user.platformAdmin && <span className="ml-1">· Company admin</span>}
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-2 py-1 text-xs text-text-muted">
            Theme
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={theme}
            onValueChange={(value) => {
              setTheme(value as ThemePreference);
            }}
          >
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-surface-muted data-[state=checked]:font-semibold"
              >
                <Icon size={16} aria-hidden="true" />
                {label}
                <DropdownMenu.ItemIndicator className="ml-auto text-accent">
                  ✓
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-surface-muted"
            disabled={signOut.isPending}
            onSelect={() => {
              signOut.mutate();
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
