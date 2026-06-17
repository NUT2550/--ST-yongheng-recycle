'use client';

import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Product } from '@/lib/types';

export interface ProductComboboxGroup {
  categoryId: string;
  categoryName: string;
  products: Product[];
}

interface ProductComboboxProps {
  groups: ProductComboboxGroup[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  /** Render function for each product item label */
  renderLabel?: (product: Product) => React.ReactNode;
  className?: string;
  id?: string;
}

export function ProductCombobox({
  groups,
  value,
  onValueChange,
  placeholder = 'เลือกสินค้า...',
  emptyText = 'ไม่พบสินค้า',
  searchPlaceholder = 'ค้นหาสินค้า...',
  renderLabel,
  className,
  id,
}: ProductComboboxProps) {
  const [open, setOpen] = React.useState(false);

  // Find selected product name for display
  const selectedProduct = React.useMemo(() => {
    for (const group of groups) {
      const found = group.products.find((p) => p.id === value);
      if (found) return found;
    }
    return null;
  }, [groups, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          id={id}
          className={cn('w-full justify-between font-normal h-9', className)}
        >
          {selectedProduct
            ? (renderLabel ? renderLabel(selectedProduct) : selectedProduct.name)
            : <span className="text-muted-foreground">{placeholder}</span>
          }
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.categoryId} heading={group.categoryName}>
                {group.products.map((product) => (
                  <CommandItem
                    key={product.id}
                    value={`${product.name} ${group.categoryName}`}
                    onSelect={() => {
                      onValueChange(product.id === value ? '' : product.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === product.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {renderLabel ? renderLabel(product) : product.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
