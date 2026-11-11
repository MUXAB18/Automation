"use client";

import Link from "next/link";
import { useTransition } from "react";
import { LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import { setThemeAction } from "@/app/(dashboard)/actions";
import { signOutAction } from "@/app/login/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/lib/theme";

export function UserMenu({
  name,
  email,
  roles,
  initials,
  theme,
}: {
  name: string;
  email: string;
  roles: string;
  initials: string;
  theme: Theme;
}) {
  const [, start] = useTransition();
  const chooseTheme = (value: string) =>
    start(async () => {
      const data = new FormData();
      data.set("theme", value);
      await setThemeAction(data);
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-12 gap-3 rounded-full px-1.5 hover:bg-transparent sm:pr-3"
          aria-label="Account menu"
        >
          <Avatar className="size-11 ring-2 ring-card">
            <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block max-w-36 truncate text-sm font-semibold">{name}</span>
            <span className="block max-w-36 truncate text-xs font-normal text-muted-foreground">
              {roles}
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{roles}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={chooseTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden /> Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
