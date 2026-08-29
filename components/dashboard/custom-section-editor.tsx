'use client';

import { Trash2, Plus, Layers, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  createCustomItemAction,
  deleteCustomItemAction,
  deleteCustomSectionAction,
} from '@/app/dashboard/custom/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type CustomSectionData = {
  id: string;
  title: string;
  slug: string;
  columns: string[];
  items: Array<{
    id: string;
    values: Record<string, string>;
    sortOrder: number;
  }>;
};

export function CustomSectionEditor({ section }: { section: CustomSectionData }) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleValueChange = (column: string, val: string) => {
    setFormData((prev) => ({ ...prev, [column]: val }));
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await createCustomItemAction(section.id, formData);
      if (res.ok) {
        toast.success('Entry added successfully!');
        setFormData({});
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to add entry.');
      }
    });
  };

  const handleDeleteItem = (itemId: string) => {
    if (!confirm('Are you sure you want to delete this row?')) return;
    startTransition(async () => {
      const res = await deleteCustomItemAction(itemId);
      if (res.ok) {
        toast.success('Entry deleted.');
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to delete entry.');
      }
    });
  };

  const handleDeleteSection = () => {
    if (
      !confirm(
        `Are you sure you want to delete the entire "${section.title}" section? All rows inside will be permanently removed.`,
      )
    )
      return;

    startTransition(async () => {
      const res = await deleteCustomSectionAction(section.id);
      if (res.ok) {
        toast.success(`Section "${section.title}" deleted.`);
        router.push('/dashboard');
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to delete section.');
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-hairline pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="size-5 text-primary" />
            <h1 className="text-[2.25rem] leading-none font-display">{section.title}</h1>
          </div>
          <p className="mt-2 text-[0.85rem] text-muted-foreground measure">
            Custom section with columns: {section.columns.join(', ')}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleDeleteSection}
          className="text-destructive hover:bg-destructive/10 border-destructive/20"
          disabled={pending}
        >
          <Trash2 className="mr-1.5 size-3.5" /> Delete Section
        </Button>
      </div>

      {/* ADD ITEM FORM */}
      <div className="rounded-xl border border-hairline bg-surface-raised p-5 sm:p-6 shadow-xs">
        <h2 className="text-[1.1rem] font-medium mb-4 flex items-center gap-2">
          <Plus className="size-4 text-primary" />
          <span>Add New Entry</span>
        </h2>

        <form onSubmit={handleAddItem} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.columns.map((col) => (
              <div key={col} className="space-y-1.5">
                <label htmlFor={`col-${col}`} className="block text-[0.8rem] font-medium text-foreground">
                  {col}
                </label>
                <Input
                  id={`col-${col}`}
                  placeholder={`Enter ${col.toLowerCase()}…`}
                  value={formData[col] ?? ''}
                  onChange={(e) => handleValueChange(col, e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Add Row'}
            </Button>
          </div>
        </form>
      </div>

      {/* ITEMS TABLE */}
      <div className="space-y-3">
        <h2 className="text-[1.1rem] font-medium">Entries ({section.items.length})</h2>

        {section.items.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-hairline bg-background shadow-xs">
            <table className="w-full text-left text-[0.85rem]">
              <thead className="border-b border-hairline bg-surface-sunken font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">#</th>
                  {section.columns.map((col) => (
                    <th key={col} className="px-4 py-3 font-medium">
                      {col}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {section.items.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-surface-raised/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-[0.75rem] text-muted-foreground">
                      {idx + 1}
                    </td>
                    {section.columns.map((col) => (
                      <td key={col} className="px-4 py-3 text-foreground font-medium">
                        {item.values[col] || '—'}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteItem(item.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="Delete row"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-hairline bg-surface-sunken p-8 text-center text-muted-foreground">
            <AlertCircle className="mx-auto size-8 opacity-40 mb-2" />
            <p className="text-[0.9rem]">No entries added to this custom section yet.</p>
            <p className="text-[0.8rem] opacity-75">Use the form above to add your first entry.</p>
          </div>
        )}
      </div>
    </div>
  );
}
