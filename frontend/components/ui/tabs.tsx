"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs compound components must be used within <Tabs>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Tabs root                                                          */
/* ------------------------------------------------------------------ */

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  onValueChange: (value: string) => void;
  defaultValue?: string;
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, value, onValueChange, children, ...props }, ref) => (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div ref={ref} className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  ),
);
Tabs.displayName = "Tabs";

/* ------------------------------------------------------------------ */
/*  TabsList                                                           */
/* ------------------------------------------------------------------ */

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className,
    )}
    role="tablist"
    {...props}
  />
));
TabsList.displayName = "TabsList";

/* ------------------------------------------------------------------ */
/*  TabsTrigger                                                        */
/* ------------------------------------------------------------------ */

interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, disabled, ...props }, ref) => {
    const { value: selected, onValueChange } = useTabsContext();
    const isActive = selected === value;

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={isActive}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          isActive
            ? "bg-background text-foreground shadow-sm"
            : "hover:bg-background/50 hover:text-foreground",
          className,
        )}
        onClick={() => !disabled && onValueChange(value)}
        {...props}
      />
    );
  },
);
TabsTrigger.displayName = "TabsTrigger";

/* ------------------------------------------------------------------ */
/*  TabsContent                                                        */
/* ------------------------------------------------------------------ */

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => {
    const { value: selected } = useTabsContext();

    if (selected !== value) return null;

    return (
      <div
        ref={ref}
        role="tabpanel"
        className={cn(
          "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className,
        )}
        {...props}
      />
    );
  },
);
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
