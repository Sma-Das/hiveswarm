import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function NativeSelect({
  className,
  wrapperClassName,
  multiple,
  size,
  ...props
}: ComponentProps<"select"> & { wrapperClassName?: string }) {
  const isList = multiple || (size !== undefined && size > 1);
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn("relative w-full min-w-0", wrapperClassName)}
    >
      <select
        data-slot="native-select"
        multiple={multiple}
        size={size}
        className={cn(
          "w-full min-w-0 appearance-none rounded-md border border-input bg-background px-3 py-2 text-base text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/30 md:text-sm",
          !isList && "h-9 py-1 pr-9",
          className,
        )}
        {...props}
      />
      {!isList && (
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      )}
    </div>
  );
}

function NativeSelectOption(props: ComponentProps<"option">) {
  return <option data-slot="native-select-option" {...props} />;
}

function NativeSelectOptGroup(props: ComponentProps<"optgroup">) {
  return <optgroup data-slot="native-select-optgroup" {...props} />;
}

export { NativeSelect, NativeSelectOption, NativeSelectOptGroup };
