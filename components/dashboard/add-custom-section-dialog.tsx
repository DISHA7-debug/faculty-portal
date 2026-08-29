'use client';

import { Plus, Trash2, Layers } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { createCustomSectionAction } from '@/app/dashboard/custom/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function AddCustomSectionDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [columns, setColumns] = useState<string[]>(['Title', 'Number / Detail', 'Year']);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleAddColumn = () => {
    if (columns.length >= 6) {
      toast.error('Maximum 6 columns allowed per custom section.');
      return;
    }
    setColumns([...columns, `Column ${columns.length + 1}`]);
  };

  const handleRemoveColumn = (index: number) => {
    if (columns.length <= 1) {
      toast.error('At least 1 column is required.');
      return;
    }
    setColumns(columns.filter((_, i) => i !== index));
  };

  const handleColumnChange = (index: number, value: string) => {
    const next = [...columns];
    next[index] = value;
    setColumns(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Please enter a section title.');
      return;
    }

    startTransition(async () => {
      const res = await createCustomSectionAction(title, columns);
      if (res.ok && res.data) {
        toast.success(`Custom section "${title}" created!`);
        setOpen(false);
        setTitle('');
        setColumns(['Title', 'Number / Detail', 'Year']);
        router.push(`/dashboard/custom/${res.data.slug}`);
      } else {
        toast.error(res.error || 'Failed to create custom section.');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-hairline px-3 py-2 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:border-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus className="size-3.5" />
          <span>Add Custom Section</span>
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[1.25rem]">
              <Layers className="size-5 text-primary" />
              <span>Create Custom Section</span>
            </DialogTitle>
            <DialogDescription className="text-[0.85rem]">
              Add a new custom section to your profile (e.g. Patents, Keynotes, Certifications) and define its column headers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <label htmlFor="title" className="block text-[0.85rem] font-medium text-foreground">
                Section Name
              </label>
              <Input
                id="title"
                placeholder="e.g. Patents & Innovations"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-[0.85rem] font-medium text-foreground">
                  Column Headers ({columns.length})
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddColumn}
                  className="h-7 text-xs"
                >
                  <Plus className="mr-1 size-3" /> Add Column
                </Button>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {columns.map((col, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="font-mono text-[0.7rem] text-muted-foreground w-4">
                      {idx + 1}.
                    </span>
                    <Input
                      value={col}
                      onChange={(e) => handleColumnChange(idx, e.target.value)}
                      placeholder={`Column ${idx + 1} Name`}
                      className="h-9 text-xs"
                      required
                    />
                    {columns.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveColumn(idx)}
                        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create Section'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
