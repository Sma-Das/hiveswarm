"use client";

import { GripVertical } from "lucide-react";
import type { ComponentProps } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

function mergeClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof Group>) {
  return <Group className={mergeClasses("resizable-panel-group", className)} {...props} />;
}

function ResizablePanel({ className, ...props }: ComponentProps<typeof Panel>) {
  return <Panel className={mergeClasses("resizable-panel", className)} {...props} />;
}

function ResizableHandle({
  className,
  withHandle = false,
  ...props
}: ComponentProps<typeof Separator> & { withHandle?: boolean }) {
  return (
    <Separator className={mergeClasses("resizable-handle", className)} {...props}>
      {withHandle ? (
        <span className="resizable-handle__grip" aria-hidden="true">
          <GripVertical size={12} strokeWidth={2} />
        </span>
      ) : null}
    </Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
